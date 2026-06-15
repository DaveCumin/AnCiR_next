import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockColumns, mockRawDataSet } = vi.hoisted(() => ({
	mockColumns: {},
	mockRawDataSet: vi.fn()
}));

vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData: { set: mockRawDataSet, get: vi.fn(), has: vi.fn() } },
	appConsts: { processMap: new Map() },
	pushObj: vi.fn()
}));
vi.mock('$lib/core/Column.svelte', () => ({
	getColumnById: (id) => mockColumns[id],
	removeColumn: vi.fn(),
	Column: class { constructor() { this.id = -1; this.name = ''; } }
}));
vi.mock('$lib/components/inputs/ColumnSelector.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));

import { longtowide, evaluateLongToWide } from './LongToWide.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	mockRawDataSet.mockClear();
});

describe('longtowide', () => {
	it('returns invalid when inputs are -1', () => {
		const [, valid] = longtowide({ categoryIN: -1, timeIN: -1, valueIN: -1, out: { time: -1 }, preProcesses: [] });
		expect(valid).toBe(false);
	});

	it('pivots long-format category/time/value columns to wide format', () => {
		mockColumns[1] = { getData: () => ['A', 'A', 'B', 'B'] };          // category
		mockColumns[2] = { getData: () => [0, 1, 0, 1] };                   // time
		mockColumns[3] = { getData: () => [10, 20, 30, 40] };               // value

		const [result, valid] = longtowide({
			categoryIN: 1, timeIN: 2, valueIN: 3,
			out: { time: -1 }, preProcesses: []
		});

		expect(valid).toBe(true);
		expect(result.time).toEqual([0, 1]);
		expect(result.value_A).toEqual([10, 20]);
		expect(result.value_B).toEqual([30, 40]);
	});

	it('fills missing time slots with NaN', () => {
		// A has time 0, B has time 1 only
		mockColumns[1] = { getData: () => ['A', 'B'] };
		mockColumns[2] = { getData: () => [0, 1] };
		mockColumns[3] = { getData: () => [10, 20] };

		const [result] = longtowide({
			categoryIN: 1, timeIN: 2, valueIN: 3,
			out: { time: -1 }, preProcesses: []
		});

		expect(isNaN(result.value_A[1])).toBe(true); // A has no value at time 1
		expect(isNaN(result.value_B[0])).toBe(true); // B has no value at time 0
	});

	it('returns valid=false for empty data', () => {
		mockColumns[1] = { getData: () => [] };
		mockColumns[2] = { getData: () => [] };
		mockColumns[3] = { getData: () => [] };

		const [, valid] = longtowide({
			categoryIN: 1, timeIN: 2, valueIN: 3,
			out: { time: -1 }, preProcesses: []
		});

		expect(valid).toBe(false);
	});

	// --- Added edge cases & round-trip coverage ---

	it('returns invalid when a single input ref is missing (fail-safe, no throw)', () => {
		mockColumns[2] = { getData: () => [0, 1] };
		mockColumns[3] = { getData: () => [10, 20] };
		// categoryIN omitted (-1)
		expect(() =>
			longtowide({ categoryIN: -1, timeIN: 2, valueIN: 3, out: { time: -1 }, preProcesses: [] })
		).not.toThrow();
		const [, valid] = longtowide({
			categoryIN: -1, timeIN: 2, valueIN: 3, out: { time: -1 }, preProcesses: []
		});
		expect(valid).toBe(false);
	});

	it('treats undefined inputs as invalid', () => {
		const [res, valid] = evaluateLongToWide({});
		expect(valid).toBe(false);
		expect(res).toEqual({});
	});

	it('sorts the union of times ascending regardless of input order', () => {
		mockColumns[1] = { getData: () => ['A', 'A', 'A'] };
		mockColumns[2] = { getData: () => [2, 0, 1] };
		mockColumns[3] = { getData: () => [22, 0, 11] };

		const [result] = longtowide({
			categoryIN: 1, timeIN: 2, valueIN: 3, out: { time: -1 }, preProcesses: []
		});

		expect(result.time).toEqual([0, 1, 2]);
		expect(result.value_A).toEqual([0, 11, 22]);
	});

	it('skips null/empty category labels (sparse CSV) without creating phantom columns', () => {
		mockColumns[1] = { getData: () => ['A', '', null, 'B'] };
		mockColumns[2] = { getData: () => [0, 1, 2, 0] };
		mockColumns[3] = { getData: () => [10, 99, 99, 30] };

		const [result] = longtowide({
			categoryIN: 1, timeIN: 2, valueIN: 3, out: { time: -1 }, preProcesses: []
		});

		expect(Object.keys(result).filter((k) => k.startsWith('value_'))).toEqual(['value_A', 'value_B']);
		expect(result.value_A[0]).toBe(10);
		expect(result.value_B[0]).toBe(30);
	});

	it('keeps category column order by first appearance', () => {
		mockColumns[1] = { getData: () => ['B', 'A', 'B', 'A'] };
		mockColumns[2] = { getData: () => [0, 0, 1, 1] };
		mockColumns[3] = { getData: () => [1, 2, 3, 4] };

		const [result] = longtowide({
			categoryIN: 1, timeIN: 2, valueIN: 3, out: { time: -1 }, preProcesses: []
		});

		const valueKeys = Object.keys(result).filter((k) => k.startsWith('value_'));
		expect(valueKeys).toEqual(['value_B', 'value_A']);
	});

	it('handles a single row of data', () => {
		mockColumns[1] = { getData: () => ['A'] };
		mockColumns[2] = { getData: () => [5] };
		mockColumns[3] = { getData: () => [42] };

		const [result, valid] = longtowide({
			categoryIN: 1, timeIN: 2, valueIN: 3, out: { time: -1 }, preProcesses: []
		});

		expect(valid).toBe(true);
		expect(result.time).toEqual([5]);
		expect(result.value_A).toEqual([42]);
	});

	it('on duplicate (category,time) keys keeps the last value written', () => {
		mockColumns[1] = { getData: () => ['A', 'A'] };
		mockColumns[2] = { getData: () => [0, 0] };
		mockColumns[3] = { getData: () => [10, 20] };

		const [result] = longtowide({
			categoryIN: 1, timeIN: 2, valueIN: 3, out: { time: -1 }, preProcesses: []
		});

		expect(result.time).toEqual([0]);
		expect(result.value_A).toEqual([20]); // last wins
	});

	it('ragged groups: union time axis is shared; missing cells become NaN', () => {
		// A: times 0,1,2 ; B: times 1 only
		mockColumns[1] = { getData: () => ['A', 'A', 'A', 'B'] };
		mockColumns[2] = { getData: () => [0, 1, 2, 1] };
		mockColumns[3] = { getData: () => [10, 11, 12, 21] };

		const [result] = longtowide({
			categoryIN: 1, timeIN: 2, valueIN: 3, out: { time: -1 }, preProcesses: []
		});

		expect(result.time).toEqual([0, 1, 2]);
		expect(result.value_A).toEqual([10, 11, 12]);
		expect(isNaN(result.value_B[0])).toBe(true);
		expect(result.value_B[1]).toBe(21);
		expect(isNaN(result.value_B[2])).toBe(true);
	});

	it('round-trip: long -> wide preserves every (category,time)->value cell', () => {
		const cats = ['A', 'A', 'B', 'B', 'C'];
		const times = [0, 1, 0, 1, 0];
		const vals = [1, 2, 3, 4, 5];
		mockColumns[1] = { getData: () => cats };
		mockColumns[2] = { getData: () => times };
		mockColumns[3] = { getData: () => vals };

		const [result] = longtowide({
			categoryIN: 1, timeIN: 2, valueIN: 3, out: { time: -1 }, preProcesses: []
		});

		// Reconstruct long form from wide and compare to the original mapping.
		const original = new Map();
		for (let i = 0; i < cats.length; i++) original.set(cats[i] + '@' + times[i], vals[i]);

		for (const key of Object.keys(result)) {
			if (!key.startsWith('value_')) continue;
			const cat = key.slice('value_'.length);
			result[key].forEach((v, idx) => {
				if (Number.isNaN(v)) return;
				expect(v).toBe(original.get(cat + '@' + result.time[idx]));
			});
		}
	});
});
