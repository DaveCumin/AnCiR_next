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
import { Column, getColumnById, removeColumn } from '$lib/core/Column.svelte';
import { TableProcess } from '$lib/core/TableProcess.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { evaluateCosinor } from '$lib/tableProcesses/Cosinor.svelte';
import { getOutputKeys as rhythmicityOutputKeys } from '$lib/tableProcesses/RhythmicityAnalysis.svelte';
import { getStatKeys as movingStatKeys } from '$lib/tableProcesses/MovingAnalysis.svelte';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';
import { loadProcesses } from '$lib/processes/processMap.js';
import { loadPlots } from '$lib/plots/plotMap.js';

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
// so every column-id argument (xIN/yIN/colIds/plot inputs/…) accepts either.
function resolveColRef(ref) {
	if (typeof ref === 'number') return ref;
	if (typeof ref === 'string') {
		const t = ref.trim();
		if (/^-?\d+$/.test(t)) return Number(t);
		const col = core.data.find((c) => c.name === ref);
		if (col) return col.id;
		const names = core.data.map((c) => c.name).join(', ');
		throw new Error(`No column named "${ref}". Available: ${names || '(none)'}. Call list_columns.`);
	}
	return ref;
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
			return seedKeys(yIdsOf(args).flatMap((y) => ks.map((k) => `${y}_${k}`)));
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
			dynamicOutputs
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
			params
		});
	}
	transforms.sort((a, b) => a.id.localeCompare(b.id));

	// Plots: created with add_plot (wired into the session, renders in the GUI) and
	// optionally rasterised to PNG/SVG with render_plot (needs a browser runtime).
	const plots = [];
	for (const [id, entry] of appConsts.plotMap ?? new Map()) {
		plots.push({
			id,
			displayName: entry.displayName,
			inputs: entry.defaultInputs ?? [],
			status: 'available — add_plot (session); render_plot for PNG/SVG'
		});
	}
	plots.sort((a, b) => a.id.localeCompare(b.id));

	return { analyses, transforms, plots };
}

