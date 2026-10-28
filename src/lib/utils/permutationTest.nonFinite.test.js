// @ts-nocheck
/**
 * STAT-U3 (2026-10-03 review, "possible issue, not confirmed"): a permutation whose refit
 * returns a NaN statistic was kept in permutedStats. NaN >= observed is false, so it counted
 * in the denominator and never as extreme: p biased DOWN. A NaN OBSERVED statistic was worse:
 * every comparison false, p = 1 / (m + 1), the smallest p possible, on any data.
 *
 * Verdict: CONFIRMED in the code; no fit node was found that produces a NaN statistic on real
 * data (flat and single-spike series give finite R squared and RMSE for cosinor, rectangular
 * wave and double logistic), but an unknown `permutationStatistic` name (getStatistic returns
 * NaN) reached the p = 1 / (m + 1) case through fitPermutationPValue. FIXED here and in
 * tools/ancir_runtime.py / .R (fit_permutation_pvalue): a non-finite permuted statistic is a
 * failed refit (skipped and counted), a non-finite observed one is no test (p NaN).
 */
import { describe, it, expect, vi } from 'vitest';
import { permutationTest, permutationTestAsync } from './permutationTest.js';
import { fitPermutationPValue } from './fitFunction.js';

const x = Array.from({ length: 20 }, (_, i) => i);
const y = x.map((v) => Math.cos((2 * Math.PI * v) / 10) * 0.2 + ((v * 7) % 5) / 5);

/**
 * A fit whose R squared is NaN on every permuted series whose first value is below the
 * observed first value, and 0.5 otherwise; observed R squared 0.4. So every finite
 * permutation is extreme, and p must be 1 (all extreme) however many NaNs there are.
 */
function halfNaNFit(xx, yy) {
	if (yy === y) return { rSquared: 0.4, rmse: 1 };
	return { rSquared: yy[0] < y[0] ? NaN : 0.5, rmse: 1 };
}

describe('STAT-U3: non-finite permutation statistics', () => {
	it('a NaN permuted statistic is skipped, not counted as a non-extreme permutation', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const r = permutationTest(x, y, halfNaNFit, { nPermutations: 99, seed: 5 });
		warn.mockRestore();
		expect(r.permutedStats.every(Number.isFinite)).toBe(true);
		expect(r.nPermutations).toBeGreaterThan(10);
		expect(r.nPermutations).toBeLessThan(99);
		// Every finite permutation is extreme: p = (m + 1) / (m + 1).
		expect(r.pValue).toBe(1);
	});

	it('the async runner does the same', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const r = await permutationTestAsync(x, y, halfNaNFit, {
			nPermutations: 99,
			seed: 5,
			batchSize: 7
		});
		warn.mockRestore();
		const s = permutationTest(x, y, halfNaNFit, { nPermutations: 99, seed: 5 });
		expect(r.pValue).toBe(1);
		expect(r.permutedStats).toEqual(s.permutedStats);
	});

	it('a NaN observed statistic is no test (p NaN), never p = 1 / (m + 1)', () => {
		const r = permutationTest(x, y, () => ({ rSquared: NaN, rmse: NaN }), { nPermutations: 49 });
		expect(r.pValue).toBeNaN();
		expect(r.significant).toBe(false);
	});

	it('through a fit node: an unknown statistic name gives NaN p, not 1 / (m + 1)', () => {
		const t = Array.from({ length: 48 }, (_, i) => i);
		const yy = t.map((v) => Math.cos((2 * Math.PI * v) / 24) + ((v * 13) % 7) / 7);
		const r = fitPermutationPValue(
			t,
			yy,
			'cosinor',
			{ useFixedPeriod: true, fixedPeriod: 24, nHarmonics: 1 },
			{ permuteTest: true, nPermutations: 99, permutationStatistic: 'aic' }
		);
		expect(r.pValue).toBeNaN();
		expect(r.significant).toBe(false);
	});
});
