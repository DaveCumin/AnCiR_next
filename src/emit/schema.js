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
	SequenceColumn: (a) => (Number(a.count) > 0 ? null : 'count must be > 0')
};

/** Pure output-baking for generators: { outKey: number[] }, or null. */
const GENERATORS = {
	// SequenceColumn is trivially pure — port it directly so a downstream analysis reading
	// it sees populated data at load. SimulatedData/Random need a faithful port (see ADR).
	SequenceColumn: (a) => {
		const start = Number(a.start ?? 0);
		const step = Number(a.step ?? 1);
		const count = Math.max(0, Math.floor(Number(a.count ?? 0)));
		return { result: Array.from({ length: count }, (_, i) => start + i * step) };
	}
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

/** Output columns that are time-typed (default is 'number'). */
const OUT_TYPES = {
	SimulatedData: { time: 'time' }
};

// ---- assemble the runtime schema from generated data + overrides ----

/** Suffix set for a 'suffix' node given its args, or null when the combo wasn't baked. */
function suffixesFor(g, args) {
	if (g.dynamicKind !== 'suffix') return null;
	const key = g.discriminators.map((d) => String(args[d])).join('|');
	return g.suffixesBy[key] ?? null;
}

function buildOut(name, g) {
	const typeOf = (key) => OUT_TYPES[name]?.[key] ?? 'number';
	return (args) => {
		const fixed = g.fixedOut.map((key) => ({ key, type: typeOf(key) }));
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
		// 'fixed' → fixed only; 'runtime' → fixed only (dynamic keys skipped, normalizer warns).
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
		// True when this node's per-Y keys couldn't be resolved for these args (a 'suffix'
		// node whose discriminator combination wasn't baked) — the normalizer warns.
		dynamicUnresolved: (args) => g.dynamicKind === 'suffix' && !suffixesFor(g, args),
		validate: VALIDATORS[name],
		generate: GENERATORS[name]
	};
}

/** Column-id arg fields for a node (scalar + array), for name-resolution/coercion. */
export function columnIdFields(name) {
	const s = SCHEMA[name];
	return s ? { scalar: s.inputs.scalar ?? [], array: s.inputs.array ?? [] } : null;
}
