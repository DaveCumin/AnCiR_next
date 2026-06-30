import { describe, it, expect } from 'vitest';
import { fitPermutationPValue, PERMUTATION_DEFAULTS } from './fitFunction.js';

const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));

describe('fitPermutationPValue — permutation test for the dedicated fit nodes', () => {
	const t = seq(48, (i) => i);
	const cosOpts = { useFixedPeriod: true, fixedPeriod: 24, nHarmonics: 1, alpha: 0.05 };
	const args = { ...PERMUTATION_DEFAULTS, permuteTest: true, nPermutations: 199, permutationSeed: 7 };

	it('is disabled by default (returns NaN)', () => {
		const y = seq(48, (i) => Math.cos((2 * Math.PI * i) / 24));
		const r = fitPermutationPValue(t, y, 'cosinor', cosOpts, PERMUTATION_DEFAULTS);
		expect(Number.isNaN(r.pValue)).toBe(true);
		expect(r.significant).toBe(false);
	});

	it('flags a strong 24h rhythm as significant (small p)', () => {
		const y = seq(48, (i) => 5 + 10 * Math.cos((2 * Math.PI * i) / 24));
		const r = fitPermutationPValue(t, y, 'cosinor', cosOpts, args);
		expect(r.pValue).toBeGreaterThanOrEqual(0);
		expect(r.pValue).toBeLessThan(0.05);
		expect(r.significant).toBe(true);
	});

	it('does NOT flag flat/near-constant data (large p)', () => {
		// Monotone ramp has no 24h rhythm — the cosinor fit is no better than chance.
		const y = seq(48, (i) => (i % 2 === 0 ? 1 : -1));
		const r = fitPermutationPValue(t, y, 'cosinor', cosOpts, args);
		expect(r.pValue).toBeGreaterThan(0.05);
		expect(r.significant).toBe(false);
	});

	it('returns NaN for too few points', () => {
		const r = fitPermutationPValue([0, 1, 2], [1, 2, 3], 'cosinor', cosOpts, args);
		expect(Number.isNaN(r.pValue)).toBe(true);
	});
});
