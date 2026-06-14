// src/lib/utils/smoothing.worker-task.js
// @ts-nocheck
import { smoothArrays } from './smoothing.js';
import { registerComputeTask } from '$lib/workers/computeTasks.js';

/**
 * Pure-data wrapper around smoothArrays so the smoothing pipeline can run
 * inside a worker (no Column / DOM access). Each (xs[i], ys[i]) pair is
 * smoothed independently with the same smootherType + options.
 *
 * Inputs:
 *   xs: number[][]        one x array per series
 *   ys: number[][]        one y array per series (same length as the matching xs)
 *   smootherType: string  'whittaker' | 'savitzky' | 'loess' | 'moving'
 *   options: object       type-specific params (whittakerLambda, savitzkyWindowSize, etc.)
 *
 * Returns:
 *   { results: number[][] } - one smoothed y array per input series
 */
export function smoothingApply(args) {
	const { xs, ys, smootherType, options = {} } = args;
	const results = ys.map((y, i) => {
		const x = xs[i] ?? xs[0];
		const { y_out } = smoothArrays(x, y, smootherType, options);
		return y_out;
	});
	return { results };
}

registerComputeTask('smoothing.apply', smoothingApply);
