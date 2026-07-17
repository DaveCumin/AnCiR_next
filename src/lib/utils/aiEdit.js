// @ts-nocheck
// AI edits to the OPEN session — the model proposes, this compiles it to ops, the user applies.
//
// Why this can exist at all: AnCiR's op engine already takes plain JSON
// (`{kind:'addFreeTableProcess', tpType:'Cosinor', args:{…}}`), applies it atomically via a
// `batch`, and hands back an inverse. So a remote edit needs no new mutation layer — only a
// translation from what a model is good at (NAMES) into what the engine wants (ids).
//
// Three rules shape everything here:
//
//  1. The model speaks DRAFTS, not ops. It already emits `{analyses, plots}` with column names
//     for the build path, and it's demonstrably good at it. Teaching it raw ops with numeric
//     column ids would trade a working vocabulary for the one thing models are worst at. So the
//     spec below is the draft language, and the compiling happens here.
//
//  2. Never trust the model's output. Everything is checked against the live registry and the
//     real session before a single op runs — `op_batch` has no rollback, so a bad child op
//     leaves a half-applied session. Validation isn't politeness, it's the safety net.
//
//  3. Output columns are allocated by the TableProcess CONSTRUCTOR, not by us. Re-deriving
//     which columns a node produces is exactly the bug class that silently broke the cosinor
//     fit (a missed fixed output, `cosinorx`; see ADR 2026-07-15). The constructor owns that
//     rule, so we let it run and read the ids back — which is why applying is two-phase.
//
// Additions and parameter changes only: no deletes. A model deleting a user's work on a
// misread instruction is a much worse failure than one that declines to.

import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { applyOp } from '$lib/core/operations.js';
import { buildTableProcessDefaults } from '$lib/core/tpDefaults.js';
import { getSharedSchema, getSharedDataSchema } from '$lib/plots/sharedControls.js';
import { getByPath, setByPath } from '$lib/utils/objectPath.js';
import dayjs from '$lib/utils/time/dayjsSetup.js';

// Mirrors the emitted-session series colours (plots/canonicalNodeViz.js), so an AI-added plot
// looks like one Quick-Plot would produce: navy for measured data, terracotta for a fit.
const RAW_COLOUR = '#234154';
const FIT_COLOUR = '#BE796B';

// A plot type ignores the style slots it doesn't read, so emitting the union is safe — and a
// slot with no colour throws in some fromJSON paths. Same list the normalizer emits.
const STYLE_SLOTS = ['line', 'points', 'thresholdline', 'confidenceLine'];

// Arg keys that are wiring/bookkeeping rather than user-facing params (mirrors the engine's
// describeCapabilities() and gen-schema.js). A model must never set these.
const STRUCTURAL = new Set([
	'out',
	'valid',
	'forcollected',
	'collectedType',
	'preProcesses',
	'tableProcesses',
	'outColIds',
	'storedValueRefs',
	'aggregates'
]);

/** Style slots for one series. `kind:'line'` draws a connected curve (a fit), else points. */
function seriesStyle(kind) {
	const isLine = kind === 'line';
	const c = isLine ? FIT_COLOUR : RAW_COLOUR;
	const style = {
		line: { colour: c, draw: isLine, strokeWidth: isLine ? 2.5 : 2, stroke: 'solid' },
		points: { colour: c, draw: !isLine, radius: 3, shape: 'circle' }
	};
	for (const slot of STYLE_SLOTS) style[slot] ??= { colour: c };
	return style;
}

/**
 * The field a plot class actually STORES a series input under, given its i-th PORT name.
 *
 * These are two different vocabularies and conflating them silently unwires the plot: an
 * actogram advertises ports `time`/`values` but persists them as `x`/`y`, and its fromJSON
 * reads nothing else. Two-input plots store positionally; a single input keeps its own name
 * (histogram's `column`).
 */
function storageField(fields, i) {
	if (fields.length === 2) return i === 0 ? 'x' : 'y';
	return fields[i];
}

/**
 * Registry facts the planner needs, lifted out of the live registry so the planner itself stays
 * pure (and testable without booting the app).
 */
