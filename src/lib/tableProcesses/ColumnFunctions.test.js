import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: { set: vi.fn() } } }));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));

import { columnfunctions } from './ColumnFunctions.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
});

const preview = { result: -1 };

describe('columnfunctions — add', () => {
	it('element-wise adds two numeric columns', () => {
		mockColumns[1] = { getData: () => [1, 2, 3], type: 'number' };
		mockColumns[2] = { getData: () => [10, 20, 30], type: 'number' };
		const [result, valid] = columnfunctions({ func: 'add', xsIN: [1, 2], out: preview });
		expect(valid).toBe(true);
		expect(result).toEqual([11, 22, 33]);
	});

	it('concatenates category columns with space', () => {
		mockColumns[1] = { getData: () => ['a', 'b'], type: 'category' };
		mockColumns[2] = { getData: () => ['x', 'y'], type: 'number' };
		const [result] = columnfunctions({ func: 'add', xsIN: [1, 2], out: preview });
		expect(result).toEqual(['a x', 'b y']);
	});
});

describe('columnfunctions — average', () => {
	it('computes element-wise mean', () => {
		mockColumns[1] = { getData: () => [2, 4, 6], type: 'number' };
		mockColumns[2] = { getData: () => [4, 8, 12], type: 'number' };
		const [result, valid] = columnfunctions({ func: 'average', xsIN: [1, 2], out: preview });
		expect(valid).toBe(true);
		result.forEach((v, i) => expect(v).toBeCloseTo([3, 6, 9][i], 8));
	});
});

describe('columnfunctions — min', () => {
	it('takes element-wise minimum', () => {
		mockColumns[1] = { getData: () => [5, 2, 8], type: 'number' };
		mockColumns[2] = { getData: () => [3, 7, 1], type: 'number' };
		const [result] = columnfunctions({ func: 'min', xsIN: [1, 2], out: preview });
		expect(result).toEqual([3, 2, 1]);
	});
});

describe('columnfunctions — max', () => {
	it('takes element-wise maximum', () => {
		mockColumns[1] = { getData: () => [5, 2, 8], type: 'number' };
		mockColumns[2] = { getData: () => [3, 7, 1], type: 'number' };
		const [result] = columnfunctions({ func: 'max', xsIN: [1, 2], out: preview });
		expect(result).toEqual([5, 7, 8]);
	});
});

describe('columnfunctions — sd', () => {
	it('returns 0 when only one column', () => {
		mockColumns[1] = { getData: () => [1, 2, 3], type: 'number' };
		const [result] = columnfunctions({ func: 'sd', xsIN: [1], out: preview });
		result.forEach((v) => expect(v).toBe(0));
	});

	it('computes sample SD across two columns', () => {
		// Values [1,3] at row 0: mean=2, sample sd = sqrt(((1-2)^2+(3-2)^2)/1) = sqrt(2)
		mockColumns[1] = { getData: () => [1, 0], type: 'number' };
		mockColumns[2] = { getData: () => [3, 0], type: 'number' };
		const [result] = columnfunctions({ func: 'sd', xsIN: [1, 2], out: preview });
		expect(result[0]).toBeCloseTo(Math.sqrt(2), 6);
		expect(result[1]).toBeCloseTo(0, 8);
	});
});

describe('columnfunctions — percentile', () => {
	it('computes the row-wise type-7 percentile across columns (numpy pins)', () => {
		// Rows [1,10,100] and [2,20,200] at p=30 — numpy.percentile(..., 30):
		// 6.4 and 12.8 (linear interpolation between the 1st and 2nd order stats).
		mockColumns[1] = { getData: () => [1, 2], type: 'number' };
		mockColumns[2] = { getData: () => [10, 20], type: 'number' };
		mockColumns[3] = { getData: () => [100, 200], type: 'number' };
		const [result, valid] = columnfunctions({
			func: 'percentile',
			percentile: 30,
			xsIN: [1, 2, 3],
			out: preview
		});
		expect(valid).toBe(true);
		expect(result[0]).toBeCloseTo(6.4, 12);
		expect(result[1]).toBeCloseTo(12.8, 12);
	});

	it('percentile 50 equals the row median exactly, and is the default', () => {
		mockColumns[1] = { getData: () => [1, 2], type: 'number' };
		mockColumns[2] = { getData: () => [10, 20], type: 'number' };
		mockColumns[3] = { getData: () => [100, 200], type: 'number' };
		const [at50] = columnfunctions({
			func: 'percentile',
			percentile: 50,
			xsIN: [1, 2, 3],
			out: preview
		});
		expect(at50).toEqual([10, 20]); // odd n → the middle value, exactly
		const [byDefault] = columnfunctions({ func: 'percentile', xsIN: [1, 2, 3], out: preview });
		expect(byDefault).toEqual(at50);
	});

	it('drops missing cells per row (blank string / null), NaN when none valid', () => {
		// Row 0: [1, '', 100] → percentile over [1, 100]; p=30 → 30.7 (numpy pin
		// on [1,100]: 1 + 0.3*99). Row 1: all missing → NaN.
		mockColumns[1] = { getData: () => [1, null], type: 'number' };
		mockColumns[2] = { getData: () => ['', ''], type: 'number' };
		mockColumns[3] = { getData: () => [100, NaN], type: 'number' };
		const [result] = columnfunctions({
			func: 'percentile',
			percentile: 30,
			xsIN: [1, 2, 3],
			out: preview
		});
		expect(result[0]).toBeCloseTo(30.7, 12);
		expect(Number.isNaN(result[1])).toBe(true);
	});
});

describe('columnfunctions — invalid inputs', () => {
	it('returns invalid when no columns selected', () => {
		const [result, valid] = columnfunctions({ func: 'add', xsIN: [], out: preview });
		expect(valid).toBe(false);
		expect(result).toHaveLength(0);
	});

	it('returns invalid for unknown function', () => {
		mockColumns[1] = { getData: () => [1], type: 'number' };
		const [, valid] = columnfunctions({ func: 'bogus', xsIN: [1], out: preview });
		expect(valid).toBe(false);
	});
});
