// Pure ports of the engine's `synthesizeDynamicOut` rules (mcp/src/engine/session.js), for
// nodes whose output keys are computed rather than listed in their `out` template.
//
// Why ported and not imported: the normalizer must stay pure/portable (it runs in a Worker).
// `synthesizeDynamicOut` reaches into `core`, and MovingAnalysis' `getStatKeys` lives in a
// module that pulls in the whole compute stack (periodogram/cosinor/fft/...). So the rules are
// re-implemented here and held honest by parity tests (test/emit.dynamicout.parity.test.js)
// that diff them against the real helpers. Never "tidy" the maths — only match it.
//
// These keys are NOT cosmetic: the GUI recomputes a node into the output columns the session
// pre-allocated, so a wrong key silently yields an analysis that never fills in.

/** Unique, non-negative Y column ids. Mirrors session.js `yIdsOf`. */
function yIdsOf(args) {
	const y = args?.yIN;
	const list = Array.isArray(y) ? y : y != null && y !== -1 ? [y] : [];
	return [...new Set(list.map(Number).filter((id) => id >= 0))];
}

/**
 * Port of `getStatKeys` from $lib/utils/movinganalysis.js — the per-Y stat suffixes for a
 * moving window. Parametric: the cosinor/polynomial branches derive key COUNTS from
 * nHarmonics / Ncurves / trendPolyDegree, which is why no finite lookup table can express it.
 */
export function movingStatKeys(args) {
	if (args.analysis === 'periodogram') return ['peak_period', 'peak_power'];
	if (args.analysis === 'cosinor') {
		if (args.useFixedPeriod) {
			const keys = ['mesor'];
			const H = Math.max(1, args.nHarmonics ?? 1);
			for (let h = 1; h <= H; h++) keys.push(`H${h}_amplitude`, `H${h}_acrophase`);
			keys.push('r2', 'rmse', 'pvalue');
			return keys;
		}
		const keys = [];
		const N = Math.max(1, args.Ncurves ?? 1);
		for (let c = 1; c <= N; c++) keys.push(`C${c}_period`, `C${c}_amplitude`, `C${c}_phase`);
		keys.push('r2', 'rmse');
		return keys;
	}
	if (args.analysis === 'fft') return ['peak_period', 'peak_frequency', 'peak_magnitude'];
	if (args.analysis === 'correlogram') return ['peak_lag', 'peak_correlation'];
	if (args.analysis === 'rectfit')
		return ['mesor', 'amplitude', 'period', 'acrophase', 'duty_cycle', 'kappa', 'r2', 'rmse'];
	if (args.analysis === 'doublelogistic') {
		const keys = ['mesor', 'amplitude', 'onset', 'offset', 'k1', 'k2'];
		if (args.dlPeriodic) keys.push('period');
		keys.push('r2', 'rmse');
		return keys;
	}
	if (args.analysis === 'trend') {
		const model = args.trendModel ?? 'linear';
		if (model === 'linear') return ['slope', 'intercept', 'r2', 'rmse'];
		if (model === 'exponential' || model === 'logarithmic') return ['a', 'b', 'r2', 'rmse'];
		if (model === 'polynomial') {
			const deg = Math.max(0, Math.floor(args.trendPolyDegree ?? 2));
			const keys = [];
			for (let i = 0; i <= deg; i++) keys.push(`c${i}`);
			keys.push('r2', 'rmse');
			return keys;
		}
	}
	return [];
}

/**
 * What each computed-output node produces, in the model's own vocabulary — column NAMES it can
 * write, not the id-keyed keys below.
 *
 * These nodes advertised NOTHING, because their keys depend on args and so can't be baked into
 * a static list. But the RULE can be stated, and a rule is all a model needs. Without it, "split
 * the data and plot a periodogram of each part" made a model invent `values_0` / `values_1`,
 * and every analysis downstream of the Split was dropped as unresolvable — the feature was
 * unreachable by prompt.
 *
 * Kept beside the keys they describe: a note that drifts from the rule is worse than no note.
 * gen-schema bakes them into the catalogue (worker/draftPrompt.js renders them).
 */
export const OUTPUT_NOTES = {
	// The alignment sentence is the load-bearing one. Split's segments are FULL-LENGTH and
	// null-padded outside their window (`t.map(...)` in Split.svelte), so every segment still
	// lines up row-for-row with the ORIGINAL x column — there is no per-segment x, and none is
	// needed. Left unsaid, a model reaches for the symmetry it expects, asks for `time_1`, and
	// the whole chain after the Split is dropped as unresolvable.
	Split:
		'per Y column, one per segment: <your Y column>_1, <your Y column>_2, … (splitTimes has N entries ⇒ N+1 segments). Each segment is the SAME LENGTH as the input with the other segments blanked out, so keep using the ORIGINAL x column with it — there is no <your x column>_1, and asking for one will fail. Only pass a column in yIN if you want it split',
	MovingAnalysis:
		'per Y column, one per statistic the chosen `analysis` computes: <your Y column>_<stat> (e.g. <your Y column>_period)',
	CollectColumns: 'one per collected column: col_<the column>',
	StoredValueGroup: 'one per group: group_<the group id>',
	LongToWide:
		'one per DISTINCT VALUE in categoryIN: <that value>. Only usable when categoryIN is data you supplied or generated — not another analysis’s output, which is still empty.'
};

/**
 * Output keys for a computed-output node, EXCLUDING the ones already in its `out` template
 * (MovingAnalysis' `movex` and LongToWide's `time` are fixed; the schema adds those).
 *
 * @param {string} name
 * @param {object} args resolved args (column refs already numeric ids)
 * @param {{getValues?: (id:number) => any[]|undefined}} [ctx] access to baked column data
 * @returns {{keys:string[], issue?:string}|null} null when the node has no computed outputs
 */
export function dynamicOutKeys(name, args, ctx = {}) {
	switch (name) {
		case 'MovingAnalysis': {
			const ks = movingStatKeys(args);
			return { keys: yIdsOf(args).flatMap((y) => ks.map((k) => `${y}_${k}`)) };
		}
		case 'Split': {
			// One segment per split point, plus the tail: N splits → N+1 segments, 1-indexed.
			const segs = (Array.isArray(args.splitTimes) ? args.splitTimes.length : 0) + 1;
			return {
				keys: yIdsOf(args).flatMap((y) => Array.from({ length: segs }, (_, i) => `${y}_${i + 1}`))
			};
		}
		case 'CollectColumns':
			return { keys: (args.colIds ?? []).map((c) => `col_${c}`) };
		case 'StoredValueGroup':
			return { keys: (args.groups ?? []).map((g) => `group_${g.id}`) };
		case 'LongToWide': {
			// One output per DISTINCT VALUE of the category column — the only rule that needs
			// the data itself. We can serve it when that column is baked (imported data, or a
			// generator we baked); we cannot when it's another analysis's output, which is
			// still empty at emit time.
			const cat = args.categoryIN;
			if (cat == null || cat === -1) return { keys: [], issue: 'no categoryIN wired' };
			const values = ctx.getValues?.(cat);
			if (!values || values.length === 0) {
				return {
					keys: [],
					issue:
						'the categoryIN column has no data at emit time (it is a computed output), so its categories are unknowable here'
				};
			}
			return { keys: [...new Set(values)].map((c) => `value_${c}`) };
		}
		default:
			return null;
	}
}
