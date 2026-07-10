import { describe, it, expect } from 'vitest';
import { meanSemByGroup, compareGroupKeys } from './meanSem.js';

describe('meanSemByGroup', () => {
	it('computes mean and SEM for a single group with known values', () => {
		// values 2,4,4,4,5,5,7,9 → mean 5, Σ(y-ȳ)²=32, sample sd sqrt(32/7)
		const ys = [2, 4, 4, 4, 5, 5, 7, 9];
		const xs = ys.map(() => 'A');
		const res = meanSemByGroup(xs, ys);
		const expectedSd = Math.sqrt(32 / 7);
		expect(res).toHaveLength(1);
		expect(res[0].x).toBe('A');
		expect(res[0].n).toBe(8);
		expect(res[0].mean).toBeCloseTo(5, 12);
		expect(res[0].sd).toBeCloseTo(expectedSd, 12);
		expect(res[0].sem).toBeCloseTo(expectedSd / Math.sqrt(8), 12);
	});

	it('groups multiple x categories and sorts numerically', () => {
		const xs = [10, 2, 10, 2, 2];
		const ys = [1, 3, 3, 5, 7];
		const res = meanSemByGroup(xs, ys);
		expect(res.map((r) => r.x)).toEqual([2, 10]);
		// group 2: [3,5,7] mean 5, sd 2, sem 2/sqrt(3)
		expect(res[0].mean).toBeCloseTo(5, 12);
		expect(res[0].sd).toBeCloseTo(2, 12);
		expect(res[0].sem).toBeCloseTo(2 / Math.sqrt(3), 12);
		// group 10: [1,3] mean 2, sd sqrt(2), sem sqrt(2)/sqrt(2)=1
		expect(res[1].mean).toBeCloseTo(2, 12);
		expect(res[1].sd).toBeCloseTo(Math.SQRT2, 12);
		expect(res[1].sem).toBeCloseTo(1, 12);
	});

	it('treats numeric and string keys of equal value as one group', () => {
		const res = meanSemByGroup([3, '3'], [10, 20]);
		expect(res).toHaveLength(1);
		expect(res[0].n).toBe(2);
		expect(res[0].mean).toBeCloseTo(15, 12);
	});

	it('reports sem 0 and sd 0 for singleton groups', () => {
		const res = meanSemByGroup(['A'], [42]);
		expect(res[0].n).toBe(1);
		expect(res[0].mean).toBe(42);
		expect(res[0].sd).toBe(0);
		expect(res[0].sem).toBe(0);
	});

	it('ignores null / NaN y values and null / NaN x keys', () => {
		const xs = ['A', 'A', 'A', null, NaN, 'A'];
		const ys = [4, null, NaN, 5, 6, 8];
		const res = meanSemByGroup(xs, ys);
		expect(res).toHaveLength(1);
		expect(res[0].x).toBe('A');
		// only 4 and 8 survive → mean 6, sd sqrt(8), sem 2
		expect(res[0].n).toBe(2);
		expect(res[0].mean).toBeCloseTo(6, 12);
		expect(res[0].sem).toBeCloseTo(2, 12);
	});

	it('returns an empty array for empty / mismatched input', () => {
		expect(meanSemByGroup([], [])).toEqual([]);
		expect(meanSemByGroup(undefined, undefined)).toEqual([]);
		expect(meanSemByGroup(['A', 'B'], [])).toEqual([]);
		// all-invalid pairs
		expect(meanSemByGroup(['A', 'B'], [null, NaN])).toEqual([]);
	});

	it('uses only the overlapping length when arrays differ in length', () => {
		const res = meanSemByGroup(['A', 'A', 'B'], [1, 3]);
		// third pair (B) has no y → dropped
		expect(res).toHaveLength(1);
		expect(res[0].x).toBe('A');
		expect(res[0].mean).toBeCloseTo(2, 12);
	});
});

describe('compareGroupKeys', () => {
	it('orders numeric-like keys numerically, not lexically', () => {
		const sorted = ['10', '2', '1'].sort(compareGroupKeys);
		expect(sorted).toEqual(['1', '2', '10']);
	});

	it('orders non-numeric keys lexicographically', () => {
		const sorted = ['banana', 'apple', 'cherry'].sort(compareGroupKeys);
		expect(sorted).toEqual(['apple', 'banana', 'cherry']);
	});
});
