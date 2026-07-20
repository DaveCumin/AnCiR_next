import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: { set: vi.fn() } } }));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));

import { correlation } from './Correlation.svelte';

const OUT = { var_i: -1, var_j: -1, r: -1, pvalue: -1, n: -1 };
const args = (over) => ({ yIN: [1, 2, 3], method: 'pearson', alpha: 0.05, out: { ...OUT }, ...over });

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	// a, b=2a (r=+1), c=-a (r=-1)
	mockColumns[1] = { name: 'a', getData: () => [1, 2, 3, 4, 5] };
	mockColumns[2] = { name: 'b', getData: () => [2, 4, 6, 8, 10] };
	mockColumns[3] = { name: 'c', getData: () => [5, 4, 3, 2, 1] };
});

describe('correlation', () => {
	it('is invalid with fewer than 2 wired columns', () => {
		const [, valid] = correlation(args({ yIN: [1] }));
		expect(valid).toBe(false);
	});

	it('emits one row per unique pair, with the columns names', () => {
		const [res, valid] = correlation(args());
		expect(valid).toBe(true);
		expect(res.rows).toHaveLength(3); // (a,b) (a,c) (b,c)
		expect(res.rows.map((row) => `${row.var_i}-${row.var_j}`)).toEqual(['a-b', 'a-c', 'b-c']);
	});

	it('computes the coefficients', () => {
		const [res] = correlation(args());
		const get = (i, j) => res.rows.find((row) => row.var_i === i && row.var_j === j);
		expect(get('a', 'b').r).toBeCloseTo(1, 9);
		expect(get('a', 'c').r).toBeCloseTo(-1, 9);
	});

	it('auto method picks Pearson when all columns are ~normal', () => {
		// 12 roughly-normal values per column so Jarque-Bera is evaluable (n≥8).
		const norm = [-1.2, -0.6, -0.3, -0.1, 0, 0.1, 0.2, 0.35, 0.5, 0.7, 1.0, 1.4];
		mockColumns[1] = { name: 'a', getData: () => norm };
		mockColumns[2] = { name: 'b', getData: () => norm.map((v) => v + 0.01) };
		const [res] = correlation(args({ yIN: [1, 2], method: 'auto' }));
		expect(res.methodUsed).toBe('pearson');
	});

	it('auto method switches to Spearman when a column is clearly non-normal', () => {
		// A heavily skewed column (one huge outlier) fails Jarque-Bera.
		const skew = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1000];
		mockColumns[1] = { name: 'a', getData: () => skew };
		mockColumns[2] = { name: 'b', getData: () => skew.map((v, i) => v + i) };
		const [res] = correlation(args({ yIN: [1, 2], method: 'auto' }));
		expect(res.methodUsed).toBe('spearman');
		expect(res.warnings.join(' ')).toMatch(/normal|spearman/i);
	});

	it('warns on a small sample', () => {
		mockColumns[1] = { name: 'a', getData: () => [1, 2, 3] };
		mockColumns[2] = { name: 'b', getData: () => [2, 4, 5] };
		const [res, valid] = correlation(args({ yIN: [1, 2] }));
		expect(valid).toBe(true);
		expect(res.warnings.join(' ')).toMatch(/small|n *=|few/i);
	});

	it('a column of all-nulls yields NaN r for its pairs, not a thrown error', () => {
		mockColumns[3] = { name: 'c', getData: () => [null, null, null, null, null] };
		const [res, valid] = correlation(args());
		expect(valid).toBe(true);
		const ac = res.rows.find((row) => row.var_i === 'a' && row.var_j === 'c');
		expect(ac.r).toBeNaN();
	});
});
