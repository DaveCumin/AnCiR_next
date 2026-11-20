// AncirSession — a headless wrapper around AnCiR's real engine.
//
// This deliberately reuses AnCiR's own modules (no re-implementation of the
// science): columns live in the real `core` store, analyses are run through the
// table-process functions exported by the AnCiR Svelte modules, and sessions are
// serialised with AnCiR's own `outputCoreAsJson()` so the resulting file opens
// directly in the AnCiR GUI.
//
// NOTE: AnCiR's `core` is a module-level singleton, so one process holds exactly
// one active session. Multi-session isolation is achieved at a higher level by
// running a session per process/page (see README — this mirrors the eventual
// "page per session" browser-rendering design).

import { core, appConsts, pushObj, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { Column, getColumnById, removeColumn, resetColumnIdCounter } from '$lib/core/Column.svelte';
import { TableProcess, resetTableProcessIdCounter } from '$lib/core/TableProcess.svelte';
import { Plot, resetPlotIdCounter } from '$lib/core/Plot.svelte';
import { resetProcessIdCounters } from '$lib/core/Process.svelte';
import { resetOverlayIdCounter } from '$lib/components/plotbits/Overlay.svelte';
import { seriesChannelRefs } from '$lib/core/seriesChannelRefs.js';
import { evaluateCosinor } from '$lib/tableProcesses/Cosinor.svelte';
import {
	getOutputKeys as rhythmicityOutputKeys,
	getStatKeys as rhythmicityStatKeys
} from '$lib/tableProcesses/RhythmicityAnalysis.svelte';
import { getStatKeys as movingStatKeys } from '$lib/tableProcesses/MovingAnalysis.svelte';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';
import { buildTableProcessDefaults } from '$lib/core/tpDefaults.js';
import { applyAutoPeriodRange } from '$lib/tableProcesses/periodRangeAuto.svelte.js';
import { applyAutoBinSize } from '$lib/tableProcesses/binSizeAuto.svelte.js';
import { applyAutoUnit } from '$lib/tableProcesses/unitAuto.svelte.js';
import { joinOutKeys } from '$lib/utils/joinPairing.js';
import { timeZoneSource, readsWallClockText } from '$lib/core/columnTimeZone.js';
import { columnRefParamsOf } from '$lib/core/columnRefParams.js';
// A time column's text format and zone, read and refused exactly as a draft's are (pure).
import { timeTextFormat, columnZoneOf } from '../emit/timeColumns.js';
import { joinNameOf } from '$lib/tableProcesses/JoinData.svelte';
import { loadProcesses } from '$lib/processes/processMap.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import {
	resolvePlotInputs,
	plotInputIds,
	mapPlotInputIds,
	plotSeriesDataIns,
	assertSeriesKept,
	plotInputAliases
} from './plotInputs.js';
import { manifestPortDescription, PLOT_PORT_DESCRIPTIONS } from '$lib/core/portDescriptions.js';
import { loadSelectOptions, assertSelectOptions } from './paramOptions.js';
import { refusesInputType, inputTypeRefusal } from '$lib/core/processInputRules.js';
import { plotWarnings } from '../render/payloadColumn.js';
import {
	normalizeOverlaySpecs,
	applyOverlays,
	overlayColumnIds,
	remapOverlayColumnIds,
	describeOverlayForms,
	overlayDomainAxes,
	unsupportedOverlaysError
} from './overlays.js';
import {
	plotEncodingFields,
	applyPlotEncodingFields,
	plotEncodingSummary,
	encodingPlotSchemas
} from './encodings.js';

// Column-id fields per arg (numeric or array of numerics) used to enumerate the Y
// inputs that drive dynamic output keys.
function yIdsOf(args) {
	const y = args?.yIN;
	const list = Array.isArray(y) ? y : y != null && y !== -1 ? [y] : [];
	return [...new Set(list.map(Number).filter((id) => id >= 0))];
}
const seedKeys = (keys) => Object.fromEntries(keys.map((k) => [k, -1]));

// Resolve a column reference to a numeric id. Accepts a number, a numeric string,
// or a column NAME — LLMs track names far more reliably than 0-based numeric ids,
// so every column-id argument (xIN/yIN/colIds/outputX/plot inputs/…) accepts either.
// A name two columns share is refused with the candidates, never resolved to the first.
function resolveColRef(ref) {
	if (typeof ref === 'number') return ref;
	if (typeof ref === 'string') {
		const t = ref.trim();
		if (/^-?\d+$/.test(t)) return Number(t);
		const matches = core.data.filter((c) => c.name === ref);
		if (matches.length === 1) return matches[0].id;
		if (matches.length > 1) {
			const ids = matches.map((c) => `${c.id} (${c.type})`).join(', ');
			throw new Error(
				`Column name "${ref}" is ambiguous: ${matches.length} columns have it, ids ${ids}. Pass the id instead.`
			);
		}
		const names = core.data.map((c) => c.name).join(', ');
		throw new Error(
			`No column named "${ref}". Available: ${names || '(none)'}. Call list_columns.`
		);
	}
	return ref;
}

// resolveColRef, then require the column to exist: the check every plot input and overlay
// wire gets (add_plot and render_plot alike).
function assertColumnRef(ref) {
	const id = resolveColRef(ref);
	if (!getColumnById(id)) throw new Error(`No column with id ${id}. Call list_columns.`);
	return id;
}

/**
 * Compute the `out` keys for table processes whose outputs depend on inputs/params
 * (so the caller never has to hand-seed them). Mirrors each process's own GUI
 * reconcile logic; the two suffix lists come straight from the processes' exported
 * key helpers, so they can't drift. Returns null for fixed-output processes.
 */
function synthesizeDynamicOut(name, args) {
	switch (name) {
		case 'RhythmicityAnalysis': {
			const ks = rhythmicityOutputKeys(args); // periodogram→[period,power], fft→…, etc.
			const ys = yIdsOf(args);
			// The scalar-metric ports the node adds in standalone mode (syncOutputColumns): one
			// `stat_<key>` column per stat of the analysis (peak period/power/p, peak lag and
			// correlation, …), one value per y in yIN order. Only when a y is wired, as the node.
			const stats = ys.length ? rhythmicityStatKeys(args).map((k) => `stat_${k}`) : [];
			return seedKeys([...ys.flatMap((y) => ks.map((k) => `${y}_${k}`)), ...stats]);
		}
		case 'MovingAnalysis': {
			const ks = movingStatKeys(args); // [peak_period, peak_power] | fft/corr variants
			return seedKeys(['movex', ...yIdsOf(args).flatMap((y) => ks.map((k) => `${y}_${k}`))]);
		}
		case 'Split': {
			const segs = (Array.isArray(args.splitTimes) ? args.splitTimes.length : 0) + 1;
			return seedKeys(
				yIdsOf(args).flatMap((y) => Array.from({ length: segs }, (_, i) => `${y}_${i + 1}`))
			);
		}
		case 'CollectColumns':
			return seedKeys((args.colIds ?? []).map((c) => `col_${c}`));
		case 'StoredValueGroup':
			return seedKeys((args.groups ?? []).map((g) => `group_${g.id}`));
		case 'Duplicate':
			return seedKeys(['result']);
		case 'JoinData': {
			// Same-named value columns share one output (utils/joinPairing.js), so the keys
			// follow the columns' names, read the way the node reads them (display names).
			return seedKeys(joinOutKeys(args, joinNameOf()));
		}
		case 'LongToWide': {
			const cat = args.categoryIN;
			const col = cat != null && cat !== -1 ? getColumnById(cat) : null;
			let cats = [];
			if (col) {
				try {
					cats = [...new Set(col.getData() ?? [])];
				} catch {
					cats = [];
				}
			}
			return seedKeys(['time', ...cats.map((c) => `value_${c}`)]);
		}
		default:
			return null;
	}
}

