import { describe, it, expect } from 'vitest';
import {
	rankAverage,
	pearson,
	spearman,
	correlationPValue,
	correlate,
	correlationMatrix,
	correlationCI
} from './correlation.js';

describe('rankAverage', () => {
	it('ranks ascending, 1-based', () => {
		expect(rankAverage([10, 30, 20])).toEqual([1, 3, 2]);
	});
	it('averages tied ranks', () => {
		// two values tied for ranks 2 and 3 → both get 2.5
		expect(rankAverage([10, 20, 20, 40])).toEqual([1, 2.5, 2.5, 4]);
	});
});

describe('pearson', () => {
	it('is +1 for a perfect positive linear relationship', () => {
		const { r, n } = pearson([1, 2, 3, 4], [2, 4, 6, 8]);
		expect(r).toBeCloseTo(1, 9);
		expect(n).toBe(4);
	});
	it('is -1 for a perfect negative relationship', () => {
		expect(pearson([1, 2, 3, 4], [8, 6, 4, 2]).r).toBeCloseTo(-1, 9);
	});
	it('is ~0 for uncorrelated data', () => {
		// A symmetric V in y against a monotonic x: the up-half and down-half cancel.
		expect(Math.abs(pearson([1, 2, 3, 4], [2, 1, 1, 2]).r)).toBeLessThan(1e-9);
	});
	it('drops rows where EITHER value is missing (pairwise-complete)', () => {
		const { r, n } = pearson([1, 2, null, 4], [2, 4, 6, 8]);
		expect(n).toBe(3); // the null row is excluded from BOTH
		expect(r).toBeCloseTo(1, 9);
	});
	it('is NaN when a column has zero variance', () => {
		expect(pearson([1, 1, 1, 1], [1, 2, 3, 4]).r).toBeNaN();
	});
	it('is NaN with fewer than 2 usable pairs', () => {
		expect(pearson([1], [2]).r).toBeNaN();
	});
});

describe('spearman', () => {
	it('is +1 for a monotonic-but-nonlinear increasing relationship', () => {
		// y = x^3 is NOT linear (Pearson < 1) but IS perfectly monotonic.
		const x = [1, 2, 3, 4, 5];
		const y = x.map((v) => v ** 3);
		expect(spearman(x, y).r).toBeCloseTo(1, 9);
		expect(pearson(x, y).r).toBeLessThan(0.99); // and Pearson is not fooled into 1
	});
	it('handles ties via averaged ranks', () => {
		const { r, tiesX, tiesY } = spearman([1, 2, 2, 3], [1, 2, 2, 3]);
		expect(r).toBeCloseTo(1, 9);
		expect(tiesX).toBe(true);
		expect(tiesY).toBe(true);
	});
});

describe('correlationPValue', () => {
	it('is ~0 for a strong correlation with decent n', () => {
		expect(correlationPValue(0.95, 30)).toBeLessThan(0.001);
	});
	it('is near 1 for r≈0', () => {
		expect(correlationPValue(0.0, 30)).toBeCloseTo(1, 6);
	});
	it('is symmetric in the sign of r (two-sided)', () => {
		expect(correlationPValue(0.5, 20)).toBeCloseTo(correlationPValue(-0.5, 20), 12);
	});
	it('is 0 for a perfect correlation, NaN for n<3', () => {
		expect(correlationPValue(1, 20)).toBe(0);
		expect(correlationPValue(0.5, 2)).toBeNaN();
	});
});

describe('correlate', () => {
	it('pearson: returns r, pvalue, n together', () => {
		const res = correlate([1, 2, 3, 4, 5], [2, 4, 6, 8, 10], 'pearson');
		expect(res.r).toBeCloseTo(1, 9);
		expect(res.pvalue).toBeLessThan(0.001);
		expect(res.n).toBe(5);
	});
	it('spearman uses ranks', () => {
		const x = [1, 2, 3, 4, 5];
		const y = x.map((v) => v ** 2);
		expect(correlate(x, y, 'spearman').r).toBeCloseTo(1, 9);
	});
});