export function registryFacts(consts = appConsts) {
	const tps = {};
	for (const [name, entry] of consts.tableProcessMap ?? new Map()) {
		const cif = entry.columnIdFields ?? {};
		const inputFields = new Set([...(cif.scalar ?? []), ...(cif.array ?? [])]);
		tps[name] = {
			scalar: cif.scalar ?? [],
			array: cif.array ?? [],
			yOutKeyPrefix: entry.yOutKeyPrefix ?? null,
			// The node's fixed output keys, taken verbatim from its `out` template — the same
			// list the TableProcess constructor materialises a column for. Reading the template
			// (rather than reasoning about what a node "should" produce) is what makes
			// `cosinorx` resolvable instead of silently missing.
			fixedOut: Object.keys(entry.defaults?.get?.('out') ?? {}),
			// Param names only: not `out`, not wiring/bookkeeping, not input fields. Used to
			// reject invented params before they reach a node's args.
			params: Array.from(entry.defaults?.keys() ?? []).filter(
				(k) => !STRUCTURAL.has(k) && !inputFields.has(k)
			)
		};
	}
	const plots = {};
	for (const [type, entry] of consts.plotMap ?? new Map()) {
		plots[type] = {
			inputs: entry.defaultInputs ?? [],
			// Shading (light/dark bands) is a scatterplot feature today. Asked of the class
			// rather than hardcoded, so a plot that gains bands is covered for free.
			supportsBands: typeof entry.data?.prototype?.addNightBand === 'function'
		};
	}
	return { tps, plots };
}

/**
 * Why a value can't go in this property, or null if it can.
 *
 * Lenient on purpose. `input` is INFERRED from the current value, so a field that happens to be
 * null right now reports 'text' even though it wants a number — every axis limit defaults to
 * null (meaning "auto"). Rejecting a number there because reflection guessed 'text' would refuse
 * the most ordinary request there is ("set the y axis to 0–100"). So this checks the things that
 * are genuinely wrong — an object, a made-up select option, a string where only true/false makes
 * sense — and lets the rest through to the plot, which defaults anything it dislikes.
 */
function propertyIssue(prop, value) {
	if (value !== null && typeof value === 'object') return 'must be a single value, not an object';
	if (prop.options?.length && !prop.options.includes(value))
		return `must be one of ${prop.options.join(', ')}`;
	if (prop.input === 'boolean' && typeof value !== 'boolean') return 'must be true or false';
	if (prop.input === 'number' && value !== null && !Number.isFinite(Number(value)))
		return 'must be a number';
	return null;
}

/**
 * Hours between two clock hours, wrapping midnight: 18:00→06:00 is 12 h, not -12.
 * @returns {number|null} null when the two are the same hour (a zero-width band)
 */
export function bandDuration(fromHour, toHour) {
	const d = (((toHour - fromHour) % 24) + 24) % 24;
	return d === 0 ? null : d;
}

/**
 * A compact description of the open session for the model: what it can refer to, and nothing
 * else. Deliberately no rawData — it's the bulk of a session, it would dwarf the prompt, and
 * the model never needs a single number to decide "add a periodogram of activity".
 */
export function summariseSession(c = core) {
	return {
		columns: (c.data ?? []).map((col) => ({
			id: col.id,
			name: col.name,
			type: col.type ?? 'number'
		})),
		analyses: (c.tableProcesses ?? []).map((tp) => ({
			id: tp.id,
			name: tp.name,
			// Inputs + params, but not `out` — output wiring is ours to manage, and exposing it
			// invites the model to try to set it.
			args: Object.fromEntries(Object.entries(tp.args ?? {}).filter(([k]) => k !== 'out'))
		})),
		plots: (c.plots ?? []).map((p) => ({
			id: p.id,
			type: p.type,
			name: p.name,
			props: plotProps(p)
		}))
	};
}

/**
 * The restyle-able properties of one plot: path, what it is, and its value right now.
 *
 * Straight from the app's own reflection — the same schemas that build the shared-options panel,
 * so the AI is offered exactly what a user can change by hand, and a plot that gains a property
 * is covered without anyone editing a list here. This is also the ALLOW-LIST the planner checks
 * against, which is why it must come from the app rather than from anything the model says.
 *
 * TWO schemas, because the panel has two tabs and the interesting things live in the second:
 *   - getSharedSchema     → the plot: axis limits, log scales, padding. It SKIPS `data`.
 *   - getSharedDataSchema → one SERIES: colour, marker shape, line width.
 * Using only the first is why "change the colour of the actogram" did nothing — a colour isn't
 * a property of the plot, it's a property of a series, and none were on offer.
 *
 * Only the plots in the open session are described, so the cost stays bounded by what's on
 * screen rather than by all 11 plot types.
 */
