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
	it('returns invalid when inputs are -1', () => {
		const [, valid] = smootheddata({ xIN: -1, yIN: -1, smootherType: 'moving', movingAvgWindowSize: 3, movingAvgType: 'simple', out: preview });
		expect(valid).toBe(false);
	});

	it('moving average smooths a noisy signal', () => {
		const x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
		const y = [10, 11, 9, 10, 11, 9, 10, 11, 9, 10];
		mockColumns[1] = { type: 'number', getData: () => x };
		mockColumns[2] = { type: 'number', getData: () => y };
		const [result, valid] = smootheddata({
			xIN: 1, yIN: 2,
			smootherType: 'moving',
			movingAvgWindowSize: 3,
			movingAvgType: 'simple',
			out: preview
		});
		expect(valid).toBe(true);
		expect(result.y_results[2]).toHaveLength(y.length);
	});

	it('output x matches input x', () => {
		const x = [0, 1, 2, 3, 4];
		const y = [5, 6, 5, 6, 5];
		mockColumns[1] = { type: 'number', getData: () => x };
		mockColumns[2] = { type: 'number', getData: () => y };
		const [result] = smootheddata({
			xIN: 1, yIN: 2,
			smootherType: 'moving',
			movingAvgWindowSize: 3,
			movingAvgType: 'simple',
			out: preview
		});
		expect(result.x_out).toEqual(x);
	});
});
