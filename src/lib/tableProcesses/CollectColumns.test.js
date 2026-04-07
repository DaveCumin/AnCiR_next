import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockColumns, mockRawDataSet } = vi.hoisted(() => ({
	mockColumns: {},
	mockRawDataSet: vi.fn()
}));

vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData: { set: mockRawDataSet } },
	appConsts: { processMap: new Map() }
}));
vi.mock('$lib/core/Column.svelte', () => ({
	getColumnById: (id) => mockColumns[id],
	removeColumn: vi.fn()
}));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/ColumnSelector.svelte', () => ({ default: {} }));

import { collectcolumns } from './CollectColumns.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	mockRawDataSet.mockClear();
});

describe('collectcolumns', () => {
	it('returns invalid when no columns selected', () => {
		const [, valid] = collectcolumns({ colIds: [], out: {}, preProcesses: [], aggregates: [] });
		expect(valid).toBe(false);
	});

	it('returns invalid when a column is not found', () => {
		const [, valid] = collectcolumns({ colIds: [99], out: {}, preProcesses: [], aggregates: [] });
		expect(valid).toBe(false);
	});

	it('collects data from each column in preview mode', () => {
		mockColumns[1] = { getData: () => [1, 2, 3], type: 'number' };
		mockColumns[2] = { getData: () => [4, 5, 6], type: 'number' };
		const [result, valid] = collectcolumns({ colIds: [1, 2], out: {}, preProcesses: [], aggregates: [] });
		expect(valid).toBe(true);
		expect(result[1]).toEqual([1, 2, 3]);
		expect(result[2]).toEqual([4, 5, 6]);
	});

	it('computes mean aggregate and writes to core.rawData', () => {
		mockColumns[1] = { getData: () => [2, 4, 6], type: 'number', data: null, tableProcessGUId: null };
		mockColumns[2] = { getData: () => [4, 8, 12], type: 'number', data: null, tableProcessGUId: null };
		// Output column stubs — getData returns the same data (no column-level processes)
		mockColumns[10] = { getData: () => [2, 4, 6], data: null, type: null, tableProcessGUId: null };
		mockColumns[11] = { getData: () => [4, 8, 12], data: null, type: null, tableProcessGUId: null };
		mockColumns[20] = { data: null, type: null, tableProcessGUId: null };

		collectcolumns({
			colIds: [1, 2],
			out: { col_1: 10, col_2: 11 },
			preProcesses: [],
			aggregates: [{ method: 'mean', excludedColIds: [], outColId: 20 }]
		});

		// Aggregate output (id=20) should have been written with mean of each row
		const call = mockRawDataSet.mock.calls.find(([id]) => id === 20);
		expect(call).toBeDefined();
		const aggData = call[1];
		expect(aggData[0]).toBeCloseTo(3, 6); // mean(2,4)
		expect(aggData[1]).toBeCloseTo(6, 6); // mean(4,8)
		expect(aggData[2]).toBeCloseTo(9, 6); // mean(6,12)
	});

	it('computes min aggregate', () => {
		mockColumns[1] = { getData: () => [10, 5], type: 'number', data: null, tableProcessGUId: null };
		mockColumns[2] = { getData: () => [3, 8], type: 'number', data: null, tableProcessGUId: null };
		mockColumns[10] = { getData: () => [10, 5], data: null, type: null, tableProcessGUId: null };
		mockColumns[11] = { getData: () => [3, 8], data: null, type: null, tableProcessGUId: null };
		mockColumns[20] = { data: null, type: null, tableProcessGUId: null };

		collectcolumns({
			colIds: [1, 2],
			out: { col_1: 10, col_2: 11 },
			preProcesses: [],
			aggregates: [{ method: 'min', excludedColIds: [], outColId: 20 }]
		});

		const call = mockRawDataSet.mock.calls.find(([id]) => id === 20);
		expect(call[1]).toEqual([3, 5]);
	});
});
