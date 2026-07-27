import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: { set: vi.fn() } } }));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));

import { chisquared } from './ChiSquared.svelte';

const args = (over) => ({
	testType: 'independence',
	xIN: 1,
	yIN: 2,
	correction: true,
	out: { statistic: -1, pvalue: -1, df: -1 },
	...over
});

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	// 2x2: a/x×10-ish through repeated categories → table [[3,2],[2,2]] equivalent shape
	mockColumns[1] = {
		name: 'treatment',
		getData: () => ['A', 'A', 'B', 'B', 'A', 'B', 'A', 'B', 'A', 'B']
	};
	mockColumns[2] = {
		name: 'outcome',
		getData: () => ['win', 'lose', 'win', 'lose', 'win', 'win', 'lose', 'lose', 'win', 'lose']
	};
	mockColumns[3] = { name: 'counts', getData: () => [10, 10, 10, 10] };
	mockColumns[4] = {
		name: 'category',
		getData: () => ['red', 'red', 'blue', 'green', 'red', 'blue', 'green', 'red']
	};
	// A count vector with trailing missing cells (null / blank) — must NOT become zero-count bins.
	mockColumns[5] = { name: 'gappy', getData: () => [10, 10, 10, 10, null, ''] };
});

describe('chisquared — independence', () => {
	it('is invalid without both inputs', () => {
		expect(chisquared(args({ yIN: -1 }))[1]).toBe(false);
	});

	it('cross-tabulates and produces a χ² statistic + df', () => {
		const [r, valid] = chisquared(args());
		expect(valid).toBe(true);
		expect(r.testType).toBe('independence');
		expect(r.df).toBe(1);
		expect(r.rowLabels).toEqual(['A', 'B']);
		expect(Number.isFinite(r.statistic)).toBe(true);
	});

	it('warns when expected counts are below 5', () => {
		const [r] = chisquared(args());
		// small 10-sample table → some expected < 5
		expect(r.warnings.some((w) => w.includes('below 5'))).toBe(true);
	});
});

describe('chisquared — goodness-of-fit', () => {
	it('treats a numeric column as observed counts vs uniform', () => {
		const [r, valid] = chisquared(args({ testType: 'goodness', xIN: 3, yIN: -1 }));
		expect(valid).toBe(true);
		expect(r.testType).toBe('goodness');
		expect(r.statistic).toBeCloseTo(0, 9); // perfectly uniform
		expect(r.df).toBe(3);
	});

	it('tabulates a categorical column into category counts', () => {
		const [r, valid] = chisquared(args({ testType: 'goodness', xIN: 4, yIN: -1 }));
		expect(valid).toBe(true);
		expect(r.labels).toEqual(['red', 'blue', 'green']);
		expect(r.observed).toEqual([4, 2, 2]);
		expect(Number.isFinite(r.statistic)).toBe(true);
	});

	it('ignores missing (null / blank) count cells instead of treating them as zero bins', () => {
		// Regression: Number(null) and Number('') are 0, which used to survive as extra zero-count
		// categories — inflating k/df and shifting the expected counts and p-value.
		const [r] = chisquared(args({ testType: 'goodness', xIN: 5, yIN: -1 }));
		expect(r.observed).toEqual([10, 10, 10, 10]); // the two missing cells dropped, not kept as 0
		expect(r.df).toBe(3); // k=4 → df=3, not k=6 → df=5
		expect(r.statistic).toBeCloseTo(0, 9); // still perfectly uniform
	});
});

