// Pure, dependency-free session normalizer (ADR 2026-07-15-static-session-emission).
//
// Turns an LLM-emitted session DRAFT (node types + column NAMES + loose args) into a
// canonical AnCiR `session.json` skeleton that opens in the GUI via `?loadFromURL=`.
// It does NOT run any analysis: it emits the structure + input data + PRE-ALLOCATED
// output columns/`out` wiring (with empty rawData), and the AnCiR GUI recomputes every
// analysis/generator output on load (verified end-to-end in the ADR).
//
// No imports, no `core`, no vite: this runs unchanged in Node, a browser, or a
// Cloudflare Worker. That is the whole point — it removes the heavy engine from the
// session-creation path.
//
// Draft shape:
//   { id?, columns?: [{name, type?, values:number[]}],
//     analyses?: [{name, args:{ xIN?, yIN?, ...params }}],
//     plots?:    [{type, inputs:{...}}] }        // plots: minimal emit (see note)
//
// Returns { session, warnings, errors } — a broken analysis is dropped with an error
// (mirroring the engine's discardTp) rather than poisoning the whole session.

import { SCHEMA, PLOTS as plots_, columnIdFields } from './schema.js';

const SESSION_VERSION = 'β.56.1'; // tracks the AnCiR app; importJson tolerates minor drift.

// Per-series style slots the plot classes deserialise with an UNGUARDED read
// (`LineClass.fromJSON(json.line)` → `json.colour`), so a MISSING slot throws and importJson
// silently skips the whole plot. Union across the types that use them:
//   Scatterplot: line, points · Periodogram: line, thresholdline, points
//   Correlogram: line, confidenceLine, points · MeanSEM: line, points
// A type ignores slots it doesn't read, so emitting the union is safe.
//
// Each slot MUST carry an explicit `colour`. An empty `{}` is NOT enough: fromJSON calls
// `new LineClass({...})` with no parent, and the constructor's palette fallback
// (`dataIN?.colour ?? getPaletteColor(parent.parentPlot.data.length)`) then dereferences
// undefined. A defined colour short-circuits before the parent is touched. Every other field
// (strokeWidth ?? 3, draw ?? true, radius ?? 4 …) defaults safely, so colour is all we set.
// Value mirrors Quick-Plot's raw-series colour (plots/canonicalNodeViz.js RAW_COLOUR).
const SERIES_COLOUR = '#234154';
const STYLE_SLOTS = ['line', 'points', 'thresholdline', 'confidenceLine'];

const numeric = (v) => typeof v === 'number' || (typeof v === 'string' && /^-?\d+$/.test(v));

/** A blank AnCiR column descriptor owning its own rawData slot `id`. */
function columnDescriptor(id, name, type, timeFormat) {
	return {
		id,
		name,
		type: type ?? 'number',
		// A time column needs its format, or it renders as a raw epoch number. Generators
		// normally stamp this when they compute; we bake their data, so we must emit it.
		...(timeFormat ? { timeFormat } : {}),
		data: id,
		// The GUI expects this field present (empty string) — omitting it HANGS the workflow
		// load for free/source columns. NB: `tableProcessGUId` is a process-generated version
		// stamp (written during compute), NOT a static owner pointer — so `''` here is fine;
		// a process overwrites its own output columns' stamp when it computes. (An earlier note
		// blamed missing GUIDs for analyses not recomputing on load; that was disproven — the
		// real cause was a missing FIXED output column, cosinorx, now allocated in schema.js.
		// See ADR 2026-07-15-static-session-emission.)
		tableProcessGUId: '',
		producerNodeId: null,
		producerPort: null,
		producerArtifactKind: null,
		processes: []
	};
}

/**
 * @param {object} draft
 * @param {object} [schema=SCHEMA] injected node schema (see schema.js) — swap for a
 *        registry-generated one without touching this logic.
 * @returns {{session:object, warnings:string[], errors:string[]}}
 */
