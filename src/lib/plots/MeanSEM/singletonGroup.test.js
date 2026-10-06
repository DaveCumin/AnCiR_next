// STAT-14: a group with one observation has no sample SD, so meanSemByGroup reports its SD and
// SEM as NaN (not 0). The y range must still include that group's mean: NaN in `mean - sem`
// compares false against every bound, which used to drop the point from the axis entirely.
import { describe, it, expect } from 'vitest';
import { MeanSEMclass } from './MeanSEM.svelte';
import { meanSemByGroup } from '$lib/utils/meanSem.js';

describe('MeanSEM y range with a single-observation group', () => {
	it('keeps the mean of an n = 1 group (NaN SEM) inside the y range', () => {
		const m = new MeanSEMclass(null, null);
		m.renderBox = { w: 400, h: 300 };
		m.data = [{ stats: meanSemByGroup(['A'], [42]), showError: true }];
		expect(m.data[0].stats[0].sem).toBeNaN();
		const [lo, hi] = m.ylims;
		expect(lo).toBeLessThanOrEqual(42);
		expect(hi).toBeGreaterThanOrEqual(42);
	});
});
