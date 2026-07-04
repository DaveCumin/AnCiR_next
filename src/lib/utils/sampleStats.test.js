// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { mean, sampleVariance, sampleStd, median } from './sampleStats.js';

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