export function normalizeSession(draft, schema = SCHEMA) {
	const warnings = [];
	const errors = [];

	const data = [];
	const rawData = {};
	const tableProcesses = [];
	const plots = [];

	let nextId = 0;
	const byName = new Map(); // column name -> id

	const addColumn = (name, type, values, timeFormat) => {
		const id = nextId++;
		data.push(columnDescriptor(id, name, type, timeFormat));
		// Inputs carry their values; outputs stay empty ([]) so the GUI recomputes them.
		rawData[id] = Array.isArray(values) ? values.slice() : [];
		if (name != null && !byName.has(name)) byName.set(name, id);
		return id;
	};

	// Resolve a column reference (id, numeric string, or NAME) to a numeric id, or null.
	const resolveRef = (ref) => {
		if (typeof ref === 'number') return ref;
		if (typeof ref === 'string') {
			const t = ref.trim();
			if (/^-?\d+$/.test(t)) return Number(t);
			if (byName.has(ref)) return byName.get(ref);
			return null; // unresolved
		}
		return null;
	};

	// ---- 1. input columns (import_data) ----
	for (const c of draft.columns ?? []) {
		if (!c || typeof c.name !== 'string') {
			errors.push(`Skipped a column with no name.`);
			continue;
		}
		if (!Array.isArray(c.values)) {
			errors.push(`Column "${c.name}" has no numeric values[] — skipped.`);
			continue;
		}
		addColumn(c.name, c.type ?? 'number', c.values);
	}

	// ---- 2. analyses (run_table_process) ----
	let tpId = 1000; // keep tp ids clear of column ids
	for (const spec of draft.analyses ?? []) {
		const name = spec?.name;
		const nodeSchema = schema[name];
		if (!nodeSchema) {
			errors.push(`Unknown analysis "${name}" — not in schema; skipped.`);
			continue;
		}

		// clone + flatten the common `params`/`inputs` wrapper mistake.
		const args = structuredClone(spec.args ?? {});
		for (const wrapper of ['params', 'inputs']) {
			const w = args[wrapper];
			if (w && typeof w === 'object' && !Array.isArray(w)) {
				for (const [k, v] of Object.entries(w)) if (args[k] == null) args[k] = v;
				delete args[wrapper];
			}
		}

		// resolve column refs on the declared input fields.
		const cif = columnIdFields(name);
		let refError = null;
		for (const f of cif.scalar) {
			if (args[f] == null) continue;
			const id = resolveRef(args[f]);
			if (id == null) refError = `${name}.${f}: no column named "${args[f]}"`;
			else args[f] = id;
		}
		for (const f of cif.array) {
			if (args[f] == null) continue;
			const list = Array.isArray(args[f]) ? args[f] : [args[f]]; // coerce scalar→array
			const ids = list.map(resolveRef);
			if (ids.some((id) => id == null))
				refError = `${name}.${f}: unresolved column ref in ${JSON.stringify(list)}`;
			else args[f] = ids;
		}
		if (refError) {
			errors.push(`${refError}. Available: ${[...byName.keys()].join(', ') || '(none)'}. Skipped.`);
			continue;
		}

		// fill omitted params from defaults (without clobbering supplied values).
		for (const [k, v] of Object.entries(nodeSchema.params ?? {})) {
			if (args[k] == null) args[k] = structuredClone(v);
		}

		// semantic validation (the guards the engine gets for free by executing the node).
		const vErr = nodeSchema.validate ? nodeSchema.validate(args) : null;
		if (vErr) {
			errors.push(`${name}: ${vErr}. Skipped.`);
			continue;
		}

		// Some nodes' per-Y output keys can't be pre-allocated from a static schema:
		//  - 'runtime': keys depend on live data or unbounded params (Split's segments,
		//    LongToWide's categories, MovingAnalysis' nHarmonics-derived keys).
		//  - 'suffix' with an un-baked discriminator combo (e.g. a new analysis method).
		// We still emit the node with its fixed outputs; flag that the dynamic ones won't
		// auto-compute on load.
		if (nodeSchema.dynamicKind === 'runtime') {
			warnings.push(`${name}: data-dependent dynamic outputs are not pre-allocated; those outputs may not compute on load.`);
		} else if (nodeSchema.dynamicUnresolved?.(args)) {
			warnings.push(`${name}: no baked output keys for this parameter combination; its per-Y outputs may not compute on load. Re-run gen-schema.js if a new method was added.`);
		}

		// Generators: BAKE outputs so a downstream analysis sees populated inputs at load
		// (GUI regeneration is timing-fragile for generator→analysis chains — see ADR).
		// Returns a { outKey: number[] } map, or null when no baking is available yet.
		const baked = nodeSchema.generate ? nodeSchema.generate(args) : null;
		if (nodeSchema.generate && !baked)
			warnings.push(`${name}: generator outputs not baked (no generate()); downstream analyses may not compute on load.`);

		// PRE-ALLOCATE output columns + `out` wiring (required — see ADR Test C).
		const out = {};
		for (const { key, type, timeFormat } of nodeSchema.out(args)) {
			const values = baked && Array.isArray(baked[key]) ? baked[key] : undefined;
			const colName = outputColumnName(name, key, args, byName);
			// Analyses: empty rawData → GUI recomputes. Generators: baked values.
			out[key] = addColumn(colName, type, values, timeFormat);
		}

		tableProcesses.push({
			id: tpId++,
			name,
			displayName: nodeSchema.displayName ?? name,
			args: { ...args, out },
			refTPId: null
		});
	}

	// ---- 3. plots ----
	// A plot's series are NOT flat column ids: each is a wrapper `{ refId: <columnId> }`
	// inside the plot's inner `{ data: [...] }`. We emit that minimal inner shape — the same
	// one Quick-Plot uses (plots/canonicalNodeViz.js plotDataFromSpec), which every plot
	// class's fromJSON is explicitly tested to accept while keeping its own default
	// padding/axes (plots/plotFromJSONRobustness.test.js). The Plot constructor defaults
	// name/x/y/width/height, so we only position them so they don't stack.
	let plotId = 5000;
	let plotSlot = 0;
	for (const p of draft.plots ?? []) {
		const pSchema = plots_[p.type];
		if (!pSchema) {
			errors.push(`Unknown plot type "${p.type}". Available: ${Object.keys(plots_).join(', ')}. Skipped.`);
			continue;
		}

		const refsOf = (v) => (Array.isArray(v) ? v : [v]).map(resolveRef);
		let inner = null;

		if (p.type === 'tableplot') {
			// tableplot takes a bare list of columns, not x/y series.
			const raw = Array.isArray(p.inputs) ? p.inputs : Object.values(p.inputs ?? {});
			const ids = refsOf(raw.flat());
			if (ids.some((id) => id == null)) {
				errors.push(`Plot "tableplot": unresolved column ref — skipped.`);
				continue;
			}
			inner = { columnRefs: ids, showCol: ids.map(() => true) };
		} else {
			// One series, one `{refId}` wrapper per registry input field (x/y, time/values, …).
			const series = {};
			let bad = null;
			for (const field of pSchema.inputs) {
				const ref = Array.isArray(p.inputs) ? p.inputs[pSchema.inputs.indexOf(field)] : p.inputs?.[field];
				if (ref == null) continue;
				const id = resolveRef(ref);
				if (id == null) bad = `${p.type}.${field}: no column named "${ref}"`;
				else series[field] = { refId: id };
			}
			if (bad) {
				errors.push(`Plot ${bad}. Available: ${[...byName.keys()].join(', ') || '(none)'}. Skipped.`);
				continue;
			}
			if (Object.keys(series).length === 0) {
				errors.push(`Plot "${p.type}": no inputs wired (expected ${pSchema.inputs.join(', ')}). Skipped.`);
				continue;
			}
			// Every series needs its style slots, each with an explicit colour (see
			// SERIES_COLOUR/STYLE_SLOTS above) — otherwise Plot.fromJSON throws and
			// importJson silently drops the plot.
			for (const slot of STYLE_SLOTS) series[slot] = { colour: SERIES_COLOUR };
			inner = { data: [series] };
		}

		plots.push({
			id: plotId++,
			name: p.name ?? pSchema.displayName ?? p.type,
			type: p.type,
			// Park plots clear of the auto-laid-out data/analysis chain (which starts near
			// x≈350) and stagger them so they don't stack. Cosmetic only — the user can hit
			// "Tidy layout"; the Plot constructor would otherwise default these to 350/150,
			// landing on top of the analysis nodes.
			x: 1200 + (plotSlot % 2) * 560,
			y: 80 + Math.floor(plotSlot / 2) * 320,
			width: 500,
			height: 250,
			plot: inner
		});
		plotSlot++;
	}

	const session = {
		rawData,
		data,
		plots,
		tableProcesses,
		storedValues: {},
		chainRefs: [],
		nodeNotes: {},
		notes: [],
		groups: [],
		composites: [],
		orphanProcesses: [],
		nodeLayout: {}, // omitted → GUI auto-lays-out
		// appState omitted → GUI keeps its defaults (no "Restoring settings" needed)
		version: SESSION_VERSION
	};

	return { session, warnings, errors };
}

/** Human-ish name for a pre-allocated output column. Per-Y keys borrow the source name. */
function outputColumnName(nodeName, key, args, byName) {
	const idToName = new Map([...byName.entries()].map(([n, i]) => [i, n]));
	const m = /^(.*?)(\d+)$/.exec(key);
	if (m && (args.yIN ?? []).map(Number).includes(Number(m[2]))) {
		const src = idToName.get(Number(m[2])) ?? m[2];
		return `${m[1]}${src}`;
	}
	return key;
}
