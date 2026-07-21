import { describe, it, expect } from 'vitest';
import { chiSquareGoodnessOfFit, chiSquareIndependence, contingencyTable, pUpperFromChiSq } from './chisquare.js';

// Reference values from scipy 1.x: stats.chisquare / stats.chi2_contingency.
describe('chiSquareGoodnessOfFit (scipy chisquare parity)', () => {
	it('matches scipy with explicit expected counts', () => {
		const r = chiSquareGoodnessOfFit([16, 18, 16, 14, 12, 12], [16, 16, 16, 16, 16, 8]);
		expect(r.statistic).toBeCloseTo(3.5, 6);
		expect(r.pvalue).toBeCloseTo(0.623388, 5);
		expect(r.df).toBe(5);
	});
	it('defaults to a uniform expectation', () => {
		// [10,10,10,10] is perfectly uniform → statistic 0, p 1.
		const r = chiSquareGoodnessOfFit([10, 10, 10, 10]);
		expect(r.statistic).toBeCloseTo(0, 9);
		expect(r.pvalue).toBeCloseTo(1, 9);
		expect(r.df).toBe(3);
	});
	it('rescales expected to the observed total (scipy behaviour)', () => {
		const r = chiSquareGoodnessOfFit([20, 30, 50], [1, 1, 1]); // expected → 33.33 each
		const manual = chiSquareGoodnessOfFit([20, 30, 50]);
		expect(r.statistic).toBeCloseTo(manual.statistic, 9);
	});
	it('returns NaN below k=2', () => {
		expect(Number.isNaN(chiSquareGoodnessOfFit([5]).statistic)).toBe(true);
	});
});

describe('chiSquareIndependence (scipy chi2_contingency parity)', () => {
	it('matches scipy on a 2×2 table with Yates correction', () => {
		const r = chiSquareIndependence([[10, 20], [30, 40]], true);
		expect(r.statistic).toBeCloseTo(0.446429, 5);
		expect(r.pvalue).toBeCloseTo(0.504036, 5);
		expect(r.df).toBe(1);
	});
	it('matches scipy on a 3×3 table without correction', () => {
		const r = chiSquareIndependence([[10, 20, 30], [6, 9, 17], [8, 12, 25]], false);
		expect(r.statistic).toBeCloseTo(0.635065, 5);
		expect(r.pvalue).toBeCloseTo(0.959089, 5);
		expect(r.df).toBe(4);
	});
	it('computes the expected counts (row×col/total)', () => {
		const r = chiSquareIndependence([[10, 20], [30, 40]], false);
		// row sums 30,70; col sums 40,60; total 100 → expected[0][0] = 30*40/100 = 12
		expect(r.expected[0][0]).toBeCloseTo(12, 9);
	});
	it('returns NaN for a degenerate table', () => {
		expect(Number.isNaN(chiSquareIndependence([[5]]).statistic)).toBe(true);
	});
});

describe('contingencyTable', () => {
	it('cross-tabulates two categorical arrays and skips incomplete rows', () => {
		const rows = ['a', 'a', 'b', 'b', 'a', 'b', null, 'a', 'a', 'b'];
		const cols = ['x', 'y', 'x', 'y', 'x', 'x', 'y', 'y', 'x', 'y'];
		const { rowLabels, colLabels, table } = contingencyTable(rows, cols);
		expect(rowLabels).toEqual(['a', 'b']);
		expect(colLabels).toEqual(['x', 'y']);
		// a: x×3 (i=0,4,8), y×2 (i=1,7); b: x×2 (i=2,5), y×2 (i=3,9); i=6 skipped (null row)
		expect(table).toEqual([[3, 2], [2, 2]]);
	});
});

describe('pUpperFromChiSq', () => {
	it('matches the χ²(2) analytic tail exp(-x/2)', () => {
		expect(pUpperFromChiSq(4, 2)).toBeCloseTo(Math.exp(-2), 6);
	});
	it('is NaN for non-positive df', () => {
		expect(Number.isNaN(pUpperFromChiSq(4, 0))).toBe(true);
	});
});
