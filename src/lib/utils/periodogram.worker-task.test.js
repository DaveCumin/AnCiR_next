// @ts-nocheck
import { describe, it, expect } from 'vitest';
import './periodogram.worker-task.js';
import { getComputeTask } from '$lib/workers/computeTasks.js';

describe('periodogram.compute worker task', () => {
	it('registered under periodogram.compute', () => {
		expect(typeof getComputeTask('periodogram.compute')).toBe('function');
	});

	it('Lomb-Scargle finds the dominant period of a clean 24h cosine', () => {
		const fn = getComputeTask('periodogram.compute');
		const N = 384; // 96 hours @ 0.25h step
		const t = Array.from({ length: N }, (_, i) => i * 0.25);
		const trueP = 24;
		const y = t.map((h) => Math.cos((2 * Math.PI * h) / trueP));
		const out = fn({
			method: 'Lomb-Scargle',
			xData: t,
			yData: y,
			periodMin: 18,
			periodMax: 30,
			periodSteps: 0.1
		});
		expect(out.x.length).toBeGreaterThan(0);
		expect(out.x.length).toBe(out.y.length);
		const peakIdx = out.y.indexOf(Math.max(...out.y));
		expect(Math.abs(out.x[peakIdx] - trueP)).toBeLessThan(1);
	});

	it('passes a params object through without onProgress', () => {
		const fn = getComputeTask('periodogram.compute');
		// Should not throw even though onProgress is undefined inside the task
		const out = fn({
			method: 'Lomb-Scargle',
			xData: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
			yData: Array.from({ length: 24 }, (_, i) => Math.cos((2 * Math.PI * i) / 24)),
			periodMin: 20,
			periodMax: 28,
			periodSteps: 1
		});
		expect(Array.isArray(out.x)).toBe(true);
		expect(Array.isArray(out.y)).toBe(true);
	});
});