/**
 * The per-y output keys of a node's extra per-y families: every many-port its nodeSpec declares
 * with a `dynamicPrefix` that is not a metric and not the constructor's own `yOutKeyPrefix`
 * family, on a node that has per-y outputs at all (`yOutKeyPrefix`), one `<prefix><yId>` per
 * wired y. Nodes whose keys synthesizeDynamicOut builds (a dual-mode node's collected family)
 * are left to it.
 */
function perYFamilyKeys(entry, args) {
	const yPrefix = entry.yOutKeyPrefix;
	if (!yPrefix || DYNAMIC_OUT_NODES.has(entry.definition?.nodeSpec?.id)) return [];
	const prefixes = (entry.definition?.nodeSpec?.outputs ?? [])
		.filter((o) => o.cardinality === 'many' && o.dynamicPrefix && !o.metric)
		.map((o) => o.dynamicPrefix)
		.filter((pre) => pre !== yPrefix);
	return yIdsOf(args).flatMap((y) => prefixes.map((pre) => `${pre}${y}`));
}
// Nodes whose dynamic keys come from synthesizeDynamicOut (by nodeSpec id).
const DYNAMIC_OUT_NODES = new Set([
	'tableprocess.rhythmicityanalysis',
	'tableprocess.movinganalysis'
]);

// The node registry (every table-process `definition`, every column process, every
// plot) is loaded once per process and cached on `appConsts`, mirroring the GUI's
// startup in routes/+page.svelte. Lazy so that tools which don't need it (e.g.
// run_cosinor, which imports its func directly) keep working even if a glob hiccups.
let registryLoaded = false;
export async function ensureRegistry() {
	if (registryLoaded) return;
	appConsts.tableProcessMap = await loadTableProcesses();
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	// The legal values of every select param, read from the nodes' markup (paramOptions.js).
	await loadSelectOptions();
	registryLoaded = true;
}

// Structural arg keys that are wiring/bookkeeping, not user-facing parameters.
const STRUCTURAL_ARG_KEYS = new Set([
	'out',
	'valid',
	'forcollected',
	'collectedType',
	'preProcesses',
	'tableProcesses'
]);

/**
 * What each port expects or produces (core/portDescriptions.js, the text the canvas tooltips
 * show), keyed by the nodeSpec port name. Only the detail views carry it (detail:"full" or
 * name:), so the default summary, and every prompt built from it, stays the same size.
 */
function describePorts(kind, name, nodeSpec) {
	const map = (ports, dir) =>
		Object.fromEntries(
			(ports ?? [])
				.map((p) => [p.name, manifestPortDescription(kind, name, p.name, dir)])
				.filter(([, d]) => d)
		);
	return { inputs: map(nodeSpec?.inputs, 'in'), outputs: map(nodeSpec?.outputs, 'out') };
}

/**
 * Derive the agent-facing capability catalogue directly from the loaded registry,
 * so every AnCiR analysis appears automatically (no hand-maintained list). Each
 * table-process `definition` carries its input fields (`columnIdFields`), parameter
 * defaults (`defaults`), and output template (`defaults.out`); we surface those.
 */
export function describeCapabilities() {
	const analyses = [];
	for (const [name, entry] of appConsts.tableProcessMap ?? new Map()) {
		const cif = entry.columnIdFields ?? {};
		const inputFields = [...(cif.scalar ?? []), ...(cif.array ?? [])];
		const skip = new Set([...STRUCTURAL_ARG_KEYS, ...inputFields]);

		const params = {};
		for (const [k, v] of entry.defaults ?? new Map()) {
			if (skip.has(k)) continue;
			params[k] = v && typeof v === 'object' && 'val' in v ? v.val : v;
		}

		// Output template: keys the process writes columns to. Some processes add
		// per-input/per-Y output keys at run time (dynamicOutputs); for those the
		// caller must pass an explicit `out` seed (see run_table_process).
		const outTemplate = entry.defaults?.get?.('out');
		const outKeys = outTemplate ? Object.keys(outTemplate) : [];
		const dynamicOutputs = Boolean(entry.yOutKeyPrefix) || outKeys.length === 0;

		analyses.push({
			id: name,
			displayName: entry.displayName,
			family: entry.family ?? 'Other',
			status: 'available',
			summary: entry.description ?? '',
			inputs: { scalar: cif.scalar ?? [], array: cif.array ?? [] },
			params,
			outKeys,
			dynamicOutputs,
			ports: describePorts('tableProcess', name, entry.nodeSpec)
		});
	}
	analyses.sort(
		(a, b) => (a.family || '').localeCompare(b.family || '') || a.id.localeCompare(b.id)
	);

	// Column transforms (column processes): attached to a column with add_column_process.
	const transforms = [];
	for (const [name, entry] of appConsts.processMap ?? new Map()) {
		const params = {};
		for (const [k, v] of entry.defaults ?? new Map()) {
			params[k] = v && typeof v === 'object' && 'val' in v ? v.val : v;
		}
		transforms.push({
			id: name,
			displayName: entry.displayName,
			family: entry.family ?? 'Transform',
			status: 'available',
			summary: entry.description ?? '',
			params,
			ports: describePorts('process', name, entry.nodeSpec)
		});
	}
	transforms.sort((a, b) => a.id.localeCompare(b.id));

	// Plots: created with add_plot (wired into the session, renders in the GUI) and
	// optionally rasterised to PNG/SVG with render_plot (needs a browser runtime).
	const plots = [];
	const encodingSchemas = encodingPlotSchemas();
	for (const [id, entry] of appConsts.plotMap ?? new Map()) {
		const overlayCaps = entry.data?.overlayCapabilities;
		const encodingCaps = encodingSchemas[id]?.encodings;
		plots.push({
			id,
			displayName: entry.displayName,
			inputs: entry.defaultInputs ?? [],
			ports: {
				inputs: Object.fromEntries(
					(entry.defaultInputs ?? []).map((f) => [f, manifestPortDescription('plot', id, f, 'in')])
				),
				outputs: Object.fromEntries(
					Object.keys(PLOT_PORT_DESCRIPTIONS[id]?.outputs ?? {})
						.filter((k) => k !== '*')
						.map((k) => [k, manifestPortDescription('plot', id, k, 'out')])
				)
			},
			// The other pair of names a two-input plot takes ({time, values} on a cwt).
			inputAliases: plotInputAliases(entry.defaultInputs ?? []),
			status: 'available — add_plot (session); render_plot for PNG/SVG',
			// Reference lines / shaded bands (add_plot / render_plot `overlays`): the forms the
			// class declares in `overlayCapabilities`, so a plot that gains them is advertised
			// without editing a list, and the axes whose automatic range widens to fit them (a
			// periodogram never widens its period range; a mark outside it is not drawn).
			// `overlayNote`: how the plot reads an x position when that is not the axis as shown
			// (an fft takes vertical positions as periods in hours, also on its frequency axis).
			...(overlayCaps
				? {
						overlays: describeOverlayForms(overlayCaps),
						overlayAxes: overlayDomainAxes(overlayCaps),
						...(overlayCaps.xNote ? { overlayNote: overlayCaps.xNote } : {})
					}
				: {}),
			// Colour by / Size by (add_plot `colourBy` / `sizeBy`): what the class declares in
			// `encodingCapabilities`; `lines`: its line can be coloured too (`colourLine`).
			...(encodingCaps ? { encodings: encodingCaps } : {})
		});
	}
	plots.sort((a, b) => a.id.localeCompare(b.id));

	return { analyses, transforms, plots };
}

