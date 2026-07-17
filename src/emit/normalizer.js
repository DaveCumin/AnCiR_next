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

// Per-series style slots, each with an explicit colour. Union across the types that read them:
//   Scatterplot: line, points · Periodogram: line, thresholdline, points
//   Correlogram: line, confidenceLine, points · MeanSEM: line, points
// A type ignores slots it doesn't read, so emitting the union is safe. The colour mirrors
// Quick-Plot's raw-series colour (plots/canonicalNodeViz.js RAW_COLOUR).
//
// AnCiR's Line/Points fromJSON used to read `json.colour` unguarded and drop the parent, so a
// missing slot — or a slot with no colour — threw, and importJson silently discarded the whole
// plot. That is FIXED upstream now (both default safely). We keep emitting explicit styles
// anyway: it costs nothing, and a session may well be opened by an older deployed AnCiR that
// still has the crash.
const STYLE_SLOTS = ['line', 'points', 'thresholdline', 'confidenceLine'];

// Series colours mirror Quick-Plot (plots/canonicalNodeViz.js): navy for raw/input data,
// terracotta for a fitted/derived curve.
const RAW_COLOUR = '#234154';
const FIT_COLOUR = '#BE796B';

/**
 * Style slots for one series. `kind:'line'` draws a connected curve (a fit); anything else
 * draws points (raw data). Mirrors Quick-Plot's scatterInner, so an emitted "data + fit" plot
 * looks like the one AnCiR's own Quick-Plot button produces.
 */
function seriesStyle(kind, colour) {
	const isLine = kind === 'line';
	const c = colour ?? (isLine ? FIT_COLOUR : RAW_COLOUR);
	const style = {
		line: { colour: c, draw: isLine, strokeWidth: isLine ? 2.5 : 2, stroke: 'solid' },
		points: { colour: c, draw: !isLine, radius: 3, shape: 'circle' }
	};
	// Slots only some plot types read; harmless elsewhere, and they must carry a colour.
	for (const slot of STYLE_SLOTS) style[slot] ??= { colour: c };
	return style;
}

/**
 * The field name a plot class actually STORES a series input under, given its i-th public
 * PORT name.
 *
 * These are two different vocabularies, and conflating them is what broke the actogram.
 * `defaultDataInputs` (which schema.plots[type].inputs mirrors) are the PORT names shown in
 * the UI: Actogram/Periodogram/FFT/Correlogram/CircularPhase advertise `time`/`values`. But
 * every one of those classes persists the series as generic `x`/`y` — their `fromJSON` reads
 * `json.x` / `json.y` and nothing else. AnCiR documents the convention in
 * plots/CircularPhase/CircularPhase.svelte: the workflow graph's edge detection
 * (ProcessNode.svelte.js) hardcodes `dp?.x?.refId` / `dp?.y?.refId` / `dp?.column?.refId`, so
 * series fields can't be arbitrary.
 *
 * Writing the PORT name instead produced a plot the class silently ignored: every input came
 * back `refId: -1`, so the actogram loaded unwired and then threw
 * "Cannot read properties of undefined (reading 'left')" out of LightBand at render.
 *
 * Two-input plots store x/y positionally; histogram's single input is stored under its own
 * name (`column`).
 */
function storageField(fields, i) {
	if (fields.length === 2) return i === 0 ? 'x' : 'y';
	return fields[i];
}

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
 * @param {object} [opts]
 * @param {object} [opts.schema=SCHEMA] injected node schema (see schema.js) — swap for a
 *        registry-generated one without touching this logic.
 * @param {object} [opts.provenance] stamped into `session.generatedBy` — who built this
 *        session, so a user's copy can be traced back to the log line that made it. Injected
 *        rather than generated here on purpose: this function is PURE (same draft ⇒ byte-identical
 *        session), and a uuid/clock inside would destroy that. The caller owns both.
 * @returns {{session:object, warnings:string[], errors:string[]}}
 */
export function normalizeSession(draft, { schema = SCHEMA, provenance = null } = {}) {
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

		// Computed-output nodes (Split, LongToWide, MovingAnalysis, …) derive their keys from
		// the args — and, for LongToWide, from the baked data — so give the schema a way to
		// read column values. Anything it still can't work out is a warning, not a guess: a
		// wrong key yields an analysis that silently never fills in.
		const outCtx = { getValues: (id) => rawData[id] };
		const issue = nodeSchema.dynamicIssue?.(args, outCtx);
		if (issue) warnings.push(`${name}: ${issue}; those outputs may not compute on load.`);

		// Generators: BAKE outputs so a downstream analysis sees populated inputs at load
		// (GUI regeneration is timing-fragile for generator→analysis chains — see ADR).
		// Returns a { outKey: number[] } map, or null when no baking is available yet.
		const baked = nodeSchema.generate ? nodeSchema.generate(args) : null;
		if (nodeSchema.generate && !baked)
			warnings.push(`${name}: generator outputs not baked (no generate()); downstream analyses may not compute on load.`);

		// PRE-ALLOCATE output columns + `out` wiring (required — see ADR Test C).
		const out = {};
		for (const { key, type, timeFormat } of nodeSchema.out(args, outCtx)) {
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
			// A plot holds N series (plot.data[]), which is how "raw data + fitted curve" is
			// drawn. Accept either `series: [{x,y,label?,kind?}, …]` or the single-series
			// shorthand `inputs: {x,y}` — the latter is just one series.
			const specs = Array.isArray(p.series) && p.series.length ? p.series : [p.inputs ?? {}];
			const data = [];
			let bad = null;

			for (const spec of specs) {
				const series = {};
				for (let i = 0; i < pSchema.inputs.length; i++) {
					const field = pSchema.inputs[i]; // PORT name (what the draft/user says)
					const store = storageField(pSchema.inputs, i); // what the plot class READS
					// Accept either vocabulary from the draft. The prompt teaches the port names,
					// but a model that reaches for the generic x/y (its worked example is a
					// scatterplot) means the same thing, and refusing that costs the user a plot.
					const ref = Array.isArray(spec)
						? spec[i]
						: (spec?.[field] ?? (field === store ? undefined : spec?.[store]));
					if (ref == null) continue;
					const id = resolveRef(ref);
					if (id == null) bad ??= `${p.type}.${field}: no column named "${ref}"`;
					else series[store] = { refId: id };
				}
				if (bad) break;
				if (Object.keys(series).length === 0) {
					bad ??= `${p.type}: a series wired nothing (expected ${pSchema.inputs.join(', ')})`;
					break;
				}
				if (spec?.label != null) series.label = String(spec.label);
				series.yAxis = 'left';
				Object.assign(series, seriesStyle(spec?.kind, spec?.colour));
				data.push(series);
			}

			if (bad) {
				errors.push(`Plot ${bad}. Available: ${[...byName.keys()].join(', ') || '(none)'}. Skipped.`);
				continue;
			}
			inner = { data };
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
		version: SESSION_VERSION,
		// Provenance, next to the version: it says where this session CAME FROM, which is the
		// only way to tie a session someone sends us to the request that built it (join on
		// sessionId against the Worker's logs). Absent ⇒ a human built it; we never invent one.
		...(provenance ? { generatedBy: provenance } : {})
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
