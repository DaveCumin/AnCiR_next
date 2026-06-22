import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: new Map(), tableProcesses: [] } }));
vi.mock('$lib/core/Column.svelte', () => ({
	getColumnById: (id) => mockColumns[id],
	Column: class {},
	removeColumn: vi.fn()
}));
vi.mock('$lib/components/inputs/ColumnSelector.svelte', () => ({ default: {} }));

import { sortdata } from './Sort.svelte';
import { core } from '$lib/core/core.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	core.rawData.clear();
});

function outCol() {
	return { type: 'number', data: -1 };
}

describe('sortdata (single multi-input + sort-on picker)', () => {
	it('is invalid when there are no inputs', () => {
		const [, valid] = sortdata({ yIN: [], sortOnId: -1, direction: 'asc', out: {} });
		expect(valid).toBe(false);
	});

	it('reorders every input together by the chosen sort-on column', () => {
		mockColumns[1] = { type: 'number', getData: () => [3, 1, 2] };
		mockColumns[2] = { type: 'category', getData: () => ['c', 'a', 'b'] };
		mockColumns[100] = outCol();
		mockColumns[101] = outCol();

		const [result, valid] = sortdata({
			yIN: [1, 2],
			sortOnId: 1,
			direction: 'asc',
			out: { sortedy_1: 100, sortedy_2: 101 }
		});

		expect(valid).toBe(true);
		expect(result.order).toEqual([1, 2, 0]);
		expect(result.y_results[1]).toEqual([1, 2, 3]); // the sort-on column, sorted
		expect(result.y_results[2]).toEqual(['a', 'b', 'c']); // carried, row-aligned
		expect(core.rawData.get(100)).toEqual([1, 2, 3]);
		expect(core.rawData.get(101)).toEqual(['a', 'b', 'c']);
	});

	it('can sort on the second input', () => {
		mockColumns[1] = { type: 'category', getData: () => ['c', 'a', 'b'] };
		mockColumns[2] = { type: 'number', getData: () => [3, 1, 2] };
		mockColumns[100] = outCol();
		mockColumns[101] = outCol();
		const [result] = sortdata({
			yIN: [1, 2],
			sortOnId: 2,
			direction: 'asc',
			out: { sortedy_1: 100, sortedy_2: 101 }
		});
		expect(result.y_results[2]).toEqual([1, 2, 3]);
		expect(result.y_results[1]).toEqual(['a', 'b', 'c']);
	});

	it('defaults the sort-on column to the first input when unset', () => {
		mockColumns[1] = { type: 'number', getData: () => [3, 1, 2] };
		mockColumns[100] = outCol();
		const [result, valid] = sortdata({
			yIN: [1],
			sortOnId: -1,
			direction: 'asc',
			out: { sortedy_1: 100 }
		});
		expect(valid).toBe(true);
		expect(result.y_results[1]).toEqual([1, 2, 3]);
	});

	it('sorts descending', () => {
		mockColumns[1] = { type: 'number', getData: () => [3, 1, 2] };
		mockColumns[100] = outCol();
		const [result] = sortdata({ yIN: [1], sortOnId: 1, direction: 'desc', out: { sortedy_1: 100 } });
		expect(result.y_results[1]).toEqual([3, 2, 1]);
	});

	it('keeps rows with a missing key value last, alignment preserved', () => {
		mockColumns[1] = { type: 'number', getData: () => [2, null, 1] };
		mockColumns[2] = { type: 'category', getData: () => ['b', 'x', 'a'] };
		mockColumns[100] = outCol();
		mockColumns[101] = outCol();
		const [result] = sortdata({
			yIN: [1, 2],
			sortOnId: 1,
			direction: 'asc',
			out: { sortedy_1: 100, sortedy_2: 101 }
		});
		expect(result.y_results[1]).toEqual([1, 2, null]);
		expect(result.y_results[2]).toEqual(['a', 'b', 'x']);
	});

	it('passes a mismatched-length input through rather than misaligning it', () => {
		mockColumns[1] = { type: 'number', getData: () => [3, 1, 2] };
		mockColumns[2] = { type: 'number', getData: () => [10, 20] }; // wrong length
		mockColumns[100] = outCol();
		mockColumns[101] = outCol();
		const [result] = sortdata({
			yIN: [1, 2],
			sortOnId: 1,
			direction: 'asc',
			out: { sortedy_1: 100, sortedy_2: 101 }
		});
		expect(result.y_results[2]).toEqual([10, 20]);
	});

	it('preserves time type and clears the format on a sorted time output', () => {
		mockColumns[1] = {
			type: 'time',
			getData: () => [300, 100, 200],
			originTime_ms: 100,
			timeFormat: 'YYYY'
		};
		mockColumns[100] = outCol();
		sortdata({ yIN: [1], sortOnId: 1, direction: 'asc', out: { sortedy_1: 100 } });
		expect(mockColumns[100].type).toBe('time');
		expect(mockColumns[100].timeFormat).toBeNull();
		expect(mockColumns[100].originTime_ms).toBe(100);
		expect(core.rawData.get(100)).toEqual([100, 200, 300]);
	});
});