/**
 * The per-series fields, expanded across EVERY series and addressed from the wrapper.
 *
 * getSharedDataSchema describes one row (the panel applies an edit to whichever rows are
 * selected) with paths relative to it — `line.colour`. A model has no selection, so each series
 * gets its own absolute path, `plot.data[0].line.colour`, and a label naming the series so
 * "make the fit red" can pick the right one out of a data+fit plot.
 *
 * `refId`/`id` are dropped: those are the plot's WIRING, and rewiring a plot by writing a raw
 * column id is not something the model should be invited to do.
 */
function seriesFields(plotWrapper) {
	const rows = plotWrapper?.plot?.data;
	if (!Array.isArray(rows) || !rows.length) return [];

	let rowSchema;
	try {
		rowSchema = getSharedDataSchema(plotWrapper);
	} catch {
		return [];
	}

	return rows.flatMap((row, i) => {
		const seriesName = row?.label || `series ${i + 1}`;
		return rowSchema
			.filter((f) => !/(^|\.)(refId|id)$/.test(f.path))
			.map((f) => ({
				...f,
				path: `plot.data[${i}].${f.path}`,
				label: `${seriesName}: ${f.label}`,
				group: `Series ${i + 1}`
			}));
	});
}

export function plotProps(plotWrapper) {
	let schema;
	try {
		schema = [...getSharedSchema(plotWrapper), ...seriesFields(plotWrapper)];
	} catch {
		return []; // a plot that can't describe itself simply isn't restyle-able
	}
	return schema
		.map((f) => {
			const value = getByPath(plotWrapper, f.path);
			// Objects/arrays aren't settable in one go, and a model shouldn't try.
			if (value != null && typeof value === 'object') return null;
			return {
				path: f.path,
				label: f.label,
				input: f.input,
				...(f.options ? { options: f.options } : {}),
				value: value ?? null
			};
		})
		.filter(Boolean);
}

/** Case-insensitive name → id, so "Time" resolves to the column called "time". */
function nameIndex(columns) {
	const m = new Map();
	for (const col of columns) {
		if (typeof col.name !== 'string') continue;
		if (!m.has(col.name)) m.set(col.name, col.id);
		const lower = col.name.toLowerCase();
		if (!m.has(lower)) m.set(lower, col.id);
	}
	return m;
}

/**
 * Resolve one column reference to `{colId}` or a SYMBOLIC `{analysis, outKey}`.
 *
 * The symbolic case is the interesting one. A model asked to "fit a cosinor and plot the fit"
 * must name a column that does not exist yet — the fit curve appears only once the node is
 * constructed. It refers to it the same way the build path taught it: `<prefix><Y name>`
 * (`cosinory_values`) or a fixed output by name (`cosinorx`). We record the intent and resolve
 * it for real in phase 2, once the constructor has minted the columns.
 */
function resolveRef(ref, { index, pending }) {
	if (typeof ref === 'number') return index.byId.has(ref) ? { colId: ref } : null;
	if (typeof ref !== 'string') return null;
	const name = ref.trim();

	const direct = index.names.get(name) ?? index.names.get(name.toLowerCase());
	if (direct != null) return { colId: direct };

	// An output of an analysis this same edit is about to add.
	for (let i = 0; i < pending.length; i++) {
		const p = pending[i];
		if (p.fixedOutKeys.has(name)) return { analysis: i, outKey: name };
		if (p.aliases.has(name)) return { analysis: i, outKey: p.aliases.get(name) };
	}
	return null;
}

/**
 * Compile a model's edit spec into a plan. PURE: no core, no registry, no mutation — hand it a
 * summary and facts and it tells you exactly what would happen, which is what makes both the
 * preview and the tests possible.
 *
 * @param {{analyses?: any[], plots?: any[], changes?: any[], bands?: any[]}} spec
 * @param {{summary: object, facts: object}} ctx
 * @returns {{analyses, plots, changes, bands, errors: string[], preview: string[]}}
 */