/**
 * Project a full describeCapabilities() result down to what a caller actually asked for, so the
 * discovery tool doesn't return the entire schema (37 analyses × params/defaults/outputs + plots)
 * on every call — it was the single largest payload a session sees. Pure; the server passes the
 * tool args straight through.
 *
 *   detail: "names"   → id (+ family) only — pure discovery.
 *           "summary" → id, family, one-line summary, input FIELD NAMES, param NAMES (no defaults).
 *                       The DEFAULT: enough to pick a node and know what it needs; the engine fills
 *                       param defaults at run time, so a caller rarely needs the values to run.
 *           "full"    → everything (params + defaults, outKeys, dynamicOutputs) — what you need to
 *                       hand-write a run_table_process call.
 *   family: narrow analyses/transforms to one family (e.g. "Fitting"); plots have none, so drop them.
 *   name:   return the ONE matching capability at FULL detail (the describe-one case) — cheaper than
 *           a full dump when you know the node and just need its exact schema.
 */
export function filterCapabilities(full, { detail = 'summary', family = null, name = null } = {}) {
	const fam = family ? String(family).toLowerCase() : null;
	const nm = name ? String(name).toLowerCase() : null;

	if (nm) {
		const all = [
			...full.analyses.map((x) => ['analysis', x]),
			...full.transforms.map((x) => ['transform', x]),
			...full.plots.map((x) => ['plot', x])
		];
		const hit = all.find(([, x]) => x.id.toLowerCase() === nm);
		return hit
			? { kind: hit[0], capability: hit[1] }
			: {
					capability: null,
					error: `No capability named "${name}". Call list_capabilities for names.`
				};
	}

	const projAnalysis = (x) =>
		detail === 'names'
			? { id: x.id, family: x.family }
			: detail === 'full'
				? x
				: {
						id: x.id,
						family: x.family,
						summary: x.summary,
						inputs: x.inputs,
						params: Object.keys(x.params),
						dynamicOutputs: x.dynamicOutputs
					};
	const projTransform = (x) =>
		detail === 'names'
			? { id: x.id, family: x.family }
			: detail === 'full'
				? x
				: { id: x.id, family: x.family, summary: x.summary, params: Object.keys(x.params) };
	// The summary keeps each overlay host's kinds and forms (the first form of a kind is the
	// default), the axes overlays widen and any note on how positions are read (it changes
	// what a typed value means); "full" adds the channel table per form.
	const overlaySummary = (x) =>
		x.overlays
			? {
					overlays: Object.fromEntries(
						Object.entries(x.overlays).map(([kind, forms]) => [kind, Object.keys(forms)])
					),
					overlayAxes: x.overlayAxes,
					...(x.overlayNote ? { overlayNote: x.overlayNote } : {})
				}
			: {};
	const projPlot = (x) =>
		detail === 'names'
			? { id: x.id }
			: detail === 'full'
				? x
				: {
						id: x.id,
						inputs: x.inputs,
						...overlaySummary(x),
						...(x.encodings ? { encodings: x.encodings } : {})
					};

	let A = full.analyses,
		T = full.transforms,
		P = full.plots;
	if (fam) {
		A = A.filter((x) => (x.family || '').toLowerCase() === fam);
		T = T.filter((x) => (x.family || '').toLowerCase() === fam);
		P = []; // plots carry no family, so a family filter excludes them
	}
	return {
		detail,
		analyses: A.map(projAnalysis),
		transforms: T.map(projTransform),
		plots: P.map(projPlot)
	};
}

function resetCore() {
	// Mirror the slices the GUI's importJson resets. NB: the `Table` class /
	// `core.tables` was removed in the 2026-06 migration — columns are now a flat
	// list in core.data and table processes are free-standing in core.tableProcesses.
	// The id counters restart too (the store is empty, so no id is held): a fresh session's
	// ids, and the output names built from them (`mesor_<tableProcessId>`), then depend only
	// on what this session does, not on the sessions built earlier in the same process.
	resetColumnIdCounter();
	resetTableProcessIdCounter();
	resetPlotIdCounter();
	resetProcessIdCounters();
	resetOverlayIdCounter();
	core.rawData.clear();
	core.data.length = 0;
	core.plots.length = 0;
	core.tableProcesses.length = 0;
	core.groups.length = 0;
	core.notes.length = 0;
	core.orphanProcesses.length = 0;
	for (const k of Object.keys(core.nodeNotes)) delete core.nodeNotes[k];
	for (const k of Object.keys(core.storedValues)) delete core.storedValues[k];
}

// Plot input fields that are genuinely optional; every OTHER field in a plot's defaultInputs is
// required to produce a usable plot. Only the circular-phase plot's time axis is optional today
// (the phase/angle `values` are still required). Keyed by the plot registry type (folder name,
// lowercased). New plots therefore have ALL their inputs required by default — the safe direction.
const OPTIONAL_PLOT_INPUTS = { circularphase: ['time'] };

/** Short, safe description of a rejected value for error messages. */
function badValueDesc(v) {
	if (typeof v === 'number') return String(v); // NaN, Infinity, -Infinity
	if (typeof v === 'string') return JSON.stringify(v.length > 20 ? v.slice(0, 20) + '…' : v);
	if (Array.isArray(v)) return `array(${v.length})`;
	if (typeof v === 'object') return 'object';
	return typeof v;
}

/**
 * Reject values that can't legitimately belong to a column of `type` before they enter
 * core.rawData. The engine is otherwise trusting — a bare Array.isArray check let Infinity, NaN,
 * '' and arbitrary objects into an alleged numeric column, surfacing later as opaque analysis or
 * plotting failures. Missing values are represented as `null` (isInvalidValue's canonical token;
 * `undefined` is accepted as missing too). Shared by every importColumns caller, including the
 * worker's import_data handler, which delegates here.
 *
 * @param {string} name
 * @param {string} type  'number' | 'category' | 'time'
 * @param {any[]} values
 */
export function validateColumnValues(name, type, values) {
	const t = type ?? 'number';
	for (let i = 0; i < values.length; i++) {
		const v = values[i];
		if (v === null || v === undefined) continue; // missing — always allowed
		if (t === 'number') {
			if (typeof v !== 'number' || !Number.isFinite(v)) {
				throw new Error(
					`Column "${name}" (number) has an invalid value at index ${i}: ${badValueDesc(v)}. ` +
						`Numeric columns accept finite numbers or null (missing); NaN, Infinity, strings and objects are rejected.`
				);
			}
		} else if (typeof v === 'object' || typeof v === 'function' || typeof v === 'symbol') {
			throw new Error(
				`Column "${name}" (${t}) has a non-primitive value at index ${i}: ${badValueDesc(v)}. ` +
					`${t} columns accept strings/numbers or null (missing).`
			);
		}
	}
}

