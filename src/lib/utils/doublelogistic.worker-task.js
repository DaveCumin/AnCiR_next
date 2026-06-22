// @ts-nocheck
// Worker wrapper for the DoubleLogistic fit (nonlinear LM). Pure data in/out.
import { fitDoubleLogistic } from './doublelogistic.js';
import { registerComputeTask } from '$lib/workers/computeTasks.js';

export function doubleLogisticFit({ tt, yy, opts }) {
	return fitDoubleLogistic(tt, yy, opts);
}

registerComputeTask('doublelogistic.fit', doubleLogisticFit);
