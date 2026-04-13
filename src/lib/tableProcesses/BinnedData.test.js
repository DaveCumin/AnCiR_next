import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: { set: vi.fn() } } }));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/ColumnSelector.svelte', () => ({ default: {} }));
vi.mock('$lib/components/plotbits/Table.svelte', () => ({ default: {} }));

import { binneddata } from './BinnedData.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
});

const preview = { binnedx: -1 };

describe('binneddata', () => {
	it('returns invalid when inputs are missing', () => {
		const [, valid] = binneddata(
			{ xIN: -1, yIN: -1, binSize: 1, binStart: 0, out: preview },
			false
		);
		expect(valid).toBe(false);
	});

	it('returns invalid when binSize <= 0', () => {
		mockColumns[1] = { type: 'number', getData: () => [0, 1, 2] };
		mockColumns[2] = { type: 'number', getData: () => [10, 20, 30] };
		const [, valid] = binneddata({ xIN: 1, yIN: 2, binSize: 0, binStart: 0, out: preview }, false);
		expect(valid).toBe(false);
	});

	it('bins data and returns correct number of bins', () => {
		mockColumns[1] = { type: 'number', getData: () => [0, 0.5, 1, 1.5, 2] };
		mockColumns[2] = { type: 'number', getData: () => [10, 20, 30, 40, 50] };
		const [result, valid] = binneddata(
			{ xIN: 1, yIN: 2, binSize: 1, binStart: 0, out: preview },
			false
		);
		expect(valid).toBe(true);
		expect(result.bins.length).toBeGreaterThan(0);
		expect(result.bins.length).toBe(result.y_results[2].length);
	});

	it('mean aggregation averages values within each bin', () => {
		// Two points at x=0 and x=0.5, both in bin [0,1)
		mockColumns[1] = { type: 'number', getData: () => [0, 0.5] };
		mockColumns[2] = { type: 'number', getData: () => [10, 20] };
		const [result] = binneddata(
			{ xIN: 1, yIN: 2, binSize: 1, binStart: 0, aggFunction: 'mean', out: preview },
			false
		);
		expect(result.y_results[2][0]).toBeCloseTo(15, 6);
	});
});
