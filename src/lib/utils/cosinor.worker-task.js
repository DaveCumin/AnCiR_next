// @ts-nocheck
import { fitCosineCurves, fitCosinorFixed, FREE_PERIOD_DEFAULTS } from './cosinor.js';
import { registerComputeTask } from '$lib/workers/computeTasks.js';

/**
 * Pure-data wrapper around the cosinor fitters so they can run inside a worker
 * (no access to Column / core / DOM). Caller resolves all column data upfront.
 *
 * Inputs:
 *   t: number[]       hours-since-start for the x axis
 *   ys: number[][]    one y series per fit
 *   Ncurves           required when useFixedPeriod=false
 *   useFixedPeriod    boolean
 *   fixedPeriod       hours
 *   nHarmonics        integer >= 1
 *   alpha             significance level
 *   minPeriod         free fit only: shortest allowed period (h)
 *   maxPeriod         free fit only: longest allowed period (h)
 *
 * Returns:
 *   { results: Array<...fit result objects...> }
 */
export function cosinorFitMany(args) {
	const {
		t,
		ys,
		Ncurves,
		useFixedPeriod = false,
		fixedPeriod = 24,
		nHarmonics = 1,
		alpha = 0.05,
		minPeriod = FREE_PERIOD_DEFAULTS.minPeriod,
		maxPeriod = FREE_PERIOD_DEFAULTS.maxPeriod
	} = args;
	const results = ys.map((y) => {
		if (useFixedPeriod) {
			const r = fitCosinorFixed(t, y, fixedPeriod, nHarmonics, alpha);
			if (r == null) return null;
			return { ...r, period: fixedPeriod, valid: r?.valid !== false };
		}
		// The period range bounds the free fit (see FREE_PERIOD_DEFAULTS in cosinor.js).
		const r = fitCosineCurves(t, y, Ncurves, { minPeriod, maxPeriod });
		if (r == null) return null;
		return { ...r, valid: r?.valid !== false };
	});
	return { results };
}

registerComputeTask('cosinor.fitMany', cosinorFitMany);