/**
 * The reasons an invalid result gives, when the process states them (GroupComparison gives one
 * per y: "Need at least 2 groups with data for comparison."), so a refusal says what to change.
 * @param {any} r the process's first result
 * @returns {string[]}
 */
function invalidReasons(r) {
	if (!r || typeof r !== 'object' || Array.isArray(r)) return [];
	const out = [];
	for (const k of ['reason', 'error']) if (typeof r[k] === 'string' && r[k]) out.push(r[k]);
	// The warnings the node shows beside a refused result (a log fit refused for x <= 0 says
	// so there), so the engine's refusal carries the same explanation.
	for (const w of Array.isArray(r.warnings) ? r.warnings : [])
		if (typeof w === 'string' && w) out.push(w);
	for (const c of Object.values(r.comparisons ?? {})) {
		if (c && c.valid === false && typeof c.reason === 'string') {
			out.push(c.columnName ? `${c.columnName}: ${c.reason}` : c.reason);
		}
	}
	return [...new Set(out.map((w) => w.trim().replace(/\.+$/, '')))];
}

/** Remove a table process and its output columns from the engine state. */
export function discardTableProcess(tp) {
	const outIds = Object.values(tp?.args?.out ?? {}).filter(
		(id) => typeof id === 'number' && id >= 0
	);
	core.tableProcesses = core.tableProcesses.filter((t) => t.id !== tp.id);
	for (const id of outIds) {
		try {
			removeColumn(id);
		} catch {
			/* already gone */
		}
	}
}

/**
 * Read a (valid) table process's output columns into the report shape. Prunes columns the process
 * left empty — dual-mode processes (RhythmicityAnalysis, MovingAnalysis) pre-allocate a
 * collected-mode column that stays empty in the standalone path the MCP uses — but a column whose
 * getData() THROWS is a genuine failure, not an empty output: surfacing it as `valid: false` with
 * the failed key + original error keeps a broken process chain from reporting success with
 * silently-missing outputs.
 *
 * @param {import('$lib/core/TableProcess.svelte').TableProcess} tp
 * @param {string} name
 * @param {{fit?:any, stats?:any, warnings?:string[]}} [extra]
 */
export function finalizeTableProcessOutputs(
	tp,
	name,
	{ fit = null, stats = null, warnings = [] } = {}
) {
	const failed = [];
	const failure = () => {
		discardTableProcess(tp);
		return {
			name,
			tableProcessId: tp.id,
			valid: false,
			error: `${name}: reading output column${failed.length > 1 ? 's' : ''} ${failed
				.map((f) => `"${f.key}"`)
				.join(', ')} threw — the process chain is broken: ${failed[0].error}`,
			failedOutputs: failed,
			outputs: []
		};
	};

	// Prune empty output columns; a THROW here is a hard failure, not an empty column.
	for (const [key, colId] of Object.entries(tp.args.out ?? {})) {
		if (typeof colId !== 'number' || colId < 0) continue;
		const col = getColumnById(colId);
		let len;
		try {
			len = (col?.getData() ?? []).length;
		} catch (err) {
			failed.push({ key, columnId: colId, error: err?.message ?? String(err) });
			continue;
		}
		if (len === 0) {
			delete tp.args.out[key];
			if (col) removeColumn(colId);
		}
	}
	if (failed.length) return failure();

	const outputs = [];
	for (const [key, colId] of Object.entries(tp.args.out ?? {})) {
		if (typeof colId !== 'number' || colId < 0) continue;
		const col = getColumnById(colId);
		if (!col) continue;
		let data;
		try {
			data = col.getData() ?? [];
		} catch (err) {
			// The prune pass already read every column, so a throw here means the column changed
			// under us — still surface it rather than reporting an empty output.
			failed.push({ key, columnId: colId, error: err?.message ?? String(err) });
			continue;
		}
		outputs.push({
			key,
			columnId: colId,
			name: col.name,
			type: col.type,
			length: data.length,
			preview: data.slice(0, 8)
		});
	}
	if (failed.length) return failure();

	const result = { name, tableProcessId: tp.id, valid: true, outputs };
	if (fit) result.fit = fit;
	if (warnings.length) result.warnings = warnings;
	// Statistics: GroupComparison exposes them as `comparisons` (alongside its statistic/pvalue
	// output columns), so surface them regardless of columns; other column-less processes only
	// when they produced no columns.
	if (stats && (stats.comparisons || outputs.length === 0)) result.stats = stats;
	return result;
}

/**
 * A time column's zone as list_columns reports it, read from the app's own rules
 * (core/columnTimeZone.js): `time_zone` ('utc', '+12:00' or an IANA name), `times` (how the
 * stored times relate to it: 'as written' = text with no zone kept in UTC, 'wall clock' = text
 * with no zone read in its zone, 'instants' = epoch ms or text with offsets), and `zone_from`
 * when an output inherits it. Empty for a column that is not a time column.
 */
function columnZoneInfo(col) {
	if (col?.type !== 'time') return {};
	const frame = col.timeFrame;
	const src = timeZoneSource(col);
	const times = frame.wall
		? 'as written'
		: src && readsWallClockText(src)
			? 'wall clock'
			: 'instants';
	return {
		time_zone: frame.zone,
		times,
		...(src && src !== col ? { zone_from: src.name } : {})
	};
}

/**
 * Fill every param a caller left out of a table process's args, as the app does when the
 * palette or its in-app AI edit adds a node (utils/aiEdit.js: `{ ...buildTableProcessDefaults
 * (entry, params), ...params, ...inputs }`): the registry defaults (unwrapped, objects deep
 * copied), plus the definition's `newNodeArgs` (the free-period fits' `periodRangeAuto`, the
 * binned periodograms' `pgBinSizeAuto`, the Rayleigh test's `unitAuto`). The node's component
 * then resolves those from its inputs when it mounts (periodRangeAuto.svelte.js,
 * binSizeAuto.svelte.js, unitAuto.svelte.js); headless nothing mounts, so the same functions
 * run here once the inputs are resolved: a time x gets 1 to 30 h, a number x the Nyquist period
 * to the record span, the bin size the median sampling interval, and a Rayleigh test called
 * without a `unit` the unit its angle columns are most likely in (utils/angleUnit.js).
 *
 * A supplied value always wins. An explicit `null` counts as omitted, as in the Worker's draft
 * normalizer (src/emit/normalizer.js), so `binStart: null` gets the default rather than a node
 * that cannot run. `out` is left alone (runTableProcess seeds it). Mutates and returns `args`.
 *
 * @param {object} entry a tableProcessMap registry entry
 * @param {object} args the caller's args, inputs already resolved to column ids
 * @returns {object} args
 */
