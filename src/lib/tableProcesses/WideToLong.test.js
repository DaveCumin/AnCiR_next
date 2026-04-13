// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockColumns, mockRawDataSet } = vi.hoisted(() => ({
	mockColumns: {},
	mockRawDataSet: vi.fn()
}));

vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData: { set: mockRawDataSet, get: vi.fn(), has: vi.fn() } }
}));
vi.mock('$lib/core/Column.svelte', () => ({
	getColumnById: (id) => mockColumns[id],
	removeColumn: vi.fn(),
	Column: class {
		constructor() {
			this.id = -1;
			this.name = '';
		}
	}
}));
vi.mock('$lib/components/inputs/ColumnSelector.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));

import { widetolong } from './WideToLong.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	mockRawDataSet.mockClear();
});

describe('widetolong', () => {
	it('returns invalid when required inputs are missing', () => {
		const [, valid] = widetolong({
			timeIN: -1,
			valueColIds: [],
			out: { time: -1, category: -1, value: -1 }
		});
		expect(valid).toBe(false);
	});

	it('unpivots multiple wide columns into time, category, and value arrays', () => {
		mockColumns[1] = { getData: () => [0, 1], type: 'time', name: 'time' };
		mockColumns[2] = { getData: () => [10, 20], type: 'number', name: 'light' };
		mockColumns[3] = { getData: () => [30, 40], type: 'number', name: 'temp' };

		const [result, valid] = widetolong({
			timeIN: 1,
			valueColIds: [2, 3],
			out: { time: -1, category: -1, value: -1 }
		});

		expect(valid).toBe(true);
		expect(result.time).toEqual([0, 1, 0, 1]);
		expect(result.category).toEqual(['light', 'light', 'temp', 'temp']);
		expect(result.value).toEqual([10, 20, 30, 40]);
	});

	it('drops empty and NaN source values', () => {
		mockColumns[1] = { getData: () => [0, 1, 2], type: 'number', name: 'time' };
		mockColumns[2] = { getData: () => [10, NaN, 12], type: 'number', name: 'light' };
		mockColumns[3] = { getData: () => ['', 14, null], type: 'number', name: 'temp' };

		const [result, valid] = widetolong({
			timeIN: 1,
			valueColIds: [2, 3],
			out: { time: -1, category: -1, value: -1 }
		});

		expect(valid).toBe(true);
		expect(result.time).toEqual([0, 2, 1]);
		expect(result.category).toEqual(['light', 'light', 'temp']);
		expect(result.value).toEqual([10, 12, 14]);
	});

	it('preserves the selected input column order when generating categories', () => {
		mockColumns[1] = { getData: () => [0, 1], type: 'number', name: 'time' };
		mockColumns[2] = { getData: () => [1, 2], type: 'number', name: 'A' };
		mockColumns[3] = { getData: () => [3, 4], type: 'number', name: 'B' };

		const [result] = widetolong({
			timeIN: 1,
			valueColIds: [3, 2],
			out: { time: -1, category: -1, value: -1 }
		});

		expect(result.category).toEqual(['B', 'B', 'A', 'A']);
		expect(result.value).toEqual([3, 4, 1, 2]);
	});

	it('writes committed output columns and updates metadata', () => {
		mockColumns[1] = {
			getData: () => [1000, 2000],
			type: 'time',
			name: 'time',
			timeFormat: 'unix'
		};
		mockColumns[2] = { getData: () => [5, 6], type: 'number', name: 'light' };
		mockColumns[10] = { data: null, type: null, timeFormat: null, tableProcessGUId: null };
		mockColumns[11] = { data: null, type: null, tableProcessGUId: null };
		mockColumns[12] = { data: null, type: null, tableProcessGUId: null };

		const [, valid] = widetolong({
			timeIN: 1,
			valueColIds: [2],
			out: { time: 10, category: 11, value: 12 }
		});

		expect(valid).toBe(true);
		expect(mockRawDataSet.mock.calls.find(([id]) => id === 10)?.[1]).toEqual([1000, 2000]);
		expect(mockRawDataSet.mock.calls.find(([id]) => id === 11)?.[1]).toEqual(['light', 'light']);
		expect(mockRawDataSet.mock.calls.find(([id]) => id === 12)?.[1]).toEqual([5, 6]);
		expect(mockColumns[10].type).toBe('time');
		expect(mockColumns[10].timeFormat).toBe('unix');
		expect(mockColumns[11].type).toBe('category');
		expect(mockColumns[12].type).toBe('number');
		expect(mockColumns[10].tableProcessGUId).toBeTruthy();
		expect(mockColumns[11].tableProcessGUId).toBe(mockColumns[10].tableProcessGUId);
		expect(mockColumns[12].tableProcessGUId).toBe(mockColumns[10].tableProcessGUId);
	});
});
