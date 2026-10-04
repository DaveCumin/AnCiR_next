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