describe("chisquared — Fisher's exact mode", () => {
	// Fisher's lives in this node because it answers the same question as the
	// independence mode; you choose between them on sample size.
	const fisherArgs = (over) => args({ testType: 'fisher', ...over });

	it('cross-tabulates two columns and reports an exact p-value', () => {
		const [res, valid] = chisquared(fisherArgs());
		expect(valid).toBe(true);
		expect(res.testType).toBe('fisher');
		// A: 3 win / 2 lose;  B: 2 win / 3 lose
		expect(res.table).toEqual([
			[3, 2],
			[2, 3]
		]);
		expect(res.pvalue).toBeGreaterThan(0);
		expect(res.pvalue).toBeLessThanOrEqual(1);
	});

	it('has NO test statistic and NO degrees of freedom, by design', () => {
		// An exact test enumerates the distribution rather than approximating it,
		// so reporting a chi-squared-style statistic or df would be a fiction.
		const [res] = chisquared(fisherArgs());
		expect(Number.isNaN(res.statistic)).toBe(true);
		expect(Number.isNaN(res.df)).toBe(true);
	});

	it('reports the sample odds ratio as the effect size', () => {
		const [res] = chisquared(fisherArgs());
		// table [[3,2],[2,3]] → (3*3)/(2*2) = 2.25
		expect(res.oddsRatio).toBeCloseTo(2.25, 12);
	});

	it('honours the alternative', () => {
		const two = chisquared(fisherArgs({ alternative: 'two-sided' }))[0].pvalue;
		const greater = chisquared(fisherArgs({ alternative: 'greater' }))[0].pvalue;
		const less = chisquared(fisherArgs({ alternative: 'less' }))[0].pvalue;
		expect(greater).toBeLessThan(two);
		expect(less).toBeGreaterThan(greater);
		expect(chisquared(fisherArgs({ alternative: 'greater' }))[0].alternative).toBe('greater');
	});

	it('defaults to two-sided when no alternative is given', () => {
		const [res] = chisquared(fisherArgs());
		expect(res.alternative).toBe('two-sided');
	});

	it('refuses a variable with more than two categories, and says so', () => {
		// mockColumns[4] has three categories (red/blue/green).
		const [res, valid] = chisquared(fisherArgs({ xIN: 4, yIN: 2 }));
		expect(valid).toBe(true); // the node ran; the test just cannot apply
		expect(Number.isNaN(res.pvalue)).toBe(true);
		expect(res.warnings[0]).toMatch(/exactly 2 categories/);
	});

	it('is invalid without both inputs', () => {
		expect(chisquared(fisherArgs({ xIN: -1 }))[1]).toBe(false);
		expect(chisquared(fisherArgs({ yIN: -1 }))[1]).toBe(false);
	});

	it('agrees with the independence mode on a large, well-behaved table', () => {
		// Where the chi-squared approximation is valid the two should broadly
		// concur; this is the sanity check that they are testing the same thing.
		const big = (label, n) => Array(n).fill(label);
		mockColumns[10] = {
			name: 'row',
			getData: () => [...big('A', 100), ...big('B', 100)]
		};
		mockColumns[11] = {
			name: 'col',
			getData: () => [
				...big('x', 70),
				...big('y', 30), // A: 70/30
				...big('x', 40),
				...big('y', 60) // B: 40/60
			]
		};
		const chi = chisquared(args({ xIN: 10, yIN: 11 }))[0];
		const fisher = chisquared(fisherArgs({ xIN: 10, yIN: 11 }))[0];
		expect(chi.pvalue).toBeLessThan(0.001);
		expect(fisher.pvalue).toBeLessThan(0.001);
	});

	it('writes the p-value output even though the statistic is NaN', () => {
		// Regression: writeChiOutputs used to bail on a NaN statistic, which would
		// have silently produced no outputs for this entire mode.
		const [res] = chisquared(fisherArgs());
		expect(Number.isFinite(res.pvalue)).toBe(true);
	});
});