export function fillOmittedArgs(entry, args) {
	const explicit = { ...args };
	const defaults = buildTableProcessDefaults(entry, explicit);
	for (const [k, v] of Object.entries(defaults)) {
		if (k === 'out') continue;
		// A copy: buildTableProcessDefaults hands out the registry's own objects (yIN: []).
		if (args[k] == null) args[k] = v !== null && typeof v === 'object' ? structuredClone(v) : v;
	}
	const xCol = Number.isInteger(args.xIN) && args.xIN >= 0 ? getColumnById(args.xIN) : null;
	if (xCol) {
		applyAutoPeriodRange(args, xCol);
		applyAutoBinSize(args, xCol);
	}
	if (args.unitAuto) {
		const yCols = (Array.isArray(args.yIN) ? args.yIN : [args.yIN])
			.filter((id) => Number.isInteger(id) && id >= 0)
			.map((id) => getColumnById(id))
			.filter(Boolean);
		const timed = Number.isInteger(args.timeIN) && args.timeIN >= 0 && !!getColumnById(args.timeIN);
		applyAutoUnit(args, yCols, timed);
	}
	return args;
}

// The session that owns `core` now. `core` is a module singleton, so creating a session empties
// it: every earlier session in the process is superseded and refuses further use, rather than
// silently reading or exporting the newer session's columns as its own.
let activeSession = null;
// Async engine calls (runTableProcess, runCosinor, renderPlotToFiles) still running. While one
// is, creating a session is refused: it would empty the store and restart the id counters under
// the running call, which then wrote its outputs over the new session's columns.
let inFlight = 0;

export class AncirSession {
	constructor(id = 'default') {
		if (inFlight > 0) {
			throw new Error(
				`Cannot create AnCiR session "${id}": ${inFlight} call${inFlight > 1 ? 's' : ''} of session ` +
					`"${activeSession?.id}" ${inFlight > 1 ? 'are' : 'is'} still running. Await ${inFlight > 1 ? 'them' : 'it'} ` +
					`first (one process holds one session; the engine's store is a singleton).`
			);
		}
		this.id = id;
		resetCore();
		activeSession = this;
	}

	/** Run an async engine call, counted as in flight until it settles. */
	async _inFlight(fn) {
		this._assertActive();
		inFlight++;
		try {
			return await fn();
		} finally {
			inFlight--;
		}
	}

	/** Throw when a newer session has taken over the process's single store. */
	_assertActive() {
		if (activeSession === this) return;
		throw new Error(
			`AnCiR session "${this.id}" was superseded by session "${activeSession?.id}": one process ` +
				`holds one session (the engine's store is a singleton), and creating a session empties ` +
				`it. Finish and export a session before creating the next, or run each session in its ` +
				`own process (SessionManager).`
		);
	}

	/**
	 * Import columns of data into the session.
	 *
	 * A time column takes epoch ms or ISO 8601 text (given the format the app reads it with), and
	 * an optional `time_zone`: where its clock was (per-column time zone). It is stored as the
	 * app's import stores it (none for 'utc'), so text with no offset is read in that zone and
	 * epoch ms or text with offsets keep their instants with the zone naming their clock.
	 * @param {Array<{name:string,type?:string,values:Array<number|string|null>,time_zone?:string}>} cols
	 * @returns {Array<{id:number,name:string,type:string,time_zone?:string}>}
	 */
	importColumns(cols) {
		this._assertActive();
		// Validate EVERY column up-front so a bad value in a later column doesn't leave the earlier
		// ones half-imported. Bad data (Infinity, NaN, strings in a numeric column, arbitrary
		// objects) is rejected at the door rather than causing opaque failures downstream. This is
		// the single validation point for every caller — direct engine, the stdio Zod tool, and the
		// worker's import_data handler (worker.js), which all delegate here.
		for (const c of cols) {
			if (!Array.isArray(c.values)) {
				throw new Error(`Column "${c.name}" must provide a numeric "values" array.`);
			}
			validateColumnValues(c.name ?? 'unnamed', c.type, c.values);
		}
		const time = new Map(); // column → { format, zone }
		for (const c of cols) {
			const zone = columnZoneOf(c);
			if (zone.error) throw new Error(zone.error);
			if ((c.type ?? 'number') !== 'time') continue;
			const fmt = timeTextFormat(c.name ?? 'unnamed', c.values);
			if (fmt.error) throw new Error(fmt.error);
			time.set(c, { format: fmt.format, zone: zone.zone });
		}
		const added = [];
		for (const c of cols) {
			// The id comes from the app's own column counter (id: null), the one every output
			// column a table process or the app creates also takes, so it can never repeat one.
			// A session-local counter here once handed an imported column the id of an analysis
			// output, and later analyses silently read the wrong column.
			const t = time.get(c);
			const col = Column.fromJSON({
				id: null,
				type: c.type ?? 'number',
				...(c.name != null ? { name: c.name } : {}),
				...(t?.format ? { timeFormat: t.format } : {}),
				...(t?.zone ? { timeZone: t.zone } : {}),
				processes: []
			});
			if (c.name == null) col.name = `col_${col.id}`;
			// Raw values are keyed by the column's id, as the app stores an imported column's.
			col.data = col.id;
			core.rawData.set(col.id, c.values.slice());
			pushObj(col);
			added.push({
				id: col.id,
				name: col.name,
				type: col.type,
				...(col.type === 'time' ? { time_zone: col.timeZone ?? 'utc' } : {})
			});
		}
		return added;
	}

	listColumns() {
		this._assertActive();
		return core.data.map((c) => {
			let length = 0;
			try {
				length = (c.getData() || []).length;
			} catch {
				length = 0;
			}
			return { id: c.id, name: c.name, type: c.type, length, ...columnZoneInfo(c) };
		});
	}

	getColumnData(id) {
		this._assertActive();
		const col = core.data.find((c) => c.id === id);
		return col ? col.getData() : null;
	}

	/**
	 * Run a cosinor (circadian rhythm) fit using AnCiR's real table-process code.
	 * @param {object} opts
	 * @param {number} opts.x - column id for the time/x axis (numeric hours or a 'time' column)
	 * @param {number|number[]} opts.y - one or more column ids to fit
	 * @param {boolean} [opts.useFixedPeriod=true]
	 * @param {number}  [opts.fixedPeriod=24]
	 * @param {number}  [opts.nHarmonics=1]
	 * @param {number}  [opts.Ncurves=1]   - used when useFixedPeriod is false
	 * @param {number}  [opts.alpha=0.05]
	 */
	runCosinor(opts) {
		return this._inFlight(() => this._runCosinor(opts));
	}

