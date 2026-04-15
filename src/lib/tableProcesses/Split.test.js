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
		mockColumns[1] = { type: 'number', getData: () => [0, 5, 10, 15, 20], hoursSinceStart: [0, 5, 10, 15, 20] };

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
		mockColumns[1] = { type: 'number', getData: () => [0, 5, 10, 15, 20], hoursSinceStart: [0, 5, 10, 15, 20] };
		mockColumns[2] = { type: 'number', getData: () => [10, 20, 30, 40, 50] };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: []
		});

		expect(valid).toBe(false);
		expect(result).toBeNull();
	});

	it('splits y column into segments at specified times', () => {
		const t = [0, 5, 10, 15, 20];
		const y = [10, 20, 30, 40, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t, name: 'time' };
		mockColumns[2] = { type: 'number', getData: () => y, name: 'activity' };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [10]
		});

		expect(valid).toBe(true);
		expect(result.segmentCount).toBe(2); // Before and after 10
		expect(result.y_results[2].segments[0]).toEqual([10, 20]); // t < 10: times 0, 5
		expect(result.y_results[2].segments[1]).toEqual([30, 40, 50]); // t >= 10: times 10, 15, 20
	});

	it('splits with multiple split times', () => {
		const t = [0, 5, 10, 15, 20, 25, 30];
		const y = [10, 20, 30, 40, 50, 60, 70];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [10, 20]
		});

		expect(valid).toBe(true);
		expect(result.segmentCount).toBe(3);
		expect(result.y_results[2].segments[0]).toEqual([10, 20]); // t < 10
		expect(result.y_results[2].segments[1]).toEqual([30, 40]); // 10 <= t < 20
		expect(result.y_results[2].segments[2]).toEqual([50, 60, 70]); // t >= 20
	});

	it('auto-sorts unsorted split times', () => {
		const t = [0, 5, 10, 15, 20];
		const y = [10, 20, 30, 40, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [20, 10] // Unsorted
		});

		expect(valid).toBe(true);
		// Should be treated as if split times were [10, 20]
		expect(result.y_results[2].segments[0]).toEqual([10, 20]); // t < 10
		expect(result.y_results[2].segments[1]).toEqual([30, 40]); // 10 <= t < 20
		expect(result.y_results[2].segments[2]).toEqual([50]); // t >= 20
	});

	it('skips data points with NaN values', () => {
		const t = [0, 5, 10, 15, 20];
		const y = [10, NaN, 30, 40, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [10]
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].segments[0]).toEqual([10]); // Only t=0 (y=10), skips t=5 (y=NaN)
		expect(result.y_results[2].segments[1]).toEqual([30, 40, 50]); // t=10, 15, 20
	});

	it('handles NaN time values correctly', () => {
		const t = [0, NaN, 10, 15, 20];
		const y = [10, 20, 30, 40, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [10]
		});

		expect(valid).toBe(true);
		// Skip index 1 (NaN time), so we have indices [0, 2, 3, 4]
		expect(result.y_results[2].segments[0]).toEqual([10]); // t < 10: only t=0
		expect(result.y_results[2].segments[1]).toEqual([30, 40, 50]); // t >= 10: t=10,15,20
	});

	it('handles multiple Y columns', () => {
		const t = [0, 5, 10, 15, 20];
		const y1 = [10, 20, 30, 40, 50];
		const y2 = [100, 200, 300, 400, 500];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
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
		expect(result.y_results[2].segments[0]).toEqual([10, 20]);
		expect(result.y_results[3].segments[0]).toEqual([100, 200]);
	});

	it('skips missing Y columns', () => {
		const t = [0, 5, 10, 15, 20];
		const y = [10, 20, 30, 40, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };
		// mockColumns[3] doesn't exist

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

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		// Y columns don't exist

		const [result, valid] = split({
			xIN: 1,
			yIN: [999],
			splitTimes: [5]
		});

		expect(valid).toBe(false);
		expect(result).toBeNull();
	});

	it('handles time columns with getData (milliseconds)', () => {
		// Time columns: getData() returns raw ms, splitTimes from DateTimeHrs are also ms
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
		expect(result.y_results[2].segments[0]).toEqual([10, 20]);
		expect(result.y_results[2].segments[1]).toEqual([30, 40, 50]);
	});

	it('calculates segment count correctly', () => {
		const t = [0, 5, 10, 15, 20, 25, 30];
		const y = [10, 20, 30, 40, 50, 60, 70];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [10, 20]
		});

		expect(valid).toBe(true);
		expect(result.segmentCount).toBe(3); // n split times + 1
		expect(result.y_results[2].segments.length).toBe(3);
	});

	it('calculates total rows correctly', () => {
		const t = [0, 5, 10, 15, 20];
		const y = [10, 20, 30, 40, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [10]
		});

		expect(valid).toBe(true);
		expect(result.totalRows).toBe(5); // All valid rows
	});

	it('handles single data point per segment', () => {
		const t = [0, 10, 20];
		const y = [10, 30, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [10, 20]
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].segments[0]).toEqual([10]); // Exactly at boundary
		expect(result.y_results[2].segments[1]).toEqual([30]);
		expect(result.y_results[2].segments[2]).toEqual([50]);
	});

	it('handles empty segments gracefully', () => {
		const t = [0, 5, 25, 30];
		const y = [10, 20, 40, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		// No data between 10 and 20
		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [10, 20]
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].segments[0]).toEqual([10, 20]); // t < 10
		expect(result.y_results[2].segments[1]).toEqual([]); // Empty segment: 10 <= t < 20
		expect(result.y_results[2].segments[2]).toEqual([40, 50]); // t >= 20
	});

	it('handles boundary values (left-inclusive)', () => {
		const t = [9.99, 10, 10.01, 19.99, 20, 20.01];
		const y = [1, 2, 3, 4, 5, 6];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [10, 20]
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].segments[0]).toEqual([1]); // t < 10: 9.99
		expect(result.y_results[2].segments[1]).toEqual([2, 3, 4]); // 10 <= t < 20: 10, 10.01, 19.99
		expect(result.y_results[2].segments[2]).toEqual([5, 6]); // t >= 20: 20, 20.01
	});

	it('handles all NaN Y values', () => {
		const t = [0, 5, 10];
		const y = [NaN, NaN, NaN];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [5]
		});

		expect(valid).toBe(false);
		expect(result).toBeNull();
	});

	it('handles decimal split times', () => {
		const t = [0, 2.5, 5, 7.5, 10];
		const y = [10, 20, 30, 40, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = split({
			xIN: 1,
			yIN: [2],
			splitTimes: [2.5, 7.5]
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].segments[0]).toEqual([10]); // t < 2.5
		expect(result.y_results[2].segments[1]).toEqual([20, 30]); // 2.5 <= t < 7.5
		expect(result.y_results[2].segments[2]).toEqual([40, 50]); // t >= 7.5
	});
});
