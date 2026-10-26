import { describe, it, expect } from 'vitest';
import { mannWhitneyExactP, mannWhitneyUsesExact } from './mannWhitneyExact.js';

// Reference: scipy 1.18 exact two-sided p, min(1, 2 * _MWU(n1, n2).sf(max(U1, U2))), the value
// scipy.stats.mannwhitneyu(method='exact') returns.
const SCIPY = [
	[0, 5, 6, 0.004329004329004329],
	[5, 3, 20, 0.018068887634105024],
	[100, 8, 600, 1.0452269079413148e-10],
	[1000, 8, 600, 0.0032008013572665845],
	[2400, 8, 600, 1.0],
	[12, 4, 6, 1.0],
	[0, 1, 1, 1.0],
	[0, 8, 10000, 8.035029984327765e-28],
	[7, 2, 9, 0.7272727272727273]
];

describe('mannWhitneyExactP', () => {
	it.each(SCIPY)('U = %d, n1 = %d, n2 = %d matches scipy', (u, n1, n2, p) => {
		expect(mannWhitneyExactP(u, n1, n2)).toBeCloseTo(p, 14);
		expect(mannWhitneyExactP(u, n1, n2) / p).toBeCloseTo(1, 10);
		// Either U gives the same p, and the sample order does not matter.
		expect(mannWhitneyExactP(n1 * n2 - u, n2, n1)).toBeCloseTo(p, 14);
	});

	it('sums to 1 over the whole distribution (n1 = 4, n2 = 5 by enumeration)', () => {
		// P(U <= k) from the function, against a brute-force count over all C(9, 4) = 126 splits.
		const counts = new Array(21).fill(0);
		for (let mask = 0; mask < 1 << 9; mask++) {
			let bits = 0;
			for (let b = 0; b < 9; b++) if (mask & (1 << b)) bits++;
			if (bits !== 4) continue;
			let rankSum = 0;
			for (let b = 0; b < 9; b++) if (mask & (1 << b)) rankSum += b + 1;
			counts[rankSum - 10]++;
		}
		let cum = 0;
		for (let k = 0; k <= 10; k++) {
			cum += counts[k];
			expect(mannWhitneyExactP(k, 4, 5)).toBeCloseTo(Math.min(1, (2 * cum) / 126), 14);
		}
	});

	it('is NaN for a U outside [0, n1 n2] or a half-integer (ties)', () => {
		expect(mannWhitneyExactP(-1, 3, 3)).toBeNaN();
		expect(mannWhitneyExactP(10, 3, 3)).toBeNaN();
		expect(mannWhitneyExactP(2.5, 3, 3)).toBeNaN();
		expect(mannWhitneyExactP(1, 0, 3)).toBeNaN();
	});
});

describe('mannWhitneyUsesExact (scipy method="auto")', () => {
	it('exact when either sample has at most 8 values and there are no ties', () => {
		expect(mannWhitneyUsesExact(8, 100, false)).toBe(true);
		expect(mannWhitneyUsesExact(100, 3, false)).toBe(true);
		expect(mannWhitneyUsesExact(9, 9, false)).toBe(false);
		expect(mannWhitneyUsesExact(5, 5, true)).toBe(false);
	});
});
