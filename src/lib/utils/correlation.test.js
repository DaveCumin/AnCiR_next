import { describe, it, expect } from 'vitest';
import {
	rankAverage,
	pearson,
	spearman,
	correlationPValue,
	correlate,
	correlationMatrix
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
