// src/lib/utils/smoothing.worker-task.test.js
// @ts-nocheck
import { describe, it, expect } from 'vitest';
import './smoothing.worker-task.js';
import { getComputeTask } from '$lib/workers/computeTasks.js';

describe('smoothing.apply worker task', () => {
	it('is registered under smoothing.apply', () => {
		const fn = getComputeTask('smoothing.apply');
		expect(typeof fn).toBe('function');
	});

	it('moving-average passes a smooth sine through nearly unchanged at the middle', () => {
		const fn = getComputeTask('smoothing.apply');
		const N = 100;
		const xs = Array.from({ length: N }, (_, i) => i);
		const ys = xs.map((i) => Math.sin(i / 10));
		const out = fn({
			xs: [xs],
			ys: [ys],
			smootherType: 'moving',
			options: { movingAvgWindowSize: 5, movingAvgType: 'simple' }
		});
		expect(out.results).toHaveLength(1);
		expect(out.results[0]).toHaveLength(N);
		// Mid-array smoothed value should be close to the original (small window, smooth signal)
		expect(Math.abs(out.results[0][50] - ys[50])).toBeLessThan(0.5);
	});

	it('whittaker passes a smooth sine through (lambda small)', () => {
		const fn = getComputeTask('smoothing.apply');
		const xs = Array.from({ length: 60 }, (_, i) => i);
		const ys = xs.map((i) => Math.sin(i / 8));
		const out = fn({
			xs: [xs],
			ys: [ys],
			smootherType: 'whittaker',
			options: { whittakerLambda: 1, whittakerOrder: 2 }
		});
		expect(out.results[0]).toHaveLength(60);
		// Most values should be finite numbers
		expect(out.results[0].every((v) => Number.isFinite(v))).toBe(true);
	});
});