	async _runCosinor({
		x,
		y,
		useFixedPeriod = true,
		fixedPeriod = 24,
		nHarmonics = 1,
		Ncurves = 1,
		alpha = 0.05
	}) {
		const yIN = Array.isArray(y) ? y : [y];
		// evaluateCosinor is async (it may dispatch large fits to the worker pool).
		const [result, valid] = await evaluateCosinor({
			xIN: x,
			yIN,
			Ncurves,
			outputX: -1,
			useFixedPeriod,
			fixedPeriod,
			nHarmonics,
			alpha,
			out: { cosinorx: -1 },
			preProcesses: []
		});
		this._assertActive();

		if (!valid) return { valid: false, results: [] };

		const results = yIN.map((yId) => {
			const r = result.y_results[yId];
			if (!r) return { y: yId, valid: false };
			const out = {
				y: yId,
				valid: true,
				rmse: r.fittedData.rmse,
				rSquared: r.fittedData.rSquared
			};
			if (r.fixedStats) {
				out.mesor = r.fixedStats.M;
				out.harmonics = (r.fixedStats.harmonics ?? []).map((h) => ({
					k: h.k,
					amplitude: h.amplitude,
					acrophase_rad: h.acrophase_rad ?? h.phi_rad
				}));
			} else {
				out.cosines = (r.fittedData.parameters?.cosines ?? []).map((c) => ({
					amplitude: c.amplitude,
					frequency: c.frequency,
					period: c.frequency ? (2 * Math.PI) / c.frequency : null,
					phase: c.phase ?? c.acrophase
				}));
			}
			return out;
		});

		return { valid: true, results };
	}

	/**
	 * Run any AnCiR table process by name, using the *real* registry `func` and the
	 * same construction path the GUI uses (TableProcess allocates output columns and
	 * runs the process). The resulting analysis node + its output columns are added
	 * to the session, so a subsequent export_session opens in the GUI with the
	 * analysis already present and wired.
	 *
	 * @param {string} name  Table-process id (see list_capabilities, e.g. 'Cosinor').
	 * @param {object} args  Full args object: input column ids (e.g. xIN/yIN) + params.
	 *   `out` is optional — for fixed-output processes it is auto-seeded from the
	 *   process definition; processes with dynamic output keys (yOutKeyPrefix or an
	 *   empty out template, e.g. Split/RhythmicityAnalysis/CollectColumns) require an
	 *   explicit `out` seed mapping each output key to -1.
	 * @returns {{name:string, tableProcessId:number, valid:boolean,
	 *   outputs:Array<{key:string,columnId:number,name:string,type:string,length:number,preview:number[]}>}}
	 */
	runTableProcess(name, args = {}) {
		return this._inFlight(() => this._runTableProcess(name, args));
	}

	async _runTableProcess(name, args) {
		const entry = appConsts.tableProcessMap?.get(name);
		if (!entry) {
			const known = [...(appConsts.tableProcessMap?.keys() ?? [])].join(', ');
			throw new Error(
				`Unknown table process "${name}". Available: ${known || '(registry not loaded)'}.`
			);
		}

		// Clone so we never mutate the caller's object; auto-seed `out` when omitted.
		const a = structuredClone(args);

		// Tolerate a common LLM mistake: the real args nested under `params`/`inputs`
		// (no table process uses those as real arg keys, so flattening them is safe).
		for (const wrapper of ['params', 'inputs']) {
			const w = a[wrapper];
			if (w && typeof w === 'object' && !Array.isArray(w)) {
				for (const [k, v] of Object.entries(w)) if (a[k] == null) a[k] = v;
				delete a[wrapper];
			}
		}

		// A select param must hold a value the node offers: one it does not (`"Periodogram"`
		// for "periodogram") matched none of the node's branches and ran to no outputs.
		assertSelectOptions('tableProcess', name, a, entry.defaults);

		// Resolve column references (numbers, numeric strings, OR column names) to ids
		// for this process's input fields, before out-synthesis/construction.
		const cif = entry.columnIdFields ?? {};
		// An input field the node does not have (`groupIN` on GroupComparison, whose group input
		// is `xIN`) used to be ignored, so the node ran unwired and reported only "no valid result".
		const inputFields = [...(cif.scalar ?? []), ...(cif.array ?? [])];
		const strayInputs = Object.keys(a).filter(
			(k) => /IN$/.test(k) && !inputFields.includes(k) && !entry.defaults?.has?.(k)
		);
		if (strayInputs.length) {
			throw new Error(
				`${name} has no input ${strayInputs.map((k) => `"${k}"`).join(', ')}. Its input fields are ` +
					`${inputFields.join(', ') || '(none)'}; call list_capabilities with name "${name}" for what each takes.`
			);
		}
		try {
			for (const f of cif.scalar ?? []) if (a[f] != null) a[f] = resolveColRef(a[f]);
			// Array fields (e.g. yIN): coerce a bare scalar to a 1-element array — LLMs
			// often pass yIN:"values_0" where yIN:["values_0"] is required — then resolve.
			for (const f of cif.array ?? []) {
				if (a[f] == null) continue;
				a[f] = (Array.isArray(a[f]) ? a[f] : [a[f]]).map(resolveColRef);
			}
			// Params that name a column without being a port (a fit's outputX, Sort's sortOnId).
			const params = [...(entry.defaults?.keys?.() ?? [])];
			for (const f of columnRefParamsOf(params)) if (a[f] != null) a[f] = resolveColRef(a[f]);
		} catch (e) {
			return { name, valid: false, error: e.message, outputs: [] };
		}

		// Every omitted param from the node's defaults, as a node added in the app starts
		// (Bin Data with no binStart used to be refused as invalid).
		fillOmittedArgs(entry, a);

		let synthesizedKeys = null; // the authoritative standalone out-key set, when we seed it
		if (!a.out || typeof a.out !== 'object') a.out = {};
		if (Object.keys(a.out).length === 0) {
			// Fixed-output keys from the definition…
			const tmpl = entry.defaults?.get?.('out');
			if (tmpl) for (const k of Object.keys(tmpl)) a.out[k] = -1;
			// …plus input/param-derived keys for dynamic-output processes.
			const dyn = synthesizeDynamicOut(name, a);
			if (dyn) {
				Object.assign(a.out, dyn);
				synthesizedKeys = new Set([...Object.keys(tmpl ?? {}), ...Object.keys(dyn)]);
			}
			// …plus param-dependent metric ports the node declares itself (Cosinor's
			// `<metric>_c<c>` for curves 2..Ncurves), which the app reconciles on mount.
			for (const k of entry.definition?.paramOutKeys?.(a) ?? []) {
				if (!(k in a.out)) a.out[k] = -1;
				synthesizedKeys?.add(k);
			}
			// …plus the node's other per-y families (a fit's `resid_<y>`, a profile's
			// `avgprofsem_<y>`), which its component adds on mount with useMultiYTP. Read off the
			// nodeSpec, so a family a node gains is seeded without editing this file.
			for (const k of perYFamilyKeys(entry, a)) {
				if (!(k in a.out)) a.out[k] = -1;
				synthesizedKeys?.add(k);
			}
		}

		// Construct via the real class: this allocates the output Column(s), wires
		// the out keys to their ids, and fires the process. Bad args (e.g. an arg
		// shape an LLM guessed wrong) can make the process throw *inside* the
		// constructor — catch it and return a clean, actionable error instead of
		// letting it crash the server.
		const badArgs = (e) => ({
			name,
			valid: false,
			error: `${name} failed: ${e?.message || e}. Check the exact args with list_capabilities (each analysis lists its input fields + params).`,
			outputs: []
		});
		// Remove a failed/invalid node and its columns from the session, so a broken
		// process (e.g. SimulatedData with no startTime) never lands in the export and
		// crashes the GUI on load.
		const discardTp = discardTableProcess;
		let tp;
		try {
			tp = new TableProcess({ name, args: a }, null);
		} catch (e) {
			return badArgs(e);
		}
		pushObj(tp);

		// When we synthesised the standalone out set, drop any extra keys the
		// constructor added from `yOutKeyPrefix` — those are the GUI's "collected
		// mode" columns, which the standalone path the MCP uses does not emit.
		if (synthesizedKeys) {
			for (const key of Object.keys(tp.args.out)) {
				if (synthesizedKeys.has(key)) continue;
				const cid = tp.args.out[key];
				delete tp.args.out[key];
				if (typeof cid === 'number' && cid >= 0) removeColumn(cid);
			}
		}

		// Await an explicit run so we can report validity + read the outputs. The
		// func recomputes and rewrites the same output columns (idempotent).
		let res;
		try {
			res = entry.func ? await entry.func(tp.args) : undefined;
		} catch (e) {
			this._assertActive();
			discardTp(tp);
			return { ...badArgs(e), tableProcessId: tp.id };
		}
		// Superseded while the process ran: the store is another session's now, so stop here.
		this._assertActive();
		let valid = true;
		let stats = null;
		let fit = null;
		let warnings = [];
		if (Array.isArray(res)) {
			const bools = res.filter((v) => typeof v === 'boolean');
			if (bools.length) valid = bools[bools.length - 1];
			const r0 = res[0];
			if (r0 && typeof r0 === 'object' && !Array.isArray(r0)) {
				// The notices the node shows beside a result it stands by (a Rayleigh test whose
				// values do not fit its unit, an NPCRA epoch finer than the data), so a headless
				// caller reads what a user of the app would.
				if (Array.isArray(r0.warnings))
					warnings = r0.warnings.filter((w) => typeof w === 'string' && w);
				if (r0.y_results) {
					// Cosinor / FitFunction: surface the RECOVERED parameters per Y
					// (MESOR, amplitude, acrophase, R², RMSE) — otherwise the caller only
					// gets the fitted-curve columns and can't report the fit.
					fit = {};
					for (const [yId, r] of Object.entries(r0.y_results)) {
						fit[yId] = {
							rSquared: r?.fittedData?.rSquared,
							rmse: r?.fittedData?.rmse,
							mesor: r?.fixedStats?.M,
							harmonics: (r?.fixedStats?.harmonics ?? []).map((h) => ({
								k: h.k,
								amplitude: h.amplitude,
								acrophase_rad: h.acrophase_rad ?? h.phi_rad
							}))
						};
					}
				} else {
					// GroupComparison and similar return statistics rather than columns.
					stats = r0;
				}
			}
		}

		// A process that ran but produced no valid result leaves only broken/empty
		// columns; drop the whole node so it can't pollute the export or crash the GUI.
		if (!valid) {
			discardTp(tp);
			const why = invalidReasons(Array.isArray(res) ? res[0] : null);
			return {
				name,
				tableProcessId: tp.id,
				valid: false,
				error:
					`${name} did not produce a valid result` +
					(why.length
						? `: ${why.join('; ')}.`
						: ' (check inputs/parameters via list_capabilities).'),
				outputs: []
			};
		}

		// Prune empty (pre-allocated collected-mode) output columns and serialise the rest. A
		// column whose getData() THROWS is surfaced as valid:false with the failed key + error,
		// rather than being silently treated as empty (which hid broken chains from the agent).
		return finalizeTableProcessOutputs(tp, name, { fit, stats, warnings });
	}

