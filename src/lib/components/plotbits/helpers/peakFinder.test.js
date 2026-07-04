// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { argMax, argMaxAmong } from './peakFinder.js';

describe('argMax', () => {
	it('finds the max index over the whole array', () => {
		expect(argMax([1, 5, 3, 2])).toBe(1);
	});
	it('respects the start offset (e.g. skipping lag 0)', () => {
		expect(argMax([100, 5, 8, 3], 1)).toBe(2);
	});
	it('returns -1 when the range is empty', () => {
		expect(argMax([], 0)).toBe(-1);
		expect(argMax([9], 1)).toBe(-1);
		expect(argMax(null)).toBe(-1);
	});
	it('keeps the first index on ties (strictly greater wins)', () => {
		expect(argMax([4, 4, 4])).toBe(0);
	});
});

describe('argMaxAmong', () => {
	it('finds the max among the given candidate indices', () => {
		//        idx: 0  1  2  3  4
		const vals = [9, 1, 7, 2, 8];
		expect(argMaxAmong(vals, [1, 2, 3])).toBe(2);
	});
	it('ignores values outside the candidate set', () => {
		const vals = [9, 1, 7, 2, 8];
		expect(argMaxAmong(vals, [1, 3])).toBe(3);
	});
	it('returns -1 with no candidates', () => {
		expect(argMaxAmong([1, 2, 3], [])).toBe(-1);
		expect(argMaxAmong([1, 2, 3], null)).toBe(-1);
	});
});
