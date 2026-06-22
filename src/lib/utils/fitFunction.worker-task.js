// @ts-nocheck
// Worker wrapper for the FitFunction curve fit (LM/least-squares). Pure data in,
// pure data out, so it can run inside the compute worker. The cheap
// evaluate-at-points step stays on the main thread in the table process.
import { fitCurveModel } from './fitFunction.js';
import { registerComputeTask } from '$lib/workers/computeTasks.js';

export function fitFunctionFit({ tt, yy, model, options }) {
	return fitCurveModel(tt, yy, model, options);
}

registerComputeTask('fitfunction.fit', fitFunctionFit);