	/**
	 * Attach a column transform (column process: Add, Multiply, normalize, Sort,
	 * OutlierRemoval, RemoveTrend, …) to an existing column, then run the column's
	 * process chain. The transform becomes part of the column and is serialised.
	 *
	 * @param {number} columnId  Column to transform.
	 * @param {string} name      Process id (see list_capabilities → transforms).
	 * @param {object} [args]    Parameter overrides merged onto the process defaults
	 *   (e.g. {value: 5} for Add; {conditions:[...]} for FilterByOtherCol).
	 * @returns {{columnId:number, processId:number, name:string, length:number, preview:number[]}}
	 */
	addColumnProcess(columnId, name, args = {}) {
		this._assertActive();
		columnId = resolveColRef(columnId); // accept a column name too
		const col = getColumnById(columnId);
		if (!col) throw new Error(`No column with id ${columnId}. Call list_columns.`);
		const entry = appConsts.processMap?.get(name);
		if (!entry) {
			const known = [...(appConsts.processMap?.keys() ?? [])].join(', ');
			throw new Error(
				`Unknown column process "${name}". Available: ${known || '(registry not loaded)'}.`
			);
		}

		// The input rules the canvas enforces (core/processInputRules.js): a transform that
		// refuses this column's type (Multiply on a time column) is not attached.
		if (refusesInputType(entry, col.type)) {
			throw new Error(inputTypeRefusal(entry, entry.displayName ?? name, col.type));
		}
		assertSelectOptions('process', name, args, entry.defaults);
		const processId = col.addProcess(name);
		const proc = col.processes.find((p) => p.id === processId);
		if (proc && args && typeof args === 'object') {
			for (const [k, v] of Object.entries(args)) proc.args[k] = v;
		}

		let data = [];
		try {
			data = col.getData() ?? [];
		} catch {
			data = [];
		}
		return {
			columnId,
			processId,
			name,
			length: data.length,
			preview: data.slice(0, 8)
		};
	}

