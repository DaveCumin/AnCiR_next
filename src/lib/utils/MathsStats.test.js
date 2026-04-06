import { describe, it, expect } from 'vitest';
import { calculateStandardDeviation, mean, max, min } from './MathsStats.js';

describe('mean', () => {
	it('returns the average of an array', () => {
		expect(mean([1, 2, 3, 4, 5])).toBe(3);
	});

	it('handles a single element', () => {
		expect(mean([42])).toBe(42);
	});

	it('handles negative values', () => {
		expect(mean([-2, 0, 2])).toBe(0);
	});
});

describe('max', () => {
	it('returns the maximum value', () => {
		expect(max([3, 1, 4, 1, 5, 9])).toBe(9);
	});

	it('handles negative numbers', () => {
		expect(max([-5, -1, -3])).toBe(-1);
	});

	it('returns NaN for an empty array', () => {
		expect(max([])).toBeNaN();
	});

	it('skips NaN values', () => {
		expect(max([1, NaN, 3])).toBe(3);
	});
});

describe('min', () => {
	it('returns the minimum value', () => {
		expect(min([3, 1, 4, 1, 5])).toBe(1);
	});

	it('handles negative numbers', () => {
		expect(min([-5, -1, -3])).toBe(-5);
	});

	it('returns NaN for an empty array', () => {
		expect(min([])).toBeNaN();
	});

	it('skips NaN values', () => {
		expect(min([5, NaN, 2])).toBe(2);
	});
});

describe('calculateStandardDeviation', () => {
	it('computes population std dev for a known array', () => {
		// [2, 4, 4, 4, 5, 5, 7, 9]: mean=5, pop-std=2
		expect(calculateStandardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 5);
	});

	it('returns 0 for an array of identical values', () => {
		expect(calculateStandardDeviation([7, 7, 7, 7])).toBeCloseTo(0, 10);
	});

	it('returns 0 for a single element', () => {
		expect(calculateStandardDeviation([99])).toBeCloseTo(0, 10);
	});

	it('handles negative values', () => {
		// [-1, 0, 1]: mean=0, pop-std=sqrt(2/3)
		expect(calculateStandardDeviation([-1, 0, 1])).toBeCloseTo(Math.sqrt(2 / 3), 5);
	});
});