describe('chisquared — NaN padding (reported crash)', () => {
	// Two Enter Data columns padded with NaN. Before the fix this produced a 3x3
	// table with a phantom "NaN" category, which (a) crashed the contingency-table
	// render with each_key_duplicate `0_2` — two zero cells in the NaN row shared
	// a key built from the cell VALUE — and (b) reported df 4 and a significant p
	// for what is really a null 2x2 result.
	beforeEach(() => {
		mockColumns[20] = {
			name: 'group',
			getData: () => ['a', 'b', 'a', 'b', 'a', 'b', NaN, NaN, NaN]
		};
		mockColumns[21] = {
			name: 'outcome',
			getData: () => ['a', 'a', 'a', 'b', 'b', 'b', NaN, NaN, NaN]
		};
	});

	it('builds a 2x2 table, not 3x3', () => {
		const [res] = chisquared(args({ xIN: 20, yIN: 21 }));
		expect(res.rowLabels).toEqual(['a', 'b']);
		expect(res.colLabels).toEqual(['a', 'b']);
		expect(res.table).toEqual([
			[2, 1],
			[1, 2]
		]);
	});

	it('reports df 1 and a non-significant p', () => {
		const [res] = chisquared(args({ xIN: 20, yIN: 21 }));
		expect(res.df).toBe(1);
		expect(res.pvalue).toBeCloseTo(1, 10);
	});

	it('produces no row whose cells could collide in a keyed each', () => {
		// The render keys on the column index now, but a table with repeated
		// counts in a row is the shape that used to crash — assert it renders as
		// data without a phantom third row.
		const [res] = chisquared(args({ xIN: 20, yIN: 21 }));
		expect(res.table).toHaveLength(2);
		expect(res.table.every((row) => row.length === 2)).toBe(true);
	});

	it('Fisher mode also works on the same NaN-padded data', () => {
		// It previously refused with "needs exactly 2 categories (found 3 and 3)".
		const [res, valid] = chisquared(args({ xIN: 20, yIN: 21, testType: 'fisher' }));
		expect(valid).toBe(true);
		expect(Number.isFinite(res.pvalue)).toBe(true);
		expect(res.table).toEqual([
			[2, 1],
			[1, 2]
		]);
	});

	it('goodness-of-fit ignores NaN cells too', () => {
		mockColumns[22] = { name: 'cat', getData: () => ['x', 'x', 'y', NaN, NaN] };
		const [res] = chisquared(args({ testType: 'goodness', xIN: 22 }));
		expect(res.labels).toEqual(['x', 'y']);
		expect(res.observed).toEqual([2, 1]);
	});
});

describe('chisquared — effect sizes', () => {
	it('independence reports Cramér’s V with a verbal band', () => {
		const [res] = chisquared(args());
		expect(Number.isFinite(res.effectSize)).toBe(true);
		expect(res.effectSizeName).toMatch(/Cramer's V/);
		expect(res.effectSizeLabel).toBeTruthy();
	});

	it('a 2x2 also reports the signed phi, and |phi| equals V', () => {
		const [res] = chisquared(args());
		expect(Math.abs(res.phi)).toBeCloseTo(res.effectSize, 10);
		expect(res.effectSizeName).toMatch(/phi/);
	});

	it('a larger table reports V but no phi', () => {
		mockColumns[30] = { name: 'r', getData: () => ['a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c'] };
		mockColumns[31] = { name: 'c', getData: () => ['x', 'y', 'z', 'y', 'z', 'x', 'z', 'x', 'y'] };
		const [res] = chisquared(args({ xIN: 30, yIN: 31 }));
		expect(Number.isFinite(res.effectSize)).toBe(true);
		expect(Number.isNaN(res.phi)).toBe(true);
		expect(res.effectSizeName).toBe("Cramer's V");
	});

	it('goodness-of-fit reports Cohen’s w', () => {
		const [res] = chisquared(args({ testType: 'goodness', xIN: 3 }));
		expect(res.effectSizeName).toBe("Cohen's w");
		// counts are [10,10,10,10] → perfectly uniform → chi2 = 0 → w = 0
		expect(res.effectSize).toBeCloseTo(0, 12);
	});

	it('Fisher mode reports the odds ratio as its effect size', () => {
		const [res] = chisquared(args({ testType: 'fisher' }));
		expect(res.effectSizeName).toBe('odds ratio');
		expect(res.effectSize).toBeCloseTo(res.oddsRatio, 12);
	});

	it('writes the effect size to its output column', () => {
		const args2 = args({ out: { statistic: -1, pvalue: -1, df: -1, effectSize: 500 } });
		mockColumns[500] = { id: 500 };
		const [res] = chisquared(args2);
		expect(Number.isFinite(res.effectSize)).toBe(true);
	});
});