	/**
	 * Create a plot node wired to existing columns and add it to the session, so a
	 * subsequent export_session opens in the GUI with the plot rendered. Use the
	 * input field names from list_capabilities → plots[].inputs (e.g. scatterplot →
	 * {x, y}; actogram/periodogram → {time, values}; histogram → {column}).
	 *
	 * @param {string} type   Plot type id (e.g. 'scatterplot', 'actogram').
	 * @param {Object<string,number>|number[]} inputs  Map of input field → column id.
	 *   For tableplot, pass an array of column ids (no named fields).
	 * @param {Array<object>} [overlays]  Reference lines / bands, on a plot whose class
	 *   declares `overlayCapabilities` and only in the forms it allows; see
	 *   engine/overlays.js for the spec shape. Numbers are typed values, strings /
	 *   `{ column }` are wires.
	 * @param {{colourBy?: any, sizeBy?: any}} [encodings]  Colour by / Size by for the plot's
	 *   series, on a plot whose class declares `encodingCapabilities`: the draft syntax
	 *   (`"colourBy": "time"` or `{ column, mode, colormap, range, colourLine }`, `"sizeBy":
	 *   { column, mode, minRadius, maxRadius, range }`; plotbits/encodingSpec.js). A refusal
	 *   throws before anything is added.
	 * @returns {{plotId:number, type:string, name:string, inputs:object, overlays?:object[],
	 *   encodings?:object[], warnings?:string[]}}
	 */
	addPlot(type, inputs = {}, overlays = undefined, encodings = undefined) {
		this._assertActive();
		const entry = appConsts.plotMap?.get(type);
		if (!entry) {
			const known = [...(appConsts.plotMap?.keys() ?? [])].join(', ');
			throw new Error(
				`Unknown plot type "${type}". Available: ${known || '(registry not loaded)'}.`
			);
		}

		// Accept a column name too (LLMs track names more reliably than numeric ids).
		const assertCol = assertColumnRef;

		// Validate overlays BEFORE committing the plot, like the inputs below: a bad
		// overlay must not leave a half-built plot in the session. Per plot: only the kinds
		// and forms this plot's class allows.
		const overlayCaps = entry.data?.overlayCapabilities;
		if (overlays?.length && !overlayCaps) throw unsupportedOverlaysError(type);
		const overlayJsons = normalizeOverlaySpecs(overlays, assertCol, overlayCaps, { plot: type });
		// Colour by / Size by, checked against the same rules as a draft, before committing.
		const enc = plotEncodingFields(type, encodings, resolveColRef);

		const p = new Plot({ name: type, type });

		if (type === 'tableplot') {
			const ids = (Array.isArray(inputs) ? inputs : Object.values(inputs)).flat().map(assertCol);
			p.plot.columnRefs = [...ids];
			p.plot.showCol = ids.map(() => true);
		} else {
			const fields = entry.defaultInputs ?? [];
			const optional = new Set(OPTIONAL_PLOT_INPUTS[type] ?? []);
			// Ids or names; the many input (see plotInputs.js) may be a list, one series each.
			const resolved = resolvePlotInputs(type, fields, inputs, assertCol);
			// Reject incomplete wiring BEFORE committing the plot. Previously a missing field was
			// silently skipped and the plot inserted anyway (e.g. a scatterplot with x but no y),
			// so add_plot reported success but the plot rendered blank / unusable.
			const missing = fields.filter((f) => !optional.has(f) && resolved[f] == null);
			if (missing.length) {
				const required = fields.filter((f) => !optional.has(f));
				throw new Error(
					`Plot "${type}" is missing required input${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. ` +
						`It needs ${required.join(' + ')}${optional.size ? ` (optional: ${[...optional].join(', ')})` : ''}. ` +
						`Call list_capabilities for this plot's inputs.`
				);
			}
			const dataIns = plotSeriesDataIns(fields, resolved);
			for (const dataIn of dataIns) p.plot.addData(dataIn);
			assertSeriesKept(type, fields, dataIns, p.plot.data?.length ?? 0);
			// Colour by / Size by on every series the call made (one unless a list was given).
			(p.plot.data ?? []).forEach((series, i) =>
				applyPlotEncodingFields(series, i === 0 ? enc.fields : structuredClone(enc.fields))
			);
		}

		const overlaySummary = applyOverlays(p.plot, overlayJsons, type);

		core.plots.push(p);

		// Pre-set customName on the plot's data-wrapper columns. Reading a wrapper's
		// `name` later (e.g. during export's graph build) otherwise mutates state and
		// can silently blank the canvas edges — mirrors prewarmWrapperNames() in
		// nodeCatalog.js / generateDemos.
		// (`time` / `values` are the public input names; the series store them as x / y.)
		for (const series of p.plot?.data ?? []) {
			for (const { holder: w } of seriesChannelRefs(series)) {
				if ('refId' in w && w.customName == null) {
					const real = getColumnById(w.refId);
					w.customName = real ? `${real.name}` : 'col';
				}
			}
		}

		const encodingSummary = plotEncodingSummary(p);
		// What the plot warns about in its controls (e.g. a boxplot's numeric x with too many
		// distinct values), as render_plot reports it.
		const warnings = [...enc.warnings, ...plotWarnings(p.plot)].filter(
			(w, i, all) => all.indexOf(w) === i
		);
		return {
			plotId: p.id,
			type,
			name: p.name,
			inputs,
			...(overlaySummary.length ? { overlays: overlaySummary } : {}),
			...(encodingSummary.length ? { encodings: encodingSummary } : {}),
			...(warnings.length ? { warnings } : {})
		};
	}

	/**
	 * Rasterise a plot of columns in the session to PNG (+ SVG) using a real browser
	 * (Vite + Playwright/Chromium). Standalone: it does not mutate the session (use
	 * add_plot to embed a plot). Input column ids may be raw or analysis outputs.
	 *
	 * @param {string} type   Plot type id (see list_capabilities → plots).
	 * @param {Object<string,number|string>|Array<number|string>} inputs  Input field → column
	 *   id or name (or, for tableplot, an array of ids/names).
	 * @param {{outBase:string, width?:number, height?:number, overlays?:object[]}} opts
	 *   `overlays` as for addPlot (reference lines / bands, per the plot's capabilities).
	 * @returns {Promise<{png:string, svg:string, bytes:number, width:number, height:number}>}
	 */
	renderPlotToFiles(type, inputs, opts = {}) {
		return this._inFlight(() => this._renderPlotToFiles(type, inputs, opts));
	}

	async _renderPlotToFiles(type, inputs, { outBase, width = 700, height = 420, overlays } = {}) {
		const entry = appConsts.plotMap?.get(type);
		if (!entry) {
			const known = [...(appConsts.plotMap?.keys() ?? [])].join(', ');
			throw new Error(
				`Unknown plot type "${type}". Available: ${known || '(registry not loaded)'}.`
			);
		}

		const overlayCaps = entry.data?.overlayCapabilities;
		if (overlays?.length && !overlayCaps) throw unsupportedOverlaysError(type);
		const overlayJsons = normalizeOverlaySpecs(overlays, assertColumnRef, overlayCaps, {
			plot: type
		});

		// Series inputs by id OR name, as add_plot takes them (an ambiguous or unknown
		// name is refused here, before a browser is launched). The many input may be a list.
		inputs =
			type === 'tableplot'
				? (Array.isArray(inputs) ? inputs : Object.values(inputs ?? {})).flat().map(assertColumnRef)
				: resolvePlotInputs(type, entry.defaultInputs ?? [], inputs, assertColumnRef);

		// Gather referenced columns (series inputs + overlay wires) and renumber to
		// compact ids the render page rebuilds.
		const idList = [
			...(Array.isArray(inputs) ? inputs : plotInputIds(inputs)),
			...overlayColumnIds(overlayJsons)
		];
		const uniq = [...new Set(idList)];
		const idMap = new Map(uniq.map((id, i) => [id, i]));
		const columns = uniq.map((id) => {
			const col = getColumnById(id);
			if (!col) throw new Error(`No column with id ${id}. Call list_columns.`);
			let values = [];
			try {
				values = col.getData() ?? [];
			} catch {
				values = [];
			}
			return {
				id: idMap.get(id),
				name: col.name,
				type: col.type,
				// The clock a time column was recorded on, so the render labels its times there
				// rather than in UTC (render/payloadColumn.js).
				...(col.type === 'time' && col.timeZone ? { timeZone: col.timeZone } : {}),
				values
			};
		});
		const newInputs = Array.isArray(inputs)
			? inputs.map((id) => idMap.get(id))
			: mapPlotInputIds(inputs, (id) => idMap.get(id));

		const payload = {
			columns,
			plot: {
				type,
				inputs: newInputs,
				...(overlayJsons.length ? { overlays: remapOverlayColumnIds(overlayJsons, idMap) } : {})
			},
			width,
			height
		};
		const { renderPlot } = await import('./renderPlot.js');
		this._assertActive();
		const out = await renderPlot(payload, { outBase });
		this._assertActive();
		return out;
	}

	/** Serialise the whole session to an AnCiR-compatible JSON string. */
	exportSession() {
		this._assertActive();
		return outputCoreAsJson();
	}

	exportSessionObject() {
		return JSON.parse(this.exportSession());
	}
}
