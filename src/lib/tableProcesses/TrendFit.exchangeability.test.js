// @ts-nocheck
// Review finding FIT-5 on Fit trend: its permutation test shuffles single values, which
// assumes exchangeable observations. A trend has no period to set a block length, so the
// node offers no block scheme; it says so, and warns when the residuals are strongly
// autocorrelated (the shuffle p is then too small).
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: new Map() } }));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: () => null }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));

import { trendPermutationWarnings } from './TrendFit.svelte';

const n = 120;
const tt = Array.from({ length: n }, (_, i) => i);
const smoothResid = tt.map((i) => Math.sin(i / 10)); // lag-1 r near 1
const alternating = tt.map((i) => (i % 2 ? 1 : -1));

const yResult = (resid) => ({
	t: tt,
	yy: tt.map((v, i) => 2 * v + resid[i]),
	fittedData: { fitted: tt.map((v) => 2 * v), permutedStats: [0.1, 0.2], pValue: 0.01 }
});

describe('trendPermutationWarnings', () => {
	it('warns when the shuffle permutation ran on autocorrelated residuals', () => {
		const w = trendPermutationWarnings({ 7: yResult(smoothResid) }, (id) => `"col${id}"`);
		expect(w).toHaveLength(1);
		expect(w[0]).toMatch(/^The permutation p-value for "col7" assumes independent/);
		// No block scheme to point to on a trend fit.
		expect(w[0]).not.toMatch(/block permutation scheme/);
		expect(w[0]).toMatch(/too small/);
	});

	it('is silent on uncorrelated residuals, and when the test did not run', () => {
		expect(trendPermutationWarnings({ 7: yResult(alternating) }, String)).toEqual([]);
		const off = yResult(smoothResid);
		off.fittedData.permutedStats = [];
		expect(trendPermutationWarnings({ 7: off }, String)).toEqual([]);
	});
});
