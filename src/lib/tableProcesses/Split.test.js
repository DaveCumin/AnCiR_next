import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockColumns } = vi.hoisted(() => ({
	mockColumns: {}
}));

vi.mock('$lib/core/core.svelte', () => ({
	core: {
		rawData: {
			set: vi.fn(),
			delete: vi.fn(),
			has: vi.fn(),
			get: vi.fn()
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
			this.type = 'number';
			this.data = -1;
		}
	}
}));

vi.mock('$lib/components/inputs/ColumnSelector.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));

import { split } from './Split.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
});

describe('split', () => {
	it('returns invalid when xIN is -1', () => {
		const [result, valid] = split({
			xIN: -1,
			yIN: [1],
			splitTimes: [10]
		});
		expect(valid).toBe(false);
		expect(result).toBeNull();
	});

	it('returns invalid when yIN is empty', () => {
		mockColumns[1] = { type: 'number', getData: () => [0, 5, 10, 15, 20] };

		const [result, valid] = split({
			xIN: 1,
			yIN: [],
			splitTimes: [10]
		});

		expect(valid).toBe(false);
		expect(result).toBeNull();
	});

	it('returns invalid when xIN column does not exist', () => {
		const [result, valid] = split({
			xIN: 999,
			yIN: [1],
			splitTimes: [10]
		});

		expect(valid).toBe(false);
		expect(result).toBeNull();
	});

	it('returns invalid when splitTimes is empty', () => {
		mockColumns[1] = { type: 'number', getData: () => [0, 5, 10, 15, 20] };
		mockColumns[2] = { type: 'number', getData: () => [10, 20, 30, 40, 50] };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: []
		});

		expect(valid).toBe(false);
		expect(result).toBeNull();
	});

	it('splits y column into segments with null for non-matching rows', () => {
		const t = [0, 5, 10, 15, 20];
		const y = [10, 20, 30, 40, 50];

		mockColumns[1] = { type: 'number', getData: () => t, name: 'time' };
		mockColumns[2] = { type: 'number', getData: () => y, name: 'activity' };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [10]
		});

		expect(valid).toBe(true);
		expect(result.segmentCount).toBe(2);
		// Segment 1: t < 10 — values at t=0,5 kept, rest null
		expect(result.y_results[2].segments[0]).toEqual([10, 20, null, null, null]);
		// Segment 2: t >= 10 — values at t=10,15,20 kept, rest null
		expect(result.y_results[2].segments[1]).toEqual([null, null, 30, 40, 50]);
	});

	it('splits with multiple split times', () => {
		const t = [0, 5, 10, 15, 20, 25, 30];
		const y = [10, 20, 30, 40, 50, 60, 70];

		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [10, 20]
		});

		expect(valid).toBe(true);
		expect(result.segmentCount).toBe(3);
		expect(result.y_results[2].segments[0]).toEqual([10, 20, null, null, null, null, null]);
		expect(result.y_results[2].segments[1]).toEqual([null, null, 30, 40, null, null, null]);
		expect(result.y_results[2].segments[2]).toEqual([null, null, null, null, 50, 60, 70]);
	});

	it('auto-sorts unsorted split times', () => {
		const t = [0, 5, 10, 15, 20];
		const y = [10, 20, 30, 40, 50];

		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [20, 10] // Unsorted
		});

		expect(valid).toBe(true);
		// Should be treated as if split times were [10, 20]
		expect(result.y_results[2].segments[0]).toEqual([10, 20, null, null, null]);
		expect(result.y_results[2].segments[1]).toEqual([null, null, 30, 40, null]);
		expect(result.y_results[2].segments[2]).toEqual([null, null, null, null, 50]);
	});

	it('outputs null for NaN y values', () => {
		const t = [0, 5, 10, 15, 20];
		const y = [10, NaN, 30, 40, 50];

		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [10]
		});

		expect(valid).toBe(true);
		// t=5 has NaN y value — null in both segments
		expect(result.y_results[2].segments[0]).toEqual([10, null, null, null, null]);
		expect(result.y_results[2].segments[1]).toEqual([null, null, 30, 40, 50]);
	});

	it('outputs null for NaN time values', () => {
		const t = [0, NaN, 10, 15, 20];
		const y = [10, 20, 30, 40, 50];

		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [10]
		});

		expect(valid).toBe(true);
		// t=NaN at index 1 — null in both segments
		expect(result.y_results[2].segments[0]).toEqual([10, null, null, null, null]);
		expect(result.y_results[2].segments[1]).toEqual([null, null, 30, 40, 50]);
	});

	it('handles multiple Y columns', () => {
		const t = [0, 5, 10, 15, 20];
		const y1 = [10, 20, 30, 40, 50];
		const y2 = [100, 200, 300, 400, 500];

		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { type: 'number', getData: () => y1, name: 'activity' };
		mockColumns[3] = { type: 'number', getData: () => y2, name: 'heart_rate' };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2, 3],
			splitTimes: [10]
		});

		expect(valid).toBe(true);
		expect(result.y_results[2]).toBeDefined();
		expect(result.y_results[3]).toBeDefined();
		expect(result.y_results[2].segments[0]).toEqual([10, 20, null, null, null]);
		expect(result.y_results[3].segments[0]).toEqual([100, 200, null, null, null]);
	});

	it('skips missing Y columns', () => {
		const t = [0, 5, 10, 15, 20];
		const y = [10, 20, 30, 40, 50];

		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2, 3, 999],
			splitTimes: [10]
		});

		expect(valid).toBe(true);
		expect(result.y_results[2]).toBeDefined();
		expect(result.y_results[3]).toBeUndefined();
		expect(result.y_results[999]).toBeUndefined();
	});

	it('returns invalid when no valid Y columns', () => {
		const t = [0, 5, 10];

		mockColumns[1] = { type: 'number', getData: () => t };

		const [result, valid] = split({
			xIN: 1,
			yIN: [999],
			splitTimes: [5]
		});

		expect(valid).toBe(false);
		expect(result).toBeNull();
	});

	it('handles time columns with getData (milliseconds)', () => {
		const rawMs = [1000000, 1021600000, 1043200000, 1064800000, 1086400000];
		const y = [10, 20, 30, 40, 50];

		mockColumns[1] = {
			type: 'time',
			getData: () => rawMs,
			hoursSinceStart: [0, 6, 12, 18, 24]
		};
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [1043200000] // Split at 3rd timestamp
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].segments[0]).toEqual([10, 20, null, null, null]);
		expect(result.y_results[2].segments[1]).toEqual([null, null, 30, 40, 50]);
	});

	it('calculates segment count correctly', () => {
		const t = [0, 5, 10, 15, 20, 25, 30];
		const y = [10, 20, 30, 40, 50, 60, 70];

		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [10, 20]
		});

		expect(valid).toBe(true);
		expect(result.segmentCount).toBe(3);
		expect(result.y_results[2].segments.length).toBe(3);
	});

	it('preserves array length in all segments', () => {
		const t = [0, 5, 10, 15, 20];
		const y = [10, 20, 30, 40, 50];

		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [10]
		});

		expect(valid).toBe(true);
		// Both segments should have the same length as the original data
		expect(result.y_results[2].segments[0].length).toBe(5);
		expect(result.y_results[2].segments[1].length).toBe(5);
	});

	it('handles single data point per segment', () => {
		const t = [0, 10, 20];
		const y = [10, 30, 50];

		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [10, 20]
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].segments[0]).toEqual([10, null, null]);
		expect(result.y_results[2].segments[1]).toEqual([null, 30, null]);
		expect(result.y_results[2].segments[2]).toEqual([null, null, 50]);
	});

	it('handles empty segments gracefully', () => {
		const t = [0, 5, 25, 30];
		const y = [10, 20, 40, 50];

		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { type: 'number', getData: () => y };

		// No data between 10 and 20
		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [10, 20]
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].segments[0]).toEqual([10, 20, null, null]);
		expect(result.y_results[2].segments[1]).toEqual([null, null, null, null]); // All null
		expect(result.y_results[2].segments[2]).toEqual([null, null, 40, 50]);
	});

	it('handles boundary values (left-inclusive)', () => {
		const t = [9.99, 10, 10.01, 19.99, 20, 20.01];
		const y = [1, 2, 3, 4, 5, 6];

		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [10, 20]
		});

		expect(valid).toBe(true);
		// t < 10: only 9.99
		expect(result.y_results[2].segments[0]).toEqual([1, null, null, null, null, null]);
		// 10 <= t < 20: 10, 10.01, 19.99
		expect(result.y_results[2].segments[1]).toEqual([null, 2, 3, 4, null, null]);
		// t >= 20: 20, 20.01
		expect(result.y_results[2].segments[2]).toEqual([null, null, null, null, 5, 6]);
	});

	it('outputs all null when all Y values are NaN', () => {
		const t = [0, 5, 10];
		const y = [NaN, NaN, NaN];

		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [5]
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].segments[0]).toEqual([null, null, null]);
		expect(result.y_results[2].segments[1]).toEqual([null, null, null]);
	});

	it('handles decimal split times', () => {
		const t = [0, 2.5, 5, 7.5, 10];
		const y = [10, 20, 30, 40, 50];

		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [2.5, 7.5]
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].segments[0]).toEqual([10, null, null, null, null]);
		expect(result.y_results[2].segments[1]).toEqual([null, 20, 30, null, null]);
		expect(result.y_results[2].segments[2]).toEqual([null, null, null, 40, 50]);
	});

	it('handles null values in y data', () => {
		const t = [0, 5, 10, 15, 20];
		const y = [10, null, 30, undefined, 50];

		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [10]
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].segments[0]).toEqual([10, null, null, null, null]);
		expect(result.y_results[2].segments[1]).toEqual([null, null, 30, null, 50]);
	});
});
