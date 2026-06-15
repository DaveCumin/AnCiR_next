import { describe, it, expect } from 'vitest';
import {
	calculateStandardDeviation,
	mean,
	max,
	min,
	createSequenceArray
} from './MathsStats.js';

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

	it('returns NaN for an empty array', () => {
		expect(calculateStandardDeviation([])).toBeNaN();
	});

	it('ignores null / undefined / NaN entries', () => {
		expect(calculateStandardDeviation([2, null, 4, undefined, 4, NaN, 4, 5, 5, 7, 9])).toBeCloseTo(
			2,
			5
		);
	});
});

describe('MathsStats wrappers — NaN (not null) for empty input', () => {
	it('mean returns 0 for empty (delegates to kahanMean)', () => {
		expect(mean([])).toBe(0);
	});

	it('min/max return NaN when every entry is invalid', () => {
		expect(min([NaN, null, undefined])).toBeNaN();
		expect(max([NaN, null, undefined])).toBeNaN();
	});

	it('min/max skip null and undefined', () => {
		expect(min([5, null, 2, undefined, 8])).toBe(2);
		expect(max([5, null, 2, undefined, 8])).toBe(8);
	});
});

describe('createSequenceArray', () => {
	it('generates an inclusive integer sequence with the default step', () => {
		expect(createSequenceArray(0, 5)).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it('honours a custom step', () => {
		expect(createSequenceArray(0, 10, 2)).toEqual([0, 2, 4, 6, 8, 10]);
	});

	it('returns a single element when start === end', () => {
		expect(createSequenceArray(3, 3)).toEqual([3]);
	});

	it('returns an empty array when start > end with a positive step', () => {
		expect(createSequenceArray(5, 0, 1)).toEqual([]);
	});

	it('handles negative start values', () => {
		expect(createSequenceArray(-2, 2)).toEqual([-2, -1, 0, 1, 2]);
	});
});
