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
	mockColumns[1] = { name: 'treatment', getData: () => ['A', 'A', 'B', 'B', 'A', 'B', 'A', 'B', 'A', 'B'] };
	mockColumns[2] = { name: 'outcome', getData: () => ['win', 'lose', 'win', 'lose', 'win', 'win', 'lose', 'lose', 'win', 'lose'] };
	mockColumns[3] = { name: 'counts', getData: () => [10, 10, 10, 10] };
	mockColumns[4] = { name: 'category', getData: () => ['red', 'red', 'blue', 'green', 'red', 'blue', 'green', 'red'] };
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
});
