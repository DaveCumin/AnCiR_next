// @ts-nocheck
import { fitCosineCurves, fitCosinorFixed } from './cosinor.js';
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
 *
 * Returns:
 *   { results: Array<...fit result objects...> }
 */
function cosinorFitMany(args) {
	const {
		t,
		ys,
		Ncurves,
		useFixedPeriod = false,
		fixedPeriod = 24,
		nHarmonics = 1,
		alpha = 0.05
	} = args;
	const results = ys.map((y) => {
		if (useFixedPeriod) {
			const r = fitCosinorFixed(t, y, fixedPeriod, nHarmonics, alpha);
			return { ...r, period: fixedPeriod, valid: r?.valid !== false };
		}
		const r = fitCosineCurves(t, y, Ncurves, alpha);
		return { ...r, valid: r?.valid !== false };
	});
	return { results };
}

registerComputeTask('cosinor.fitMany', cosinorFitMany);
