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

import { core, appConsts } from '$lib/core/core.svelte.js';
import { applyOp } from '$lib/core/operations.js';
import { buildTableProcessDefaults } from '$lib/core/tpDefaults.js';

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
		plots[type] = { inputs: entry.defaultInputs ?? [] };
	}
	return { tps, plots };
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
		plots: (c.plots ?? []).map((p) => ({ id: p.id, type: p.type, name: p.name }))
	};
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
 * @param {{analyses?: any[], plots?: any[], changes?: any[]}} spec
 * @param {{summary: object, facts: object}} ctx
 * @returns {{analyses: any[], plots: any[], changes: any[], errors: string[], preview: string[]}}
 */
export function planEdit(spec, { summary, facts }) {
	const errors = [];
	const preview = [];
	const analyses = [];
	const plots = [];
	const changes = [];

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

	// ---- parameter changes to existing analyses ----
	const byId = new Map((summary.analyses ?? []).map((a) => [a.id, a]));
	for (const ch of spec?.changes ?? []) {
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

	return { analyses, plots, changes, errors, preview };
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
	for (const c of plan.changes) {
		ops.push({ kind: 'setFreeTableProcessArg', tpId: c.tpId, key: c.key, value: c.value });
	}
	if (ops.length) applyOp({ kind: 'batch', ops });

	return {
		ok: true,
		errors,
		added: {
			analyses: tps.length,
			plots: plan.plots.length - skippedPlots,
			changes: plan.changes.length
		}
	};
}
