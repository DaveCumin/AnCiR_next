import { describe, it, expect } from 'vitest';
import { histogramBins, linearFit, pairsLayout } from './pairsLayout.js';

describe('histogramBins', () => {
	it('counts values into equal-width bins spanning [min, max]', () => {
		const h = histogramBins([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
		expect(h.counts.reduce((s, c) => s + c, 0)).toBe(11); // every value counted once
		expect(h.min).toBe(0);
		expect(h.max).toBe(10);
		expect(h.counts).toHaveLength(5);
		expect(h.maxCount).toBe(Math.max(...h.counts));
	});
	it('drops null/NaN before binning', () => {
		const h = histogramBins([1, null, 2, NaN, 3], 3);
		expect(h.counts.reduce((s, c) => s + c, 0)).toBe(3);
	});
	it('a constant column collapses to a single populated bin, not NaN', () => {
		const h = histogramBins([5, 5, 5, 5], 4);
		expect(h.counts.reduce((s, c) => s + c, 0)).toBe(4);
		expect(h.min).toBe(5);
	});
	it('is empty-safe', () => {
		expect(histogramBins([], 5).counts).toEqual([]);
		expect(histogramBins(null, 5).counts).toEqual([]);
	});
});

describe('linearFit', () => {
	it('recovers slope + intercept of a clean line', () => {
		const x = [0, 1, 2, 3, 4];
		const y = x.map((v) => 2 * v + 1);
		const f = linearFit(x, y);
		expect(f.slope).toBeCloseTo(2, 9);
		expect(f.intercept).toBeCloseTo(1, 9);
	});
	it('uses pairwise-complete rows (drops a null row)', () => {
		const f = linearFit([0, 1, null, 3], [1, 3, 99, 7]);
		expect(f.slope).toBeCloseTo(2, 9);
		expect(f.intercept).toBeCloseTo(1, 9);
	});
	it('is NaN with fewer than two usable points', () => {
		expect(linearFit([1], [2]).slope).toBeNaN();
	});
});

describe('pairsLayout', () => {
	const cols = [
		[1, 2, 3, 4, 5],
		[2, 4, 6, 8, 10],
		[5, 4, 3, 2, 1]
	];
	const names = ['a', 'b', 'c'];

	it('carries labels, the r/p grids, per-column ranges, and diagonal histograms', () => {
		const L = pairsLayout(cols, names, 'pearson');
		expect(L.labels).toEqual(['a', 'b', 'c']);
		expect(L.r[0][1]).toBeCloseTo(1, 9); // a~b
		expect(L.r[0][2]).toBeCloseTo(-1, 9); // a~c
		expect(L.ranges[0]).toEqual({ min: 1, max: 5 });
		expect(L.hists).toHaveLength(3);
		expect(L.hists[0].counts.reduce((s, c) => s + c, 0)).toBe(5);
	});
	it('keeps the cleaned columns for scatter rendering', () => {
		const L = pairsLayout(cols, names, 'pearson');
		expect(L.cols[0]).toEqual([1, 2, 3, 4, 5]);
	});
	it('is empty-safe', () => {
		expect(pairsLayout([], null, 'pearson').labels).toEqual([]);
	});
});
