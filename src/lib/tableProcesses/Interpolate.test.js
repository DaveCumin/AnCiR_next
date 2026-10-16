import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockColumns } = vi.hoisted(() => ({ mockColumns: {} }));

vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: new Map() } }));
vi.mock('$lib/core/Column.svelte', () => ({
	getColumnById: (id) => mockColumns[id]
}));

import { interpolatedata } from './Interpolate.svelte';
import { core } from '$lib/core/core.svelte';

beforeEach(() => {
	for (const k of Object.keys(mockColumns)) delete mockColumns[k];
	core.rawData.clear();
	// x = 0..4 (numeric), y with two interior gaps.
	mockColumns[1] = { type: 'number', name: 'time', getData: () => [0, 1, 2, 3, 4] };
	mockColumns[2] = { type: 'number', name: 'y', getData: () => [0, NaN, 20, NaN, 40] };
	mockColumns[100] = { type: 'number', data: -1 }; // interpx output
	mockColumns[101] = { type: 'number', data: -1 }; // interpy_2 output
});

describe('interpolatedata', () => {
	it('is invalid when xIN is -1 or there are no Y columns', () => {
		expect(interpolatedata({ xIN: -1, yIN: [2], mode: 'fill', out: {} })[1]).toBe(false);
		expect(interpolatedata({ xIN: 1, yIN: [], mode: 'fill', out: {} })[1]).toBe(false);
	});

	it('fill mode keeps the original x and fills gaps (linear)', () => {
		const [result, valid] = interpolatedata({
			xIN: 1,
			yIN: [2],
			mode: 'fill',
			method: 'linear',
			out: { interpx: 100, interpy_2: 101 }
		});
		expect(valid).toBe(true);
		expect(result.x).toEqual([0, 1, 2, 3, 4]);
		expect(result.y_results[2]).toEqual([0, 10, 20, 30, 40]);
		// outputs written to rawData
		expect(core.rawData.get(100)).toEqual([0, 1, 2, 3, 4]);
		expect(core.rawData.get(101)).toEqual([0, 10, 20, 30, 40]);
	});

	it('resample mode builds a new grid and interpolates onto it', () => {
		const [result, valid] = interpolatedata({
			xIN: 1,
			yIN: [2],
			mode: 'resample',
			method: 'linear',
			step: 2,
			start: null,
			end: null,
			out: { interpx: 100, interpy_2: 101 }
		});
		expect(valid).toBe(true);
		expect(result.x).toEqual([0, 2, 4]); // grid over data range, step 2
		expect(result.y_results[2]).toEqual([0, 20, 40]);
		expect(core.rawData.get(101)).toEqual([0, 20, 40]);
	});

	it('respects explicit resample start/end', () => {
		const [result] = interpolatedata({
			xIN: 1,
			yIN: [2],
			mode: 'resample',
			method: 'linear',
			step: 1,
			start: 1,
			end: 3,
			out: { interpx: 100, interpy_2: 101 }
		});
		expect(result.x).toEqual([1, 2, 3]);
		expect(result.y_results[2]).toEqual([10, 20, 30]);
	});

	it('nearest method snaps to the closest known point', () => {
		mockColumns[2] = { type: 'number', name: 'y', getData: () => [0, 10, 20, 30, 40] };
		const [result] = interpolatedata({
			xIN: 1,
			yIN: [2],
			mode: 'resample',
			method: 'nearest',
			step: 0.4,
			start: 0,
			end: 0.8,
			out: { interpx: 100, interpy_2: 101 }
		});
		// grid 0, 0.4, 0.8 → nearest known x = 0, 0, 1 → y 0, 0, 10
		expect(result.y_results[2]).toEqual([0, 0, 10]);
	});

	it('is invalid when a Y column has no finite points', () => {
		mockColumns[2] = { type: 'number', name: 'y', getData: () => [NaN, NaN, NaN, NaN, NaN] };
		const [, valid] = interpolatedata({
			xIN: 1,
			yIN: [2],
			mode: 'fill',
			method: 'linear',
			out: { interpx: 100, interpy_2: 101 }
		});
		expect(valid).toBe(false);
	});
});

