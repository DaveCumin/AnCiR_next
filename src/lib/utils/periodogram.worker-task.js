// @ts-nocheck
import { runPeriodogramCalculation } from './periodogram.js';
import { registerComputeTask } from '$lib/workers/computeTasks.js';

/**
 * Pure-data wrapper around runPeriodogramCalculation so it can run inside a
 * worker. `onProgress` is intentionally not supported (postMessage callbacks
 * are not transferable). Consumers that need progress reporting should call
 * runPeriodogramCalculation directly on the main thread.
 *
 * Returns: { x: periods, y: power, threshold, pvalue }
 */
export function periodogramCompute(params) {
	return runPeriodogramCalculation(params, undefined);
}

registerComputeTask('periodogram.compute', periodogramCompute);
