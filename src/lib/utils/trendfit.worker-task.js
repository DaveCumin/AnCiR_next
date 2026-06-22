// @ts-nocheck
// Worker wrapper for the TrendFit regression fit. Pure data in/out.
import { fitTrendSync } from './trendfit.js';
import { registerComputeTask } from '$lib/workers/computeTasks.js';

export function trendFitFit({ tt, yy, model, polyDegree }) {
	return fitTrendSync(tt, yy, model, polyDegree);
}

registerComputeTask('trendfit.fit', trendFitFit);
