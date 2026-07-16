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

import { SCHEMA, columnIdFields } from './schema.js';

const SESSION_VERSION = 'β.56.0'; // tracks the AnCiR app; importJson tolerates minor drift.

const numeric = (v) => typeof v === 'number' || (typeof v === 'string' && /^-?\d+$/.test(v));

/** A blank AnCiR column descriptor owning its own rawData slot `id`. */
function columnDescriptor(id, name, type) {
	return {
		id,
		name,
		type: type ?? 'number',
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

	const addColumn = (name, type, values) => {
		const id = nextId++;
		data.push(columnDescriptor(id, name, type));
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
		for (const { key, type } of nodeSchema.out(args)) {
			const values = baked && Array.isArray(baked[key]) ? baked[key] : undefined;
			const colName = outputColumnName(name, key, args, byName);
			// Analyses: empty rawData → GUI recomputes. Generators: baked values.
			out[key] = addColumn(colName, type, values);
		}

		tableProcesses.push({
			id: tpId++,
			name,
			displayName: nodeSchema.displayName ?? name,
			args: { ...args, out },
			refTPId: null
		});
	}

	// ---- 3. plots (minimal emit) ----
	// NOTE: a Plot carries a large default `plot` sub-object (axes/padding/limits). Rather
	// than reproduce it here (and risk drift), we emit a minimal plot and let the GUI's
	// Plot.fromJSON fill defaults. This path is not yet E2E-verified — see ADR Phase 3.
	let plotId = 5000;
	for (const p of draft.plots ?? []) {
		const inputs = {};
		let bad = false;
		for (const [k, v] of Object.entries(p.inputs ?? {})) {
			if (Array.isArray(v)) inputs[k] = v.map(resolveRef);
			else inputs[k] = resolveRef(v);
			const flat = Array.isArray(inputs[k]) ? inputs[k] : [inputs[k]];
			if (flat.some((id) => id == null)) bad = true;
		}
		if (bad) {
			errors.push(`Plot "${p.type}": unresolved input column ref — skipped.`);
			continue;
		}
		warnings.push(`Plot "${p.type}" emitted minimally; GUI fills defaults (unverified path).`);
		plots.push({ id: plotId++, type: p.type, ...inputs });
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