describe('correlationMatrix', () => {
	const cols = [
		[1, 2, 3, 4, 5], // a
		[2, 4, 6, 8, 10], // b = 2a  → r(a,b)=+1
		[5, 4, 3, 2, 1] // c = -a   → r(a,c)=-1
	];
	const names = ['a', 'b', 'c'];

	it('emits one row per UNIQUE pair (upper triangle, no diagonal)', () => {
		const rows = correlationMatrix(cols, names, 'pearson');
		// 3 variables → 3 unique pairs: (a,b), (a,c), (b,c)
		expect(rows).toHaveLength(3);
		expect(rows.map((row) => `${row.var_i}-${row.var_j}`)).toEqual(['a-b', 'a-c', 'b-c']);
	});
	it('computes the right coefficients per pair', () => {
		const rows = correlationMatrix(cols, names, 'pearson');
		const get = (i, j) => rows.find((row) => row.var_i === i && row.var_j === j);
		expect(get('a', 'b').r).toBeCloseTo(1, 9);
		expect(get('a', 'c').r).toBeCloseTo(-1, 9);
		expect(get('b', 'c').r).toBeCloseTo(-1, 9);
	});
	it('carries pvalue and n on every row', () => {
		const rows = correlationMatrix(cols, names, 'pearson');
		for (const row of rows) {
			expect(row.n).toBe(5);
			expect(Number.isFinite(row.pvalue)).toBe(true);
		}
	});
	it('falls back to index names when names are absent', () => {
		const rows = correlationMatrix(cols, null, 'pearson');
		expect(rows[0].var_i).toBe('0');
		expect(rows[0].var_j).toBe('1');
	});
	it('returns [] for fewer than 2 columns', () => {
		expect(correlationMatrix([[1, 2, 3]], ['a'], 'pearson')).toEqual([]);
	});
});

describe('correlationCI — Fisher z interval', () => {
	// Values checked against a numpy/scipy reference:
	//   z = arctanh(r); se = 1/sqrt(n-3) (pearson) or sqrt((1+r^2/2)/(n-3)) (spearman);
	//   CI = tanh(z +/- z_crit * se)
	it('matches the reference for Pearson', () => {
		expect(correlationCI(0.5, 30)).toEqual([
			expect.closeTo(0.170431, 6),
			expect.closeTo(0.728959, 6)
		]);
		expect(correlationCI(-0.3, 50)).toEqual([
			expect.closeTo(-0.533775, 6),
			expect.closeTo(-0.023625, 6)
		]);
	});

	it('matches the reference for Spearman (Bonett-Wright SE)', () => {
		expect(correlationCI(0.5, 30, 'spearman')).toEqual([
			expect.closeTo(0.148132, 6),
			expect.closeTo(0.739503, 6)
		]);
	});

	it('is WIDER for Spearman than Pearson at the same r and n', () => {
		// The rank coefficient carries extra variability; using the Pearson SE
		// would give an interval that is too narrow.
		const [pLo, pHi] = correlationCI(0.5, 30);
		const [sLo, sHi] = correlationCI(0.5, 30, 'spearman');
		expect(sHi - sLo).toBeGreaterThan(pHi - pLo);
	});

	it('is ASYMMETRIC about r, and never leaves [-1, 1]', () => {
		const r = 0.9;
		const [lo, hi] = correlationCI(r, 12);
		expect(r - lo).toBeGreaterThan(hi - r); // skewed, correctly
		expect(lo).toBeGreaterThan(-1);
		expect(hi).toBeLessThan(1);
	});

	it('narrows as n grows', () => {
		const small = correlationCI(0.5, 10);
		const big = correlationCI(0.5, 200);
		expect(big[1] - big[0]).toBeLessThan(small[1] - small[0]);
	});

	it('brackets r, and excludes 0 exactly when the correlation is clear', () => {
		const [lo, hi] = correlationCI(0.5, 30);
		expect(lo).toBeLessThan(0.5);
		expect(hi).toBeGreaterThan(0.5);
		expect(lo).toBeGreaterThan(0);
	});

	it('collapses onto r at |r| = 1 rather than returning infinities', () => {
		expect(correlationCI(1, 20)).toEqual([1, 1]);
		expect(correlationCI(-1, 20)).toEqual([-1, -1]);
	});

	it('is NaN when n is too small for the transform', () => {
		expect(correlationCI(0.5, 3).every(Number.isNaN)).toBe(true);
		expect(correlationCI(NaN, 30).every(Number.isNaN)).toBe(true);
	});

	it('a 99% interval is wider than a 95% one', () => {
		const a = correlationCI(0.5, 30, 'pearson', 0.95);
		const b = correlationCI(0.5, 30, 'pearson', 0.99);
		expect(b[1] - b[0]).toBeGreaterThan(a[1] - a[0]);
	});
});

