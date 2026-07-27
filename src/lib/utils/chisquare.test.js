import { describe, it, expect } from 'vitest';
import {
	chiSquareGoodnessOfFit,
	chiSquareIndependence,
	contingencyTable,
	pUpperFromChiSq,
	isMissingCategory,
	cohensW,
	effectSizeLabel
} from './chisquare.js';

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
		const r = chiSquareIndependence(
			[
				[10, 20],
				[30, 40]
			],
			true
		);
		expect(r.statistic).toBeCloseTo(0.446429, 5);
		expect(r.pvalue).toBeCloseTo(0.504036, 5);
		expect(r.df).toBe(1);
	});
	it('matches scipy on a 3×3 table without correction', () => {
		const r = chiSquareIndependence(
			[
				[10, 20, 30],
				[6, 9, 17],
				[8, 12, 25]
			],
			false
		);
		expect(r.statistic).toBeCloseTo(0.635065, 5);
		expect(r.pvalue).toBeCloseTo(0.959089, 5);
		expect(r.df).toBe(4);
	});
	it('computes the expected counts (row×col/total)', () => {
		const r = chiSquareIndependence(
			[
				[10, 20],
				[30, 40]
			],
			false
		);
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
		expect(table).toEqual([
			[3, 2],
			[2, 2]
		]);
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

describe('contingencyTable — NaN is missing data, not a category', () => {
	// Reported from the app: two Enter Data columns padded with NaN produced a
	// 3x3 table with a phantom "NaN" row and column. Consequences were BOTH a
	// crash (two zero cells in the NaN row collided in a keyed each) and, worse,
	// a wrong answer: df 4 and p = 0.04 where the real 2x2 test gives df 1, p = 1.
	const rowVar = ['a', 'b', 'a', 'b', 'a', 'b', NaN, NaN, NaN];
	const colVar = ['a', 'a', 'a', 'b', 'b', 'b', NaN, NaN, NaN];

	it('excludes NaN-padded rows entirely', () => {
		const { rowLabels, colLabels, table } = contingencyTable(rowVar, colVar);
		expect(rowLabels).toEqual(['a', 'b']);
		expect(colLabels).toEqual(['a', 'b']);
		expect(table).toEqual([
			[2, 1],
			[1, 2]
		]);
	});

	it('gives the correct degrees of freedom (the bug reported df 4 for a 2x2)', () => {
		const { table } = contingencyTable(rowVar, colVar);
		expect(chiSquareIndependence(table, true).df).toBe(1);
	});

	it('no longer turns a null result into a false positive', () => {
		const { table } = contingencyTable(rowVar, colVar);
		expect(chiSquareIndependence(table, true).pvalue).toBeCloseTo(1, 10);
	});

	it('treats the string "NaN" as missing too', () => {
		// The data grid renders an empty/invalid cell as the text NaN, so a value
		// that stringifies to "NaN" is missing data in this app.
		const { rowLabels } = contingencyTable(['a', 'b', 'NaN'], ['x', 'y', 'x']);
		expect(rowLabels).toEqual(['a', 'b']);
	});

	it('still drops null and blank as before', () => {
		const { rowLabels, colLabels } = contingencyTable(['a', null, '', 'b'], ['x', 'y', 'x', 'y']);
		expect(rowLabels).toEqual(['a', 'b']);
		expect(colLabels).toEqual(['x', 'y']);
	});

	it('does NOT drop legitimate categories that merely look numeric', () => {
		const { rowLabels } = contingencyTable([0, 1, 0, 1], ['x', 'y', 'x', 'y']);
		expect(rowLabels).toEqual(['0', '1']);
	});
});

describe('isMissingCategory', () => {
	it('flags the missing forms', () => {
		for (const v of [null, undefined, '', NaN, 'NaN']) expect(isMissingCategory(v)).toBe(true);
	});
	it('keeps real categories, including 0 and false', () => {
		for (const v of ['a', 0, 1, false, 'nan', ' ']) expect(isMissingCategory(v)).toBe(false);
	});
});

describe('effect sizes', () => {
	// Cramér's V is checked against scipy.stats.contingency.association(method='cramer').
	it("Cramér's V matches scipy on a 2x2", () => {
		const r = chiSquareIndependence(
			[
				[10, 20],
				[30, 15]
			],
			false
		);
		expect(r.cramersV).toBeCloseTo(0.327326835, 9);
	});

	it("Cramér's V matches scipy on a 3x3", () => {
		const r = chiSquareIndependence(
			[
				[10, 20, 30],
				[6, 9, 17],
				[8, 12, 25]
			],
			false
		);
		expect(r.cramersV).toBeCloseTo(0.048143072, 9);
	});

	it('is UNCHANGED by Yates’ correction', () => {
		// The correction makes the p-value less liberal on a 2x2; it is not an
		// estimate of association strength, so the effect size must not shrink
		// with it. (The statistic itself does change.)
		const t = [
			[10, 20],
			[30, 15]
		];
		const withY = chiSquareIndependence(t, true);
		const without = chiSquareIndependence(t, false);
		expect(withY.statistic).not.toBeCloseTo(without.statistic, 6);
		expect(withY.cramersV).toBeCloseTo(without.cramersV, 12);
	});

	it('on a 2x2, V equals |phi|, and phi carries the sign', () => {
		const t = [
			[10, 20],
			[30, 15]
		];
		const r = chiSquareIndependence(t, false);
		expect(Math.abs(r.phi)).toBeCloseTo(r.cramersV, 12);
		// ad - bc = 150 - 600 < 0, so the anti-diagonal dominates.
		expect(r.phi).toBeLessThan(0);
	});

	it('phi flips sign when the table is mirrored', () => {
		const a = chiSquareIndependence(
			[
				[10, 20],
				[30, 15]
			],
			false
		);
		const b = chiSquareIndependence(
			[
				[20, 10],
				[15, 30]
			],
			false
		);
		expect(b.phi).toBeCloseTo(-a.phi, 12);
		expect(b.cramersV).toBeCloseTo(a.cramersV, 12); // V cannot show direction
	});

	it('phi is NaN for anything larger than 2x2', () => {
		const r = chiSquareIndependence(
			[
				[10, 20, 30],
				[6, 9, 17],
				[8, 12, 25]
			],
			false
		);
		expect(Number.isNaN(r.phi)).toBe(true);
		expect(Number.isFinite(r.cramersV)).toBe(true);
	});

	it('V is 0 for a table with no association and ~1 for perfect separation', () => {
		const none = chiSquareIndependence(
			[
				[10, 10],
				[10, 10]
			],
			false
		);
		expect(none.cramersV).toBeCloseTo(0, 12);
		const perfect = chiSquareIndependence(
			[
				[20, 0],
				[0, 20]
			],
			false
		);
		expect(perfect.cramersV).toBeCloseTo(1, 12);
	});

	it('V is invariant to scaling the whole table up', () => {
		// The statistic scales with n; the effect size must not.
		const small = chiSquareIndependence(
			[
				[8, 2],
				[2, 8]
			],
			false
		);
		const big = chiSquareIndependence(
			[
				[80, 20],
				[20, 80]
			],
			false
		);
		expect(big.statistic).toBeGreaterThan(small.statistic * 5);
		expect(big.cramersV).toBeCloseTo(small.cramersV, 12);
	});

	it("Cohen's w is sqrt(chi2 / n)", () => {
		expect(cohensW(12.5, 100)).toBeCloseTo(Math.sqrt(0.125), 12);
		expect(cohensW(0, 50)).toBe(0);
	});

	it("Cohen's w is NaN on unusable input rather than Infinity", () => {
		expect(Number.isNaN(cohensW(5, 0))).toBe(true);
		expect(Number.isNaN(cohensW(NaN, 10))).toBe(true);
	});

	it('effectSizeLabel uses the conventional bands', () => {
		expect(effectSizeLabel(0.05)).toBe('negligible');
		expect(effectSizeLabel(0.15)).toBe('small');
		expect(effectSizeLabel(0.3)).toBe('moderate');
		expect(effectSizeLabel(0.5)).toBe('relatively strong');
		expect(effectSizeLabel(0.8)).toBe('strong');
		expect(effectSizeLabel(-0.8)).toBe('strong'); // sign-insensitive
		expect(effectSizeLabel(NaN)).toBe('');
	});
});
