import { describe, it, expect } from 'vitest';
import { min, max, minMax, mean, standardDeviation, minMaxAcross } from './stats.js';

describe('stats.min / stats.max — null semantics', () => {
	it('returns the extreme of a numeric array', () => {
		expect(min([3, 1, 4, 1, 5, 9])).toBe(1);
		expect(max([3, 1, 4, 1, 5, 9])).toBe(9);
	});

	it('returns null (not NaN) for an empty array', () => {
		expect(min([])).toBeNull();
		expect(max([])).toBeNull();
	});

	it('returns null when every entry is invalid', () => {
		expect(min([NaN, null, undefined])).toBeNull();
		expect(max([NaN, null, undefined])).toBeNull();
	});

	it('skips null / undefined / NaN entries', () => {
		expect(min([5, null, 2, undefined, NaN, 8])).toBe(2);
		expect(max([5, null, 2, undefined, NaN, 8])).toBe(8);
	});

	it('handles negative numbers', () => {
		expect(min([-5, -1, -3])).toBe(-5);
		expect(max([-5, -1, -3])).toBe(-1);
	});

	it('handles a single element', () => {
		expect(min([42])).toBe(42);
		expect(max([42])).toBe(42);
	});

	it('does not blow the stack on a very large array', () => {
		const big = Array.from({ length: 500_000 }, (_, i) => i);
		expect(min(big)).toBe(0);
		expect(max(big)).toBe(499_999);
	});
});

describe('stats.minMax', () => {
	it('returns both extremes in a single pass', () => {
		expect(minMax([3, 1, 4, 1, 5, 9, 2, 6])).toEqual({ min: 1, max: 9 });
	});

	it('returns {min:null,max:null} for an empty array', () => {
		expect(minMax([])).toEqual({ min: null, max: null });
	});

	it('skips invalid entries', () => {
		expect(minMax([NaN, 3, null, 7, undefined])).toEqual({ min: 3, max: 7 });
	});

	it('matches the standalone min/max helpers', () => {
		const data = [4, -2, 9, 0, 7, -5];
		const mm = minMax(data);
		expect(mm.min).toBe(min(data));
		expect(mm.max).toBe(max(data));
	});
});

describe('stats.mean', () => {
	it('averages a simple array', () => {
		expect(mean([1, 2, 3, 4, 5])).toBeCloseTo(3, 10);
	});

	it('skips NaN and undefined entries', () => {
		expect(mean([1, NaN, 3, undefined])).toBeCloseTo(2, 10);
	});

	it('returns 0 for an empty array', () => {
		expect(mean([])).toBe(0);
	});
});

describe('stats.standardDeviation', () => {
	it('computes population std dev for a known array', () => {
		// [2,4,4,4,5,5,7,9]: mean=5, pop-std=2
		expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 6);
	});

	it('returns 0 for all-equal values', () => {
		expect(standardDeviation([7, 7, 7, 7])).toBeCloseTo(0, 10);
	});

	it('returns NaN (not 0) for an empty array', () => {
		expect(standardDeviation([])).toBeNaN();
	});

	it('ignores null / undefined / NaN entries', () => {
		expect(standardDeviation([2, null, 4, NaN, 4, undefined, 4, 5, 5, 7, 9])).toBeCloseTo(2, 6);
	});
});

describe('stats.minMaxAcross', () => {
	it('reduces several arrays to a single extreme pair', () => {
		expect(minMaxAcross([[3, 7], [1, 9], [4, 2]])).toEqual({ min: 1, max: 9 });
	});

	it('skips null arrays in the iterable', () => {
		expect(minMaxAcross([[3, 7], null, [1, 9]])).toEqual({ min: 1, max: 9 });
	});

	it('skips invalid entries within each array', () => {
		expect(minMaxAcross([[NaN, 3], [null, 9, undefined]])).toEqual({ min: 3, max: 9 });
	});

	it('returns {min:null,max:null} when there is no valid data', () => {
		expect(minMaxAcross([[], [NaN], null])).toEqual({ min: null, max: null });
	});

	it('agrees with minMax over the concatenation of the arrays', () => {
		const arrays = [[5, -2, 8], [0, 12, -7], [3]];
		const flat = arrays.flat();
		expect(minMaxAcross(arrays)).toEqual(minMax(flat));
	});
});
