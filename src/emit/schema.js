// Node schema consumed by the pure normalizer (src/emit/normalizer.js).
//
// The STRUCTURAL facts — inputs, params, fixed output keys, per-Y prefix — are
// REGISTRY-DERIVED: generated into `session-schema.generated.json` by gen-schema.js,
// straight from AnCiR's node registry, so they can't drift. (This is what a hand-authored
// schema got wrong: Cosinor's fixed `cosinorx` output was missed, silently breaking the
// fit — ADR 2026-07-15.) Regenerate with:  vite-node src/emit/gen-schema.js
//
// This file adds the parts that are LOGIC, not registry facts:
//   - validators : semantic guards the engine otherwise enforces only by executing the node
//   - generators : pure output-baking for generators (so a generator→analysis chain has
//                  populated inputs at load; see ADR)
//   - param/type overrides : deterministic defaults where the registry default is a live
//                            timestamp, and the few time-typed outputs
//
// dynamicKind per node: 'fixed' (no per-Y outputs), 'prefix' (per-Y `${prefix}${yid}` —
// pre-allocated), or 'runtime' (keys depend on data/method — the normalizer skips dynamic
// pre-allocation and warns; a code-side rule for these is a follow-up).

import generated from './session-schema.generated.json' with { type: 'json' };
import { simulatedData, sequenceColumn, randomColumn } from './generators.js';
import { dynamicOutKeys } from './dynamicOut.js';

// The ISO format the generators stamp on a time column (SimulatedData / SequenceColumn).
const TIME_FMT = 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]';

// ---- code-side overrides (logic, keyed by node name) ----

/** Semantic validators. Return an error string, or null when the args are acceptable. */
const VALIDATORS = {
	SimulatedData: (a) => {
		if (!Number.isFinite(new Date(a.startTime ?? NaN).getTime()))
			return 'startTime must be a valid date/time';
		if (!(Number(a.samplingPeriod_hours) > 0)) return 'samplingPeriod_hours must be > 0';
		if (!Array.isArray(a.sections) || a.sections.length === 0)
			return 'sections must be a non-empty array';
		return null;
	},
	SequenceColumn: (a) => (Number(a.count) > 0 ? null : 'count must be > 0'),
	// N<=0 yields an empty column that upstream types 'category' (result[0] is undefined) —
	// a degenerate node. Reject it rather than emit one.
	Random: (a) => (Number(a.N) > 0 ? null : 'N must be > 0')
};

/**
 * Pure output-baking for generators: `{ outKey: values[] }`. Baking matters because an
 * analysis only recomputes on load when its INPUTS already hold data — see ADR.
 * These are faithful ports of AnCiR's real generators, held honest by a parity test
 * (test/emit.generators.parity.test.js) that diffs them against the originals.
 */
const GENERATORS = {
	SimulatedData: simulatedData,
	SequenceColumn: sequenceColumn,
	Random: randomColumn
};

/**
 * Param-default overrides (logic, not registry facts):
 *  - deterministic defaults where the registry default is a live timestamp
 *  - safer working defaults, matching the guidance baked into the LLM prompt
 *    (fixed-period fitting; free-period is unreliable on time-axis data)
 * A value the caller supplies always wins — these only fill an omitted param.
 */
const PARAM_OVERRIDES = {
	SimulatedData: { startTime: '2024-01-01T00:00:00.000Z' },
	Cosinor: { useFixedPeriod: true },
	FitFunction: { useFixedPeriod: true }
};

/**
 * Column metadata for outputs, as a function of args (default: plain 'number').
 * A generator normally stamps type/timeFormat on its output column when it computes — but we
 * BAKE its data, so it never runs in the GUI and never stamps them. We must emit them here or
 * a time column renders as a raw number. Mirrors SimulatedData.svelte / SequenceColumn.svelte.
 */