// Review follow-up: in fill mode a row whose y is PRESENT but whose x is missing came out
// NaN, so the node deleted a real observation it was only meant to keep. It cannot be placed
// on the x axis (and is not used as a known point), but it keeps its own y, as the Python
// port (tp_interpolate) already does.
describe('interpolatedata fill: a missing x keeps its own y', () => {
	it('keeps the y of a row with a missing x, and still fills real gaps', () => {
		mockColumns[3] = { type: 'number', name: 't', getData: () => [0, null, 2, '', 4] };
		mockColumns[4] = { type: 'number', name: 'y', getData: () => [0, 7, NaN, '9', 40] };
		const [result] = interpolatedata({ xIN: 3, yIN: [4], mode: 'fill', method: 'linear', out: {} });
		expect(result.y_results[4]).toEqual([0, 7, 20, 9, 40]);
	});

	it('a row with both x and y missing stays missing', () => {
		mockColumns[3] = { type: 'number', name: 't', getData: () => [0, null, 2] };
		mockColumns[4] = { type: 'number', name: 'y', getData: () => [0, null, 20] };
		const [result] = interpolatedata({ xIN: 3, yIN: [4], mode: 'fill', out: {} });
		expect(Number.isNaN(result.y_results[4][1])).toBe(true);
	});

	it('resample mode is unaffected (the grid has no missing x)', () => {
		mockColumns[3] = { type: 'number', name: 't', getData: () => [0, null, 2] };
		mockColumns[4] = { type: 'number', name: 'y', getData: () => [0, 7, 20] };
		const [result] = interpolatedata({
			xIN: 3,
			yIN: [4],
			mode: 'resample',
			step: 1,
			out: {}
		});
		expect(result.y_results[4]).toEqual([0, 10, 20]);
	});
});

// The resample grid is capped at MAX_GRID_POINTS (2,000,000). Past it the node used to give
// an empty output with no word why (and kept an earlier result in its output columns).
describe('interpolatedata resample: the grid-size limit, both sides', () => {
	// About 40 days of 15 min samples on a time axis (hours since start).
	const n = 3908;
	const hours = Array.from({ length: n }, (_, i) => i * 0.25);
	const step = 1 / 2048; // exact in binary, so the grid counts below are exact
	const run = (end) =>
		interpolatedata({
			xIN: 1,
			yIN: [2],
			mode: 'resample',
			method: 'linear',
			step,
			start: 0,
			end,
			out: { interpx: 100, interpy_2: 101 }
		});
	beforeEach(() => {
		mockColumns[1] = {
			type: 'time',
			name: 'time',
			hoursSinceStart: hours,
			getData: () => hours.map((h) => 1_700_000_000_000 + h * 3_600_000)
		};
		mockColumns[2] = {
			type: 'number',
			name: 'activity',
			getData: () => hours.map((h) => 10 + 5 * Math.sin((2 * Math.PI * h) / 24))
		};
	});

	it('exactly 2,000,000 points: resampled, no warning', () => {
		const [result, valid] = run(1_999_999 * step);
		expect(valid).toBe(true);
		expect(result.warnings).toBeUndefined();
		expect(result.x).toHaveLength(2_000_000);
		expect(core.rawData.get(101)).toHaveLength(2_000_000);
		expect(core.rawData.get(101)[2048 * 6]).toBeCloseTo(15, 9); // 6 h: the peak
	});

	it('2,000,001 points: nothing resampled, a warning naming the size and a step that fits, and the earlier output cleared', () => {
		run(1_999_999 * step);
		expect(core.rawData.get(101)).toHaveLength(2_000_000);
		const [result, valid] = run(2_000_000 * step);
		expect(valid).toBe(false);
		expect(result.warnings).toEqual([
			'Nothing was resampled: a step of 0.000488281 h over 976.563 h gives 2,000,001 grid ' +
				'points, more than the limit of 2,000,000. Use a step of at least 0.00049 h, or a ' +
				'shorter start to end range.'
		]);
		expect(core.rawData.get(100)).toEqual([]);
		expect(core.rawData.get(101)).toEqual([]);
	});
});
