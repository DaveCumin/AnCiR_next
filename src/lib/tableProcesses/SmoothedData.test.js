import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: { set: vi.fn() } } }));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));

import { smootheddata } from './SmoothedData.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
});

const preview = { smoothedx: -1 };

describe('smootheddata', () => {
	it('returns invalid when inputs are -1', async () => {
		const [, valid] = await smootheddata({
			xIN: -1,
			yIN: -1,
			smootherType: 'moving',
			movingAvgWindowSize: 3,
			movingAvgType: 'simple',
			out: preview
		});
		expect(valid).toBe(false);
	});

	it('moving average smooths a noisy signal', async () => {
		const x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
		const y = [10, 11, 9, 10, 11, 9, 10, 11, 9, 10];
		mockColumns[1] = { type: 'number', getData: () => x };
		mockColumns[2] = { type: 'number', getData: () => y };
		const [result, valid] = await smootheddata({
			xIN: 1,
			yIN: 2,
			smootherType: 'moving',
			movingAvgWindowSize: 3,
			movingAvgType: 'simple',
			out: preview
		});
		expect(valid).toBe(true);
		expect(result.y_results[2]).toHaveLength(y.length);
	});

	it('output x matches input x', async () => {
		const x = [0, 1, 2, 3, 4];
		const y = [5, 6, 5, 6, 5];
		mockColumns[1] = { type: 'number', getData: () => x };
		mockColumns[2] = { type: 'number', getData: () => y };
		const [result] = await smootheddata({
			xIN: 1,
			yIN: 2,
			smootherType: 'moving',
			movingAvgWindowSize: 3,
			movingAvgType: 'simple',
			out: preview
		});
		expect(result.x_out).toEqual(x);
	});
});

// ROB-8: the row filter was `d.y != null && !isNaN(d.y)`, which lets ' ' and '' through (isNaN
// coerces them to 0) and keeps numeric strings as STRINGS, and movingAverage then did
// `sum += y[j]`, concatenating: the reviewer saw outputs like 40202 and 2020202. Missing rows
// are now dropped by the house rule (validPairs) and what is left is converted with Number().
describe('smootheddata with blank and numeric-string cells (ROB-8)', () => {
	const x = Array.from({ length: 12 }, (_, i) => i);
	const yBlank = [10, 10, ' ', 10, 10, '', 10, 10, 10, 10, 10, 10];
	const yStr = yBlank.map((v) => (typeof v === 'number' ? String(v) : '10'));

	for (const smootherType of ['moving', 'whittaker', 'savitzky', 'loess']) {
		it(`${smootherType}: blank cells are dropped, not read as 0 or concatenated`, async () => {
			mockColumns[1] = { type: 'number', getData: () => x };
			mockColumns[2] = { type: 'number', getData: () => yBlank };
			const [result, valid] = await smootheddata({
				xIN: 1,
				yIN: 2,
				smootherType,
				movingAvgWindowSize: 3,
				movingAvgType: 'simple',
				out: preview
			});
			expect(valid).toBe(true);
			expect(result.x_out).toEqual([0, 1, 3, 4, 6, 7, 8, 9, 10, 11]);
			expect(result.y_results[2]).toHaveLength(10);
			for (const v of result.y_results[2]) {
				expect(typeof v).toBe('number');
				expect(v).toBeCloseTo(10, 6);
			}
		});

		it(`${smootherType}: numeric strings are smoothed as numbers`, async () => {
			mockColumns[1] = { type: 'number', getData: () => x.map(String) };
			mockColumns[2] = { type: 'number', getData: () => yStr };
			const [result] = await smootheddata({
				xIN: 1,
				yIN: 2,
				smootherType,
				movingAvgWindowSize: 3,
				movingAvgType: 'simple',
				out: preview
			});
			expect(result.x_out).toEqual(x);
			for (const v of result.y_results[2]) {
				expect(typeof v).toBe('number');
				expect(v).toBeCloseTo(10, 6);
			}
		});
	}

	it('a real 0 is data', async () => {
		mockColumns[1] = { type: 'number', getData: () => [0, 1, 2, 3, 4] };
		mockColumns[2] = { type: 'number', getData: () => [3, 3, 0, 3, 3] };
		const [result] = await smootheddata({
			xIN: 1,
			yIN: 2,
			smootherType: 'moving',
			movingAvgWindowSize: 3,
			movingAvgType: 'simple',
			out: preview
		});
		expect(result.y_results[2]).toEqual([3, 2, 2, 2, 3]);
	});
});