// STAT-U4: numeric STRINGS in a number column. validPairs keeps "3" (isNaN("3") is false),
// and `reduce((s, v) => s + v, 0)` then concatenated: the mean of ["1".."8"] was 1234567.
// Reached in the app by a session whose number column holds strings, which the AI draft path
// produced (mcp/src/emit/normalizer.js accepted "1.5" as a number and baked it as text):
// Pearson read r = 0.99999999999 (p ~ 3e-38) for data whose r is 0.932.
describe('numeric strings are read as the numbers they spell (STAT-U4)', () => {
	const A = [1, 2, 3, 4, 5, 6, 7, 8];
	const B = [2, 1, 4, 3, 6, 5, 8, 9];
	const S = (arr) => arr.map(String);

	it('pearson on strings equals pearson on the numbers', () => {
		const want = pearson(A, B);
		expect(want.r).toBeCloseTo(0.9320546490018, 12);
		expect(pearson(S(A), S(B))).toEqual(want);
		expect(pearson(S(A), B)).toEqual(want);
	});

	it('spearman ties are found by value, not by spelling ("2" and "2.0" tie)', () => {
		const x = [1, 2, 2, 3, 4];
		const y = [5, 3, 4, 1, 2];
		const want = spearman(x, y);
		expect(spearman(['1', '2', '2.0', '3', '4'], S(y))).toEqual(want);
		expect(want.tiesX).toBe(true);
	});

	it('correlate and the matrix agree on strings and numbers; blanks still drop', () => {
		const want = correlate([...A, null], [...B, 3], 'pearson');
		expect(correlate([...S(A), ''], [...S(B), '3'], 'pearson')).toEqual(want);
		expect(want.n).toBe(8);
		const [row] = correlationMatrix([S(A), S(B)], ['a', 'b'], 'pearson');
		expect(row.r).toBeCloseTo(0.9320546490018, 12);
	});
});

// STAT-28: Spearman's p is EXACT (the permutation distribution of S = sum d^2, every one of the
// n! rankings equally likely) for n <= 9 without ties, as R's cor.test(method = 'spearman')
// computes it (AS 89, Best and Roberts 1975, exact branch); otherwise the t approximation, as
// scipy.stats.spearmanr and cor.test(exact = FALSE). Reference p from R 4.5.2
// cor.test(x, y, method = 'spearman', exact = length(x) <= 9).
describe('spearman p-value: exact for small n without ties', () => {
	const CASES = [
		['n = 5', [1, 2, 3, 4, 5], [2, 1, 4, 3, 5], 0.13333333333333333],
		['n = 9', [1, 2, 3, 4, 5, 6, 7, 8, 9], [2, 1, 4, 3, 6, 5, 9, 7, 8], 0.0020282186948853615],
		['n = 9, weak', [1, 2, 3, 4, 5, 6, 7, 8, 9], [5, 9, 1, 7, 3, 8, 2, 6, 4], 0.67774470899470896],
		['n = 4, perfect inverse', [1, 2, 3, 4], [4, 3, 2, 1], 0.083333333333333329],
		['n = 8', [1, 2, 3, 4, 5, 6, 7, 8], [1, 3, 2, 4, 6, 5, 8, 7], 0.002232142857142857],
		[
			'n = 10: t approximation',
			[1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
			[3, 1, 2, 6, 4, 5, 10, 7, 9, 8],
			0.0022200312259168407
		],
		['ties: t approximation', [1, 2, 2, 4, 5, 6], [1, 3, 2, 4, 6, 5], 0.0076658441874731574]
	];
	it.each(CASES)('%s matches R cor.test', (_label, x, y, p) => {
		expect(correlate(x, y, 'spearman').pvalue).toBeCloseTo(p, 13);
	});

	it('the exact p is capped at 1 (r = 0.5 on n = 3)', () => {
		expect(correlate([1, 2, 3], [1, 3, 2], 'spearman').pvalue).toBe(1);
	});

	it('a perfect rank agreement on small n is 2 / n!, not 0', () => {
		expect(correlate([1, 2, 3, 4, 5], [10, 20, 30, 40, 50], 'spearman').pvalue).toBeCloseTo(
			2 / 120,
			14
		);
	});

	it('Pearson is unchanged (t on n - 2 df)', () => {
		const x = [1, 2, 3, 4, 5];
		const y = [2, 1, 4, 3, 5];
		expect(correlate(x, y, 'pearson').pvalue).toBeCloseTo(0.10408803866182798, 12);
	});
});