const OUT_META = {
	SimulatedData: () => ({
		time: { type: 'time', timeFormat: TIME_FMT },
		values: { type: 'number' }
	}),
	SequenceColumn: (args) => ({
		result:
			args.seqType === 'time' ? { type: 'time', timeFormat: TIME_FMT } : { type: 'number' }
	})
};

// ---- assemble the runtime schema from generated data + overrides ----

/** Suffix set for a 'suffix' node given its args, or null when the combo wasn't baked. */
function suffixesFor(g, args) {
	if (g.dynamicKind !== 'suffix') return null;
	const key = g.discriminators.map((d) => String(args[d])).join('|');
	return g.suffixesBy[key] ?? null;
}

function buildOut(name, g) {
	return (args, ctx = {}) => {
		const meta = OUT_META[name]?.(args) ?? {};
		const metaOf = (key) => ({ type: 'number', ...(meta[key] ?? {}) });
		const fixed = g.fixedOut.map((key) => ({ key, ...metaOf(key) }));
		const yIds = args.yIN ?? [];
		// per-Y `${prefix}${yid}` (Cosinor's cosinory_7, BinnedData's binnedy_7, …)
		if (g.dynamicKind === 'prefix')
			return [...fixed, ...yIds.map((yid) => ({ key: `${g.perYPrefix}${yid}`, type: 'number' }))];
		// per-Y `${yid}_${suffix}` (RhythmicityAnalysis: 7_period, 7_power, …)
		if (g.dynamicKind === 'suffix') {
			const suffixes = suffixesFor(g, args);
			if (!suffixes) return fixed; // unbaked combo → fixed only; normalizer warns
			return [
				...fixed,
				...yIds.flatMap((yid) => suffixes.map((s) => ({ key: `${yid}_${s}`, type: 'number' })))
			];
		}
		// Computed keys (Split segments, LongToWide categories, MovingAnalysis stats …) —
		// derived from args, and from baked data for LongToWide. See dynamicOut.js.
		if (g.dynamicKind === 'runtime') {
			const d = dynamicOutKeys(name, args, ctx);
			if (!d) return fixed;
			return [...fixed, ...d.keys.map((key) => ({ key, ...metaOf(key) }))];
		}
		return fixed;
	};
}

export const SCHEMA = {};
for (const [name, g] of Object.entries(generated.nodes)) {
	SCHEMA[name] = {
		displayName: g.displayName,
		inputs: g.inputs,
		params: { ...g.params, ...(PARAM_OVERRIDES[name] ?? {}) },
		dynamicKind: g.dynamicKind,
		out: buildOut(name, g),
		/**
		 * Why this node's computed outputs couldn't be worked out for these args (string), or
		 * null when they're fine. Two cases: a 'suffix' node whose discriminator combination
		 * wasn't baked, and LongToWide when its category column has no data at emit time.
		 * The normalizer turns this into a warning.
		 */
		dynamicIssue: (args, ctx = {}) => {
			if (g.dynamicKind === 'suffix' && !suffixesFor(g, args))
				return 'no baked output keys for this parameter combination; re-run gen-schema.js if a new method was added';
			if (g.dynamicKind === 'runtime') return dynamicOutKeys(name, args, ctx)?.issue ?? null;
			return null;
		},
		validate: VALIDATORS[name],
		generate: GENERATORS[name]
	};
}

/**
 * Plot types → their series field names (registry `defaultInputs`):
 * scatterplot/boxplot/meansem → [x,y]; actogram/periodogram/fft/correlogram/circularphase
 * → [time,values]; histogram → [column]; tableplot/dataview → [] (tableplot uses columnRefs).
 */
export const PLOTS = generated.plots ?? {};

/** Column-id arg fields for a node (scalar + array), for name-resolution/coercion. */
export function columnIdFields(name) {
	const s = SCHEMA[name];
	return s ? { scalar: s.inputs.scalar ?? [], array: s.inputs.array ?? [] } : null;
}