function resetCore() {
	// Mirror the slices the GUI's importJson resets. NB: the `Table` class /
	// `core.tables` was removed in the 2026-06 migration — columns are now a flat
	// list in core.data and table processes are free-standing in core.tableProcesses.
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

export class AncirSession {
	constructor(id = 'default') {
		this.id = id;
		this._nextId = 0;
		resetCore();
	}

	/**
	 * Import columns of data into the session.
	 * @param {Array<{name:string,type?:string,values:number[]}>} cols
	 * @returns {Array<{id:number,name:string,type:string}>}
	 */
	importColumns(cols) {
		const added = [];
		for (const c of cols) {
			if (!Array.isArray(c.values)) {
				throw new Error(`Column "${c.name}" must provide a numeric "values" array.`);
			}
			const id = this._nextId++;
			core.rawData.set(id, c.values.slice());
			const col = Column.fromJSON({
				id,
				name: c.name ?? `col_${id}`,
				type: c.type ?? 'number',
				data: id,
				processes: []
			});
			pushObj(col);
			added.push({ id: col.id, name: col.name, type: col.type });
		}
		return added;
	}

	listColumns() {
		return core.data.map((c) => {
			let length = 0;
			try {
				length = (c.getData() || []).length;
			} catch {
				length = 0;
			}
			return { id: c.id, name: c.name, type: c.type, length };
		});
	}

	getColumnData(id) {
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
	async runCosinor({
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
	async runTableProcess(name, args = {}) {
		const entry = appConsts.tableProcessMap?.get(name);
		if (!entry) {
			const known = [...(appConsts.tableProcessMap?.keys() ?? [])].join(', ');
			throw new Error(`Unknown table process "${name}". Available: ${known || '(registry not loaded)'}.`);
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

		// Resolve column references (numbers, numeric strings, OR column names) to ids
		// for this process's input fields, before out-synthesis/construction.
		const cif = entry.columnIdFields ?? {};
		try {
			for (const f of cif.scalar ?? []) if (a[f] != null) a[f] = resolveColRef(a[f]);
			// Array fields (e.g. yIN): coerce a bare scalar to a 1-element array — LLMs
			// often pass yIN:"values_0" where yIN:["values_0"] is required — then resolve.
			for (const f of cif.array ?? []) {
				if (a[f] == null) continue;
				a[f] = (Array.isArray(a[f]) ? a[f] : [a[f]]).map(resolveColRef);
			}
		} catch (e) {
			return { name, valid: false, error: e.message, outputs: [] };
		}

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
		const discardTp = (tpToDrop) => {
			const outIds = Object.values(tpToDrop?.args?.out ?? {}).filter(
				(id) => typeof id === 'number' && id >= 0
			);
			core.tableProcesses = core.tableProcesses.filter((t) => t.id !== tpToDrop.id);
			for (const id of outIds) {
				try {
					removeColumn(id);
				} catch {
					/* already gone */
				}
			}
		};
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
			discardTp(tp);
			return { ...badArgs(e), tableProcessId: tp.id };
		}
		let valid = true;
		let stats = null;
		let fit = null;
		if (Array.isArray(res)) {
			const bools = res.filter((v) => typeof v === 'boolean');
			if (bools.length) valid = bools[bools.length - 1];
			const r0 = res[0];
			if (r0 && typeof r0 === 'object' && !Array.isArray(r0)) {
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
			return {
				name,
				tableProcessId: tp.id,
				valid: false,
				error: `${name} did not produce a valid result (check inputs/parameters via list_capabilities).`,
				outputs: []
			};
		}

		// Prune output columns the process didn't write to. Dual-mode processes
		// (RhythmicityAnalysis, MovingAnalysis) carry a `yOutKeyPrefix`, so the
		// TableProcess constructor pre-allocates a "collected-mode" column that stays
		// empty in the standalone path the MCP uses; drop those so the report and the
		// exported session stay clean.
		for (const [key, colId] of Object.entries(tp.args.out ?? {})) {
			if (typeof colId !== 'number' || colId < 0) continue;
			const col = getColumnById(colId);
			let len = 0;
			try {
				len = (col?.getData() ?? []).length;
			} catch {
				len = 0;
			}
			if (len === 0) {
				delete tp.args.out[key];
				if (col) removeColumn(colId);
			}
		}

		const outputs = [];
		for (const [key, colId] of Object.entries(tp.args.out ?? {})) {
			if (typeof colId !== 'number' || colId < 0) continue;
			const col = getColumnById(colId);
			if (!col) continue;
			let data = [];
			try {
				data = col.getData() ?? [];
			} catch {
				data = [];
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

		const result = { name, tableProcessId: tp.id, valid, outputs };
		// Recovered fit parameters (Cosinor/FitFunction) — the numbers a caller wants.
		if (fit) result.fit = fit;
		// Statistics: GroupComparison exposes them as `comparisons` (now alongside its
		// statistic/pvalue output columns), so surface them regardless of columns; other
		// column-less processes only when they produced no columns.
		if (stats && (stats.comparisons || outputs.length === 0)) result.stats = stats;
		return result;
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
		columnId = resolveColRef(columnId); // accept a column name too
		const col = getColumnById(columnId);
		if (!col) throw new Error(`No column with id ${columnId}. Call list_columns.`);
		const entry = appConsts.processMap?.get(name);
		if (!entry) {
			const known = [...(appConsts.processMap?.keys() ?? [])].join(', ');
			throw new Error(`Unknown column process "${name}". Available: ${known || '(registry not loaded)'}.`);
		}

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
	 * @returns {{plotId:number, type:string, name:string, inputs:object}}
	 */
	addPlot(type, inputs = {}) {
		const entry = appConsts.plotMap?.get(type);
		if (!entry) {
			const known = [...(appConsts.plotMap?.keys() ?? [])].join(', ');
			throw new Error(`Unknown plot type "${type}". Available: ${known || '(registry not loaded)'}.`);
		}

		// Accept a column name too (LLMs track names more reliably than numeric ids).
		const assertCol = (ref) => {
			const id = resolveColRef(ref);
			if (!getColumnById(id)) throw new Error(`No column with id ${id}. Call list_columns.`);
			return id;
		};

		const p = new Plot({ name: type, type });

		if (type === 'tableplot') {
			const ids = (Array.isArray(inputs) ? inputs : Object.values(inputs)).map(assertCol);
			p.plot.columnRefs = [...ids];
			p.plot.showCol = ids.map(() => true);
		} else {
			const fields = entry.defaultInputs ?? [];
			const dataIn = {};
			for (const field of fields) {
				const ref = Array.isArray(inputs) ? inputs[fields.indexOf(field)] : inputs[field];
				if (ref == null) continue;
				dataIn[field] = { refId: assertCol(ref) };
			}
			if (Object.keys(dataIn).length) p.plot.addData(dataIn);
		}

		core.plots.push(p);

		// Pre-set customName on the plot's data-wrapper columns. Reading a wrapper's
		// `name` later (e.g. during export's graph build) otherwise mutates state and
		// can silently blank the canvas edges — mirrors prewarmWrapperNames() in
		// nodeCatalog.js / generateDemos.
		for (const series of p.plot?.data ?? []) {
			for (const field of ['x', 'y', 'z', 'column', 'time', 'values']) {
				const w = series?.[field];
				if (w && typeof w === 'object' && 'refId' in w && w.customName == null) {
					const real = getColumnById(w.refId);
					w.customName = real ? `${real.name}` : 'col';
				}
			}
		}

		return { plotId: p.id, type, name: p.name, inputs };
	}

	/**
	 * Rasterise a plot of columns in the session to PNG (+ SVG) using a real browser
	 * (Vite + Playwright/Chromium). Standalone: it does not mutate the session (use
	 * add_plot to embed a plot). Input column ids may be raw or analysis outputs.
	 *
	 * @param {string} type   Plot type id (see list_capabilities → plots).
	 * @param {Object<string,number>|number[]} inputs  Input field → column id (or, for
	 *   tableplot, an array of column ids).
	 * @param {{outBase:string, width?:number, height?:number}} opts
	 * @returns {Promise<{png:string, svg:string, bytes:number, width:number, height:number}>}
	 */
	async renderPlotToFiles(type, inputs, { outBase, width = 700, height = 420 }) {
		const entry = appConsts.plotMap?.get(type);
		if (!entry) {
			const known = [...(appConsts.plotMap?.keys() ?? [])].join(', ');
			throw new Error(`Unknown plot type "${type}". Available: ${known || '(registry not loaded)'}.`);
		}

		// Gather referenced columns and renumber to compact ids the render page rebuilds.
		const idList = Array.isArray(inputs) ? inputs : Object.values(inputs);
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
			return { id: idMap.get(id), name: col.name, type: col.type, values };
		});
		const newInputs = Array.isArray(inputs)
			? inputs.map((id) => idMap.get(id))
			: Object.fromEntries(Object.entries(inputs).map(([k, id]) => [k, idMap.get(id)]));

		const payload = { columns, plot: { type, inputs: newInputs }, width, height };
		const { renderPlot } = await import('./renderPlot.js');
		return await renderPlot(payload, { outBase });
	}

	/** Serialise the whole session to an AnCiR-compatible JSON string. */
	exportSession() {
		return outputCoreAsJson();
	}

	exportSessionObject() {
		return JSON.parse(outputCoreAsJson());
	}
}
