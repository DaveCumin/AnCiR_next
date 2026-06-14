import { describe, it, expect } from 'vitest';
import './cosinor.worker-task.js';
import { getComputeTask } from '$lib/workers/computeTasks.js';

describe('cosinor.fitMany worker task', () => {
	it('is registered under the name cosinor.fitMany', () => {
		const fn = getComputeTask('cosinor.fitMany');
		expect(typeof fn).toBe('function');
	});

	it('fits a single cosine curve and returns amplitude/period', () => {
		const fn = getComputeTask('cosinor.fitMany');
		const N = 240;
		const t = Array.from({ length: N }, (_, i) => i / 10); // hours
		const period = 24;
		const y = t.map((h) => 5 + 2 * Math.cos((2 * Math.PI * h) / period));
		const out = fn({
			t,
			ys: [y],
			Ncurves: 1,
			useFixedPeriod: true,
			fixedPeriod: period,
			nHarmonics: 1,
			alpha: 0.05
		});
		expect(out.results).toHaveLength(1);
		expect(out.results[0].harmonics[0].amplitude).toBeCloseTo(2, 1);
	});

	it('returns null for fits that fail (insufficient data)', () => {
		const fn = getComputeTask('cosinor.fitMany');
		// Two points: not enough for a fixed cosinor with nHarmonics=1 (needs > 2*1+1 = 3)
		const out = fn({
			t: [0, 1],
			ys: [[0, 1]],
			useFixedPeriod: true,
			fixedPeriod: 24,
			nHarmonics: 1,
			alpha: 0.05
		});
		expect(out.results[0]).toBeNull();
	});
});
