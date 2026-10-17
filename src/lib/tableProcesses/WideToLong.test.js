// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockColumns, mockRawDataSet, rawStore } = vi.hoisted(() => {
	const rawStore = new Map();
	return {
		mockColumns: {},
		rawStore,
		mockRawDataSet: vi.fn((id, data) => rawStore.set(id, data))
	};
});

vi.mock('$lib/core/core.svelte', () => ({
	core: {
		rawData: {
			set: mockRawDataSet,
			get: (id) => rawStore.get(id),
			has: (id) => rawStore.has(id)
		}
	}
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
	rawStore.clear();
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
			timeFormat: 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]'
		};
		mockColumns[2] = { getData: () => [5, 6], type: 'number', name: 'light' };
		// A session saved before the fix carries the source's text format on the output.
		mockColumns[10] = {
			data: null,
			type: null,
			timeFormat: 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]',
			tableProcessGUId: null
		};
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
		// The output holds getData()'s UNIX ms, so the source's text format must not
		// follow it there: it would re-parse every time as invalid (all blanks).
		expect(mockColumns[10].timeFormat).toBeNull();
		expect(mockColumns[11].type).toBe('category');
		expect(mockColumns[12].type).toBe('number');
		expect(mockColumns[10].tableProcessGUId).toBeTruthy();
		expect(mockColumns[11].tableProcessGUId).toBe(mockColumns[10].tableProcessGUId);
		expect(mockColumns[12].tableProcessGUId).toBe(mockColumns[10].tableProcessGUId);
	});

	it('missing cells follow the house rule: blank, whitespace and text drop a number cell', () => {
		mockColumns[1] = { getData: () => [0, 1, 2, 3, 4, 5], type: 'number', name: 'time' };
		mockColumns[2] = {
			getData: () => [5, '  ', 'abc', 0, '7', NaN],
			type: 'number',
			name: 'p'
		};

		const [result, valid] = widetolong({
			timeIN: 1,
			valueColIds: [2],
			out: { time: -1, category: -1, value: -1 }
		});

		expect(valid).toBe(true);
		// A real 0 and a numeric string are data; '  ', 'abc' and NaN are absence.
		expect(result.time).toEqual([0, 3, 4]);
		expect(result.value).toEqual([5, 0, '7']);
	});

	it('a missing time drops the row', () => {
		mockColumns[1] = { getData: () => [0, null, NaN, 3], type: 'time', name: 'time' };
		mockColumns[2] = { getData: () => [1, 2, 3, 4], type: 'number', name: 'p' };

		const [result] = widetolong({
			timeIN: 1,
			valueColIds: [2],
			out: { time: -1, category: -1, value: -1 }
		});

		expect(result.time).toEqual([0, 3]);
		expect(result.value).toEqual([1, 4]);
	});

	it('text labels in a category value column are values, only blank labels are missing', () => {
		mockColumns[1] = { getData: () => [0, 1, 2], type: 'number', name: 'time' };
		mockColumns[2] = { getData: () => ['wt', ' ', 'ko'], type: 'category', name: 'geno' };

		const [result] = widetolong({
			timeIN: 1,
			valueColIds: [2],
			out: { time: -1, category: -1, value: -1 }
		});

		expect(result.time).toEqual([0, 2]);
		expect(result.value).toEqual(['wt', 'ko']);
	});

	it('writes through the idempotent output writer: an unchanged re-run stamps nothing', () => {
		mockColumns[1] = { getData: () => [0, 1], type: 'number', name: 'time' };
		mockColumns[2] = { getData: () => [5, 6], type: 'number', name: 'light' };
		mockColumns[10] = { id: 10, data: null, type: null, tableProcessGUId: null };
		mockColumns[11] = { id: 11, data: null, type: null, tableProcessGUId: null };
		mockColumns[12] = { id: 12, data: null, type: null, tableProcessGUId: null };
		const args = { timeIN: 1, valueColIds: [2], out: { time: 10, category: 11, value: 12 } };

		widetolong(args);
		const stamps = [10, 11, 12].map((id) => mockColumns[id].tableProcessGUId);
		const writes = mockRawDataSet.mock.calls.length;
		widetolong(args);

		// Same data: no rawData write and no new hash, so nothing downstream recomputes.
		expect(mockRawDataSet.mock.calls.length).toBe(writes);
		expect([10, 11, 12].map((id) => mockColumns[id].tableProcessGUId)).toEqual(stamps);
	});

	// --- Added edge cases & round-trip coverage ---

	it('fails safe (no throw, valid=false) when timeIN ref is missing', () => {
		// timeIN points to a non-existent column id
		const [, valid] = widetolong({
			timeIN: 99,
			valueColIds: [2],
			out: { time: -1, category: -1, value: -1 }
		});
		expect(valid).toBe(false);
	});

	it('fails safe when a value column ref is missing', () => {
		mockColumns[1] = { getData: () => [0, 1], type: 'number', name: 'time' };
		// col 5 absent
		const [, valid] = widetolong({
			timeIN: 1,
			valueColIds: [5],
			out: { time: -1, category: -1, value: -1 }
		});
		expect(valid).toBe(false);
	});

	it('deduplicates and ignores negative valueColIds', () => {
		mockColumns[1] = { getData: () => [0, 1], type: 'number', name: 'time' };
		mockColumns[2] = { getData: () => [10, 20], type: 'number', name: 'A' };

		const [result, valid] = widetolong({
			timeIN: 1,
			valueColIds: [2, 2, -1],
			out: { time: -1, category: -1, value: -1 }
		});

		expect(valid).toBe(true);
		// col 2 should only contribute once despite being listed twice
		expect(result.category).toEqual(['A', 'A']);
		expect(result.value).toEqual([10, 20]);
	});

	it('returns invalid for empty input column', () => {
		mockColumns[1] = { getData: () => [], type: 'number', name: 'time' };
		mockColumns[2] = { getData: () => [], type: 'number', name: 'A' };

		const [, valid] = widetolong({
			timeIN: 1,
			valueColIds: [2],
			out: { time: -1, category: -1, value: -1 }
		});
		expect(valid).toBe(false);
	});

	it('handles ragged column lengths via Math.min row count', () => {
		mockColumns[1] = { getData: () => [0, 1, 2, 3], type: 'number', name: 'time' };
		mockColumns[2] = { getData: () => [10, 20], type: 'number', name: 'A' }; // shorter

		const [result] = widetolong({
			timeIN: 1,
			valueColIds: [2],
			out: { time: -1, category: -1, value: -1 }
		});

		expect(result.time).toEqual([0, 1]);
		expect(result.value).toEqual([10, 20]);
	});

	it('single row, single value column', () => {
		mockColumns[1] = { getData: () => [7], type: 'number', name: 'time' };
		mockColumns[2] = { getData: () => [99], type: 'number', name: 'A' };

		const [result, valid] = widetolong({
			timeIN: 1,
			valueColIds: [2],
			out: { time: -1, category: -1, value: -1 }
		});

		expect(valid).toBe(true);
		expect(result.time).toEqual([7]);
		expect(result.category).toEqual(['A']);
		expect(result.value).toEqual([99]);
	});

	it('drops a row when its time cell is missing/NaN', () => {
		mockColumns[1] = { getData: () => [0, NaN, 2], type: 'number', name: 'time' };
		mockColumns[2] = { getData: () => [10, 11, 12], type: 'number', name: 'A' };

		const [result] = widetolong({
			timeIN: 1,
			valueColIds: [2],
			out: { time: -1, category: -1, value: -1 }
		});

		expect(result.time).toEqual([0, 2]);
		expect(result.value).toEqual([10, 12]);
	});

	it('round-trip: wide -> long -> wide reconstructs the original dense table', () => {
		// Dense wide table: time + two value columns, no missing cells.
		const time = [0, 1, 2];
		const A = [10, 11, 12];
		const B = [20, 21, 22];
		mockColumns[1] = { getData: () => time, type: 'number', name: 'time' };
		mockColumns[2] = { getData: () => A, type: 'number', name: 'A' };
		mockColumns[3] = { getData: () => B, type: 'number', name: 'B' };

		const [long] = widetolong({
			timeIN: 1,
			valueColIds: [2, 3],
			out: { time: -1, category: -1, value: -1 }
		});

		// Reconstruct wide form from the long output and compare.
		const cats = [...new Set(long.category)];
		const times = [...new Set(long.time)].sort((a, b) => a - b);
		const wide = {};
		for (const c of cats) wide[c] = times.map(() => NaN);
		for (let i = 0; i < long.time.length; i++) {
			const ti = times.indexOf(long.time[i]);
			wide[long.category[i]][ti] = long.value[i];
		}

		expect(times).toEqual(time);
		expect(wide.A).toEqual(A);
		expect(wide.B).toEqual(B);
	});
});
