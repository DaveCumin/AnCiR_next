// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { mean, sampleVariance, sampleStd, median, quantileType7 } from './sampleStats.js';

describe('sampleStats.mean', () => {
	it('averages a clean array', () => {
		expect(mean([2, 4, 6])).toBe(4);
	});
	it('returns NaN for empty', () => {
		expect(mean([])).toBeNaN();
	});
});

describe('sampleStats.sampleVariance', () => {
	it('uses the n-1 denominator', () => {
		// values [2,4,6]: mean 4, ss = 4+0+4 = 8, /(3-1) = 4
		expect(sampleVariance([2, 4, 6])).toBe(4);
	});
	it('returns NaN for fewer than two values', () => {
		expect(sampleVariance([5])).toBeNaN();
		expect(sampleVariance([])).toBeNaN();
	});
});

describe('sampleStats.sampleStd', () => {
	it('is sqrt of the sample variance', () => {
		expect(sampleStd([2, 4, 6])).toBe(2);
	});
	it('returns NaN when variance is undefined', () => {
		expect(sampleStd([5])).toBeNaN();
	});
});

describe('sampleStats.median', () => {
	it('handles odd length', () => {
		expect(median([3, 1, 2])).toBe(2);
	});
	it('averages the middle pair for even length', () => {
		expect(median([1, 2, 3, 4])).toBe(2.5);
	});
	it('returns NaN for empty', () => {
		expect(median([])).toBeNaN();
	});
});

describe('sampleStats.quantileType7', () => {
	// Pinned against numpy.percentile (method='linear', numpy's default) —
	// the same type-7 rule R's quantile() defaults to.
	it('interpolates linearly between order statistics (numpy pin, p=30, n=7)', () => {
		// numpy.percentile([3,1,4,1,5,9,2], 30) == 1.7999999999999998
		expect(quantileType7([3, 1, 4, 1, 5, 9, 2], 0.3)).toBeCloseTo(1.7999999999999998, 12);
	});
	it('interpolates on n=4 (numpy pin, p=25)', () => {
		// numpy.percentile([10,20,40,80], 25) == 17.5
		expect(quantileType7([10, 20, 40, 80], 0.25)).toBe(17.5);
	});
	it('q=0.5 equals the median exactly (odd and even n)', () => {
		const odd = [3, 1, 4, 1, 5, 9, 2];
		const even = [7, 3, 1, 9];
		expect(quantileType7(odd, 0.5)).toBe(median(odd));
		expect(quantileType7(even, 0.5)).toBe(median(even));
	});
	it('q=0 and q=1 return the extremes', () => {
		expect(quantileType7([10, 20, 40, 80], 0)).toBe(10);
		expect(quantileType7([10, 20, 40, 80], 1)).toBe(80);
	});
	it('clamps q outside [0, 1]', () => {
		expect(quantileType7([1, 2, 3], -0.5)).toBe(1);
		expect(quantileType7([1, 2, 3], 1.5)).toBe(3);
	});
	it('returns the value itself for n=1 and NaN for empty', () => {
		expect(quantileType7([42], 0.3)).toBe(42);
		expect(quantileType7([], 0.5)).toBeNaN();
	});
	it('does not mutate the input array', () => {
		const arr = [3, 1, 2];
		quantileType7(arr, 0.5);
		expect(arr).toEqual([3, 1, 2]);
	});
});