export function planEdit(spec, { summary, facts }) {
	const errors = [];
	const preview = [];
	const analyses = [];
	const plots = [];
	const changes = [];
	const bands = [];

	const index = {
		names: nameIndex(summary.columns ?? []),
		byId: new Set((summary.columns ?? []).map((c) => c.id))
	};
	const nameOf = new Map((summary.columns ?? []).map((c) => [c.id, c.name]));
	// Analyses queued by THIS edit, so a later plot can refer to their outputs.
	const pending = [];

	// ---- analyses ----
	for (const a of spec?.analyses ?? []) {
		const tpType = a?.name;
		const f = facts.tps[tpType];
		if (!f) {
			errors.push(`Unknown analysis "${tpType}" — skipped.`);
			continue;
		}
		const raw = { ...(a.args ?? {}) };
		// The draft contract is FLAT, but models occasionally nest anyway. Cheap to accept.
		if (raw.inputs && typeof raw.inputs === 'object') Object.assign(raw, raw.inputs);
		if (raw.params && typeof raw.params === 'object') Object.assign(raw, raw.params);
		delete raw.inputs;
		delete raw.params;
		delete raw.out; // never the model's to set

		const inputs = {};
		let failed = false;

		for (const field of f.scalar) {
			if (!(field in raw)) continue;
			const r = resolveRef(raw[field], { index, pending });
			if (!r || r.analysis != null) {
				// An analysis can't read a column that another analysis in this same edit hasn't
				// produced yet — we'd have to order and re-resolve mid-phase. Reject rather than
				// wire it to the wrong column.
				errors.push(`${tpType}: can't resolve ${field} = "${raw[field]}" — skipped.`);
				failed = true;
				break;
			}
			inputs[field] = r.colId;
			delete raw[field];
		}
		if (failed) continue;

		for (const field of f.array) {
			if (!(field in raw)) continue;
			const list = Array.isArray(raw[field]) ? raw[field] : [raw[field]];
			const ids = [];
			for (const item of list) {
				const r = resolveRef(item, { index, pending });
				if (!r || r.analysis != null) {
					errors.push(`${tpType}: can't resolve ${field} = "${item}" — skipped.`);
					failed = true;
					break;
				}
				ids.push(r.colId);
			}
			if (failed) break;
			inputs[field] = ids;
			delete raw[field];
		}
		if (failed) continue;

		const params = {};
		for (const [k, v] of Object.entries(raw)) {
			if (!f.params.includes(k)) {
				// Not fatal: drop the invented param and keep the node, which is nearly always
				// what the user wanted. Reported so it isn't a silent difference.
				errors.push(`${tpType}: ignored unknown parameter "${k}".`);
				continue;
			}
			params[k] = v;
		}

		// What this node WILL produce, so a plot in the same edit can point at it. Keys only —
		// the ids don't exist until the constructor runs.
		//
		// Per-Y outputs are keyed `${prefix}${yId}`, but the model was taught to name them
		// `${prefix}${Y column name}` (`cosinory_values`) — it has no way to know the id. Map
		// one to the other here, exactly as the build path's normalizer does.
		const yIds = inputs.yIN ?? inputs[f.array[0]] ?? [];
		const aliases = new Map();
		if (f.yOutKeyPrefix) {
			for (const yId of Array.isArray(yIds) ? yIds : [yIds]) {
				const n = nameOf.get(yId);
				if (n != null) aliases.set(`${f.yOutKeyPrefix}${n}`, `${f.yOutKeyPrefix}${yId}`);
			}
		}
		pending.push({ tpType, aliases, fixedOutKeys: new Set(f.fixedOut) });

		analyses.push({ tpType, inputs, params });
		const inputBits = Object.entries(inputs)
			.map(([k, v]) => `${k}=${Array.isArray(v) ? v.map((i) => nameOf.get(i)).join(', ') : nameOf.get(v)}`)
			.join('; ');
		preview.push(`Add analysis: ${tpType}${inputBits ? ` (${inputBits})` : ''}`);
	}

	// ---- plots ----
	for (const pl of spec?.plots ?? []) {
		const type = pl?.type;
		const pf = facts.plots[type];
		if (!pf) {
			errors.push(`Unknown plot type "${type}" — skipped.`);
			continue;
		}
		const fields = pf.inputs;
		if (!fields.length) {
			errors.push(`Plot type "${type}" isn't supported for AI edits yet — skipped.`);
			continue;
		}
		const rawSeries = Array.isArray(pl.series) ? pl.series : pl.inputs ? [pl.inputs] : [];
		if (!rawSeries.length) {
			errors.push(`Plot "${type}" had no series — skipped.`);
			continue;
		}

		const series = [];
		let failed = false;
		for (const s of rawSeries) {
			const refs = {};
			for (let i = 0; i < fields.length; i++) {
				const field = fields[i];
				const r = resolveRef(s?.[field], { index, pending });
				if (!r) {
					errors.push(`Plot "${type}": can't resolve ${field} = "${s?.[field]}" — skipped.`);
					failed = true;
					break;
				}
				refs[storageField(fields, i)] = r;
			}
			if (failed) break;
			series.push({ refs, kind: s?.kind === 'line' ? 'line' : 'points', label: s?.label });
		}
		if (failed) continue;

		const name = typeof pl.name === 'string' && pl.name.trim() ? pl.name.trim() : type;
		plots.push({ type, name, series });
		preview.push(`Add plot: ${type} — "${name}" (${series.length} series)`);
	}

	// ---- changes to an existing analysis or plot ----
	//
	// One verb, two targets: `{analysis: 3, set: {...}}` tunes a node's params, `{plot: 2,
	// set: {...}}` restyles a plot by descriptor path. Both are checked against an allow-list
	// the APP produced (registry params / getSharedSchema paths) — never against anything the
	// model asserted.
	const byId = new Map((summary.analyses ?? []).map((a) => [a.id, a]));
	const plotById = new Map((summary.plots ?? []).map((p) => [p.id, p]));

	for (const ch of spec?.changes ?? []) {
		if (ch?.plot != null) {
			const target = plotById.get(ch.plot);
			if (!target) {
				errors.push(`Can't restyle plot ${ch.plot} — no such plot.`);
				continue;
			}
			const propByPath = new Map((target.props ?? []).map((p) => [p.path, p]));
			for (const [path, v] of Object.entries(ch?.set ?? {})) {
				const prop = propByPath.get(path);
				if (!prop) {
					errors.push(`${target.type}: "${path}" isn't a property of this plot.`);
					continue;
				}
				const bad = propertyIssue(prop, v);
				if (bad) {
					errors.push(`${target.type} ${path}: ${bad}`);
					continue;
				}
				changes.push({ plotId: target.id, path, value: v });
				preview.push(
					`Restyle ${target.type}${target.name ? ` "${target.name}"` : ''}: ${prop.label} = ${JSON.stringify(v)}`
				);
			}
			continue;
		}

		const target = byId.get(ch?.analysis);
		if (!target) {
			errors.push(`Can't change analysis ${ch?.analysis} — no such node.`);
			continue;
		}
		const f = facts.tps[target.name];
		for (const [k, v] of Object.entries(ch?.set ?? {})) {
			if (!f?.params.includes(k)) {
				errors.push(`${target.name}: can't set unknown parameter "${k}".`);
				continue;
			}
			changes.push({ tpId: target.id, key: k, value: v });
			preview.push(`Change ${target.name} (#${target.id}): ${k} = ${JSON.stringify(v)}`);
		}
	}

	// ---- shading (light/dark bands) on an existing plot ----
	//
	// Expressed in CLOCK HOURS ("shade 18:00 → 06:00"), which is what a chronobiologist means
	// and all a model can sensibly know. It is NOT the field the plot stores: on a time axis
	// `startTimeHours` holds an absolute epoch-ms, so 18 would put the first band 18 ms after
	// 1970 and shade nothing. applyEdit converts to the axis's own units, because only it can
	// see the axis and the session's timezone.
	for (const b of spec?.bands ?? []) {
		const target = plotById.get(b?.plot);
		if (!target) {
			errors.push(`Can't shade plot ${b?.plot} — no such plot.`);
			continue;
		}
		if (!facts.plots[target.type]?.supportsBands) {
			errors.push(`A ${target.type} doesn't support shading — only some plot types do.`);
			continue;
		}
		const from = Number(b?.fromHour);
		const to = Number(b?.toHour);
		if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || from >= 24 || to < 0 || to >= 24) {
			errors.push(`Shading needs fromHour and toHour as clock hours 0–24 (got ${b?.fromHour}–${b?.toHour}).`);
			continue;
		}
		const durationHours = bandDuration(from, to);
		if (durationHours == null) {
			errors.push(`Shading from ${from}:00 to ${to}:00 covers nothing — skipped.`);
			continue;
		}
		const label = typeof b?.label === 'string' && b.label.trim() ? b.label.trim() : 'Night';
		bands.push({ plotId: target.id, fromHour: from, durationHours, label });
		const hh = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
		preview.push(
			`Shade ${target.type}${target.name ? ` "${target.name}"` : ''}: ${hh(from)}–${hh(to)} each day`
		);
	}

	return { analyses, plots, changes, bands, errors, preview };
}

