import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: { set: vi.fn() } } }));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));

import { describedata } from './DescribeData.svelte';

const OUT = { variable: -1, n: -1, mean: -1, median: -1, sd: -1, min: -1, max: -1, range: -1, q1: -1, q3: -1, iqr: -1, skewness: -1, kurtosis: -1 };
const args = (over) => ({ yIN: [1, 2], out: { ...OUT }, ...over });

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	mockColumns[1] = { name: 'a', getData: () => [1, 2, 3, 4, 5] };
	mockColumns[2] = { name: 'b', getData: () => [10, 20, 30, 40, 50] };
});

describe('describedata', () => {
	it('is invalid with no wired columns', () => {
		expect(describedata(args({ yIN: [] }))[1]).toBe(false);
	});

	it('emits one row per variable with the stats', () => {
		const [r, valid] = describedata(args());
		expect(valid).toBe(true);
		expect(r.rows).toHaveLength(2);
		expect(r.rows.map((x) => x.variable)).toEqual(['a', 'b']);
		expect(r.rows[0].mean).toBeCloseTo(3, 9);
		expect(r.rows[0].n).toBe(5);
		expect(r.rows[1].mean).toBeCloseTo(30, 9);
		expect(r.rows[1].max).toBe(50);
	});

	it('drops nulls per column', () => {
		mockColumns[1] = { name: 'a', getData: () => [1, null, 3, NaN, 5] };
		const [r] = describedata(args());
		expect(r.rows[0].n).toBe(3);
		expect(r.rows[0].mean).toBeCloseTo(3, 9);
	});
});
