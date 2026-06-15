import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData: { set: vi.fn() } },
	appConsts: { processMap: new Map() }
}));
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

	describe('binMode=cuts', () => {
		beforeEach(() => {
			mockColumns[1] = { type: 'number', getData: () => [0.5, 1.5, 2.5, 3.5, 4.5] };
			mockColumns[2] = { type: 'number', getData: () => [1, 1, 1, 1, 1] };
		});

		it('uses custom cut edges and produces n-1 bins', () => {
			const [result, valid] = binneddata(
				{
					xIN: 1,
					yIN: [2],
					binMode: 'cuts',
					cuts: [0, 2, 5],
					aggFunction: 'count',
					out: preview
				},
				false
			);
			expect(valid).toBe(true);
			expect(result.bins).toEqual([0, 2]);
			expect(result.binEnds).toEqual([2, 5]);
			expect(result.y_results[2]).toEqual([2, 3]);
		});

		it('returns invalid when cuts has fewer than 2 valid edges', () => {
			const [, valid] = binneddata(
				{ xIN: 1, yIN: [2], binMode: 'cuts', cuts: [3], aggFunction: 'count', out: preview },
				false
			);
			expect(valid).toBe(false);
		});

		it('sorts and dedupes cuts at the TP boundary before passing to helper', () => {
			const [result, valid] = binneddata(
				{
					xIN: 1,
					yIN: [2],
					binMode: 'cuts',
					cuts: [5, 0, 2, 5, 2], // unsorted and duplicates
					aggFunction: 'count',
					out: preview
				},
				false
			);
			expect(valid).toBe(true);
			expect(result.bins).toEqual([0, 2]); // sorted+deduped to [0,2,5]
		});

		it('reports droppedCount for points outside the cuts range', () => {
			// Data: 0.5, 1.5, 2.5, 3.5, 4.5 — cuts [1, 3] keep 1.5, 2.5; drop 0.5, 3.5, 4.5
			const [result] = binneddata(
				{
					xIN: 1,
					yIN: [2],
					binMode: 'cuts',
					cuts: [1, 3],
					aggFunction: 'count',
					out: preview
				},
				false
			);
			expect(result.droppedCount).toBe(3);
		});

		it('rejects custom cuts when X column is time-typed', () => {
			mockColumns[1] = {
				type: 'time',
				hoursSinceStart: [0, 1, 2, 3],
				getData: () => [0, 1, 2, 3]
			};
			const [, valid] = binneddata(
				{
					xIN: 1,
					yIN: [2],
					binMode: 'cuts',
					cuts: [0, 1, 2],
					aggFunction: 'count',
					out: preview
				},
				false
			);
			expect(valid).toBe(false);
		});
	});

	describe('count aggregation in uniform mode', () => {
		it('returns row counts and ignores Y values', () => {
			mockColumns[1] = { type: 'number', getData: () => [0, 0.5, 1, 1.5, 2] };
			mockColumns[2] = { type: 'number', getData: () => [99, 99, 99, 99, 99] };
			const [result, valid] = binneddata(
				{
					xIN: 1,
					yIN: [2],
					binSize: 1,
					binStart: 0,
					aggFunction: 'count',
					out: preview
				},
				false
			);
			expect(valid).toBe(true);
			// bin [0,1): 0, 0.5 → 2; bin [1,2): 1, 1.5 → 2; bin [2,3): 2 → 1
			expect(result.y_results[2].slice(0, 3)).toEqual([2, 2, 1]);
		});
	});

	// --- Added edge cases ---

	it('returns invalid for empty input data', () => {
		mockColumns[1] = { type: 'number', getData: () => [] };
		mockColumns[2] = { type: 'number', getData: () => [] };
		const [, valid] = binneddata(
			{ xIN: 1, yIN: [2], binSize: 1, binStart: 0, out: preview },
			false
		);
		expect(valid).toBe(false);
	});

	it('fails safe (no throw) when a Y column ref is missing', () => {
		mockColumns[1] = { type: 'number', getData: () => [0, 1, 2] };
		expect(() =>
			binneddata({ xIN: 1, yIN: [999], binSize: 1, binStart: 0, out: preview }, false)
		).not.toThrow();
		const [, valid] = binneddata(
			{ xIN: 1, yIN: [999], binSize: 1, binStart: 0, out: preview },
			false
		);
		expect(valid).toBe(false);
	});

	it('bin edges are left-inclusive / right-exclusive (off-by-one at boundary)', () => {
		// x exactly on bin boundaries: 0,1,2 with binSize 1 from 0
		mockColumns[1] = { type: 'number', getData: () => [0, 1, 2] };
		mockColumns[2] = { type: 'number', getData: () => [10, 20, 30] };
		const [result] = binneddata(
			{ xIN: 1, yIN: [2], binSize: 1, binStart: 0, aggFunction: 'count', out: preview },
			false
		);
		// each boundary value lands in its own bin: [0,1)->1, [1,2)->1, [2,3)->1
		expect(result.bins[0]).toBe(0);
		expect(result.y_results[2][0]).toBe(1);
	});

	it('min/max/median aggregations within a single bin', () => {
		mockColumns[1] = { type: 'number', getData: () => [0, 0.2, 0.4] };
		mockColumns[2] = { type: 'number', getData: () => [5, 1, 9] };

		const mn = binneddata(
			{ xIN: 1, yIN: [2], binSize: 1, binStart: 0, aggFunction: 'min', out: preview },
			false
		)[0];
		const mx = binneddata(
			{ xIN: 1, yIN: [2], binSize: 1, binStart: 0, aggFunction: 'max', out: preview },
			false
		)[0];
		const md = binneddata(
			{ xIN: 1, yIN: [2], binSize: 1, binStart: 0, aggFunction: 'median', out: preview },
			false
		)[0];

		expect(mn.y_results[2][0]).toBe(1);
		expect(mx.y_results[2][0]).toBe(9);
		expect(md.y_results[2][0]).toBe(5); // median of [1,5,9]
	});

	it('multi-Y inputs share the same bin x-axis', () => {
		mockColumns[1] = { type: 'number', getData: () => [0, 0.5, 1, 1.5] };
		mockColumns[2] = { type: 'number', getData: () => [10, 20, 30, 40] };
		mockColumns[3] = { type: 'number', getData: () => [1, 2, 3, 4] };

		const [result, valid] = binneddata(
			{ xIN: 1, yIN: [2, 3], binSize: 1, binStart: 0, aggFunction: 'mean', out: preview },
			false
		);
		expect(valid).toBe(true);
		expect(result.y_results[2].length).toBe(result.bins.length);
		expect(result.y_results[3].length).toBe(result.bins.length);
	});

	it('handles a single data point', () => {
		mockColumns[1] = { type: 'number', getData: () => [0.5] };
		mockColumns[2] = { type: 'number', getData: () => [42] };
		const [result, valid] = binneddata(
			{ xIN: 1, yIN: [2], binSize: 1, binStart: 0, aggFunction: 'mean', out: preview },
			false
		);
		expect(valid).toBe(true);
		expect(result.y_results[2][0]).toBe(42);
	});

	it('uses stepSize for sliding windows when differentstepsize=true', () => {
		mockColumns[1] = { type: 'number', getData: () => [0, 0.5, 1, 1.5, 2] };
		mockColumns[2] = { type: 'number', getData: () => [1, 1, 1, 1, 1] };
		const [result, valid] = binneddata(
			{
				xIN: 1,
				yIN: [2],
				binSize: 1,
				binStart: 0,
				stepSize: 0.5,
				aggFunction: 'count',
				out: preview
			},
			true
		);
		expect(valid).toBe(true);
		// overlapping windows of width 1 stepping by 0.5 → more bins than non-overlapping
		expect(result.bins.length).toBeGreaterThan(2);
	});

	it('applies a registered pre-process to binned y results', async () => {
		const { appConsts } = await import('$lib/core/core.svelte');
		appConsts.processMap.set('negate', { func: (arr) => arr.map((v) => -v) });
		mockColumns[1] = { type: 'number', getData: () => [0, 0.5] };
		mockColumns[2] = { type: 'number', getData: () => [10, 20] };

		const [result] = binneddata(
			{
				xIN: 1,
				yIN: [2],
				binSize: 1,
				binStart: 0,
				aggFunction: 'mean',
				preProcesses: [{ processName: 'negate', processArgs: {} }],
				out: preview
			},
			false
		);
		expect(result.y_results[2][0]).toBe(-15);
		appConsts.processMap.delete('negate');
	});
});
