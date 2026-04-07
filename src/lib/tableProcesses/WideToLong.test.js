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

import { widetolong } from './WideToLong.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	mockRawDataSet.mockClear();
});

describe('widetolong', () => {
	it('returns invalid when inputs are -1', () => {
		const [, valid] = widetolong({ categoryIN: -1, timeIN: -1, valueIN: -1, out: { time: -1 }, preProcesses: [], aggregates: [] });
		expect(valid).toBe(false);
	});

	it('pivots category/time/value columns to wide format', () => {
		mockColumns[1] = { getData: () => ['A', 'A', 'B', 'B'] };          // category
		mockColumns[2] = { getData: () => [0, 1, 0, 1] };                   // time
		mockColumns[3] = { getData: () => [10, 20, 30, 40] };               // value

		const [result, valid] = widetolong({
			categoryIN: 1, timeIN: 2, valueIN: 3,
			out: { time: -1 }, preProcesses: [], aggregates: []
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

		const [result] = widetolong({
			categoryIN: 1, timeIN: 2, valueIN: 3,
			out: { time: -1 }, preProcesses: [], aggregates: []
		});

		expect(isNaN(result.value_A[1])).toBe(true); // A has no value at time 1
		expect(isNaN(result.value_B[0])).toBe(true); // B has no value at time 0
	});

	it('returns valid=false for empty data', () => {
		mockColumns[1] = { getData: () => [] };
		mockColumns[2] = { getData: () => [] };
		mockColumns[3] = { getData: () => [] };

		const [, valid] = widetolong({
			categoryIN: 1, timeIN: 2, valueIN: 3,
			out: { time: -1 }, preProcesses: [], aggregates: []
		});

		expect(valid).toBe(false);
	});
});