/**
 * Where the FIRST shaded band starts, in the units the plot's x axis actually uses.
 *
 * This is the whole reason shading isn't just "set a property". `NightBandClass.startTimeHours`
 * means two different things depending on the axis, and the plot's own UI swaps between a
 * date-time picker and a number box to match:
 *
 *   - numeric x (hours since start): it IS the clock hour → 18.
 *   - time x (epoch ms): it's an absolute x VALUE, so 18 means 18 ms after 1970 — the band would
 *     land nowhere near the data and the renderer would step 24 h at a time across half a
 *     century to reach it.
 *
 * So for a time axis, find the first `fromHour` o'clock at or after the data starts, in the
 * session's own display timezone (18:00 is a LOCAL hour; using UTC would silently shift the
 * shading by the offset — the kind of error that looks plausible on screen).
 *
 * @param {object} inner the plot's data object (plot.plot)
 * @param {number} fromHour clock hour 0–24
 * @param {string} tz IANA zone, e.g. 'Pacific/Auckland'
 */
export function firstBandStart(inner, fromHour, tz) {
	const minX = inner?.xlims?.[0];
	if (!inner?.anyXdataTime) return fromHour; // numeric axis: the hour is the value
	if (!Number.isFinite(minX)) return fromHour; // no data yet — harmless; bands render off none

	const zone = tz && tz !== 'utc' ? tz : 'UTC';
	const h = Math.floor(fromHour);
	const m = Math.round((fromHour % 1) * 60);
	// The same clock hour on the data's own first day, then step forward if that's already past.
	let start = dayjs(minX).tz(zone).hour(h).minute(m).second(0).millisecond(0);
	if (start.valueOf() < minX) start = start.add(1, 'day');
	return start.valueOf();
}

/** Plot JSON for `addPlot`, with every ref already a real column id. */
function plotData(plan, resolve) {
	const data = plan.series.map((s) => {
		const entry = { ...seriesStyle(s.kind) };
		for (const [field, ref] of Object.entries(s.refs)) entry[field] = { refId: resolve(ref) };
		if (s.label) entry.label = s.label;
		return entry;
	});
	return {
		name: plan.name,
		type: plan.type,
		x: 0,
		y: 0,
		width: 420,
		height: 300,
		plot: { data }
	};
}

/**
 * Apply a plan. Two phases, because an analysis's output columns don't exist until its
 * TableProcess constructor runs — that's what mints them (and per-Y expansion with them). So we
 * add the analyses, read the ids the constructor chose, and only then wire the plots.
 *
 * The cost is that a plan with both lands as TWO undo entries rather than one: "undo the plots",
 * then "undo the analyses". The alternative is re-deriving each node's output keys here so
 * everything could go in a single batch — which is precisely the duplication that produced the
 * cosinorx bug. One extra keypress is the better trade.
 *
 * @returns {{ok: boolean, errors: string[], added: {analyses: number, plots: number, changes: number}}}
 */
export function applyEdit(plan) {
	const errors = [...(plan.errors ?? [])];

	// --- phase 1: analyses (the constructor materialises their outputs) ---
	let tps = [];
	if (plan.analyses.length) {
		const ops = plan.analyses.map(({ tpType, inputs, params }) => {
			const entry = appConsts.tableProcessMap.get(tpType);
			// Same recipe as the palette, so an AI-added node is indistinguishable from a
			// hand-added one — including the fresh `out` template the constructor fills in.
			const args = { ...buildTableProcessDefaults(entry), ...params, ...inputs };
			return { kind: 'addFreeTableProcess', tpType, args };
		});
		const inverse = applyOp({ kind: 'batch', ops });
		// The inverse batch carries the ids the constructor minted — the only way back to the
		// instances, since a batch returns inverses rather than the objects it made. op_batch
		// unshifts each inverse, so the list is reversed.
		const tpIds = [...(inverse?.ops ?? [])].reverse().map((o) => o.tpId);
		tps = tpIds.map((id) => core.tableProcesses.find((t) => t.id === id));
		if (tps.length !== plan.analyses.length || tps.some((t) => !t)) {
			// Shouldn't happen (addFreeTableProcess never no-ops), but wiring plots against a
			// mismatched list would be worse than stopping.
			errors.push('Some analyses could not be added; plots were skipped.');
			return { ok: false, errors, added: { analyses: tps.filter(Boolean).length, plots: 0, changes: 0 } };
		}
	}

	// --- phase 2: plots + param changes ---
	const resolve = (ref) => {
		if (ref.colId != null) return ref.colId;
		const tp = tps[ref.analysis];
		return tp?.args?.out?.[ref.outKey] ?? -1;
	};

	const ops = [];
	let skippedPlots = 0;
	for (const p of plan.plots) {
		// A symbolic ref that didn't survive (a fixed output key the node doesn't actually have)
		// would wire the series to -1 — an unwired plot that throws at render. Drop it and say so.
		const unresolved = p.series.some((s) => Object.values(s.refs).some((r) => resolve(r) === -1));
		if (unresolved) {
			errors.push(`Plot "${p.name}": its inputs couldn't be wired — skipped.`);
			skippedPlots++;
			continue;
		}
		ops.push({ kind: 'addPlot', plotData: plotData(p, resolve) });
	}
	// Both restyles and shading rewrite a plot's inner, so they share ONE snapshot per plot,
	// taken once and emitted once at the end. Snapshotting per edit would read the same
	// unmutated live plot each time (the ops don't run until the batch below), and the last
	// setPlotInner would silently discard the others — shading a plot and setting its axis in
	// one breath would lose whichever came first.
	const inners = new Map(); // plotId -> the inner snapshot being built up
	const innerFor = (plot) => {
		if (!inners.has(plot.id)) {
			// DEEP copy, not just toJSON(). A plot's toJSON hands out its live $state arrays by
			// reference (`ylimsLeftIN: this.ylimsLeftIN`), so writing into the "snapshot" would
			// write straight through into the plot — before the op ran. setPlotInner would then
			// capture the ALREADY-mutated state as its undo point, and the restyle became
			// permanent: undo took the band away and left the axis limits behind.
			inners.set(plot.id, JSON.parse(JSON.stringify(plot.plot.toJSON())));
		}
		return inners.get(plot.id);
	};

	// Analysis params, and plot restyles. A restyle addresses the plot WRAPPER by path
	// ('width', 'plot.ylimsIN[0]'), so it splits two ways: a wrapper-level key is a plain
	// property op, anything under `plot.` goes into the inner snapshot.
	for (const c of plan.changes) {
		if (c.tpId != null) {
			ops.push({ kind: 'setFreeTableProcessArg', tpId: c.tpId, key: c.key, value: c.value });
			continue;
		}
		const plot = core.plots.find((p) => p.id === c.plotId);
		if (!plot?.plot?.toJSON) {
			errors.push(`Couldn't restyle plot ${c.plotId} — it's no longer there.`);
			continue;
		}
		if (!c.path.startsWith('plot.')) {
			ops.push({ kind: 'setPlotProperty', id: plot.id, key: c.path, value: c.value });
			continue;
		}
		// The path addresses the wrapper; the snapshot IS the inner, so drop the `plot.` head.
		setByPath(innerFor(plot), c.path.slice('plot.'.length), c.value);
	}

	// Shading. Clock hours become axis units here, where the axis and timezone are visible.
	let skippedBands = 0;
	for (const b of plan.bands ?? []) {
		const plot = core.plots.find((p) => p.id === b.plotId);
		if (!plot?.plot?.toJSON) {
			errors.push(`Couldn't shade plot ${b.plotId} — it's no longer there.`);
			skippedBands++;
			continue;
		}
		const inner = innerFor(plot);
		inner.nightBands = [
			...(inner.nightBands ?? []),
			{
				name: b.label,
				mode: 'repeating',
				enabled: true,
				repeatEveryHours: 24,
				nightDurationHours: b.durationHours,
				startTimeHours: firstBandStart(plot.plot, b.fromHour, appState?.displayTimezone),
				// The band starts at a clock time we computed, NOT at whenever the data happens
				// to begin — which is what useDataMin would mean.
				useDataMin: false,
				customBands: []
			}
		];
	}

	for (const [id, inner] of inners) ops.push({ kind: 'setPlotInner', id, inner });

	if (ops.length) applyOp({ kind: 'batch', ops });

	return {
		ok: true,
		errors,
		added: {
			analyses: tps.length,
			plots: plan.plots.length - skippedPlots,
			changes: plan.changes.length,
			bands: (plan.bands?.length ?? 0) - skippedBands
		}
	};
}
