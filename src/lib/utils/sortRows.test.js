import { describe, it, expect } from 'vitest';
import { sortPermutation, applyPermutation, sortValues, isSorted } from './sortRows.js';

describe('sortPermutation', () => {
	it('sorts numbers ascending by default', () => {
		expect(sortPermutation([3, 1, 2])).toEqual([1, 2, 0]);
		expect(sortValues([3, 1, 2])).toEqual([1, 2, 3]);
	});

	it('sorts numbers descending', () => {
		expect(sortValues([3, 1, 2], { direction: 'desc' })).toEqual([3, 2, 1]);
	});

	it('sorts numeric strings as numbers', () => {
		expect(sortValues(['10', '2', '1'])).toEqual(['1', '2', '10']);
	});

	it('sorts non-numeric strings lexicographically', () => {
		expect(sortValues(['banana', 'apple', 'cherry'])).toEqual(['apple', 'banana', 'cherry']);
	});

	it('descending reverses non-numeric strings', () => {
		expect(sortValues(['apple', 'banana', 'cherry'], { direction: 'desc' })).toEqual([
			'cherry',
			'banana',
			'apple'
		]);
	});

	it('treats null and NaN as missing and places them LAST (ascending)', () => {
		expect(sortValues([3, null, 1, NaN, 2])).toEqual([1, 2, 3, null, NaN]);
	});

	it('keeps missing LAST even when descending', () => {
		const out = sortValues([3, null, 1, 2], { direction: 'desc' });
		expect(out.slice(0, 3)).toEqual([3, 2, 1]);
		expect(out[3]).toBeNull();
	});

	it('is stable for equal keys', () => {
		// Two records with equal key 1 must keep original order (indices 1 then 3).
		const perm = sortPermutation([2, 1, 2, 1]);
		expect(perm).toEqual([1, 3, 0, 2]);
	});

	it('preserves relative order of multiple missing values', () => {
		const a = null;
		const b = undefined;
		const out = sortValues([1, a, 0, b]);
		expect(out[0]).toBe(0);
		expect(out[1]).toBe(1);
		expect(out[2]).toBe(a); // first missing
		expect(out[3]).toBe(b); // second missing, original order preserved
	});

	it('handles empty and single-element arrays', () => {
		expect(sortPermutation([])).toEqual([]);
		expect(sortPermutation([42])).toEqual([0]);
		expect(sortValues([])).toEqual([]);
	});

	it('handles an all-missing array', () => {
		expect(sortPermutation([null, NaN, undefined])).toEqual([0, 1, 2]);
	});

	it('sorts pre-converted time keys (epoch ms) ascending', () => {
		// Callers convert timestamps to numbers (hoursSinceStart / epoch ms) first.
		const ms = [3000, 1000, 2000];
		expect(sortPermutation(ms)).toEqual([1, 2, 0]);
	});
});

describe('applyPermutation', () => {
	it('reorders a parallel array by the permutation (keeps rows aligned)', () => {
		const keys = [3, 1, 2];
		const other = ['c', 'a', 'b'];
		const perm = sortPermutation(keys);
		expect(applyPermutation(keys, perm)).toEqual([1, 2, 3]);
		expect(applyPermutation(other, perm)).toEqual(['a', 'b', 'c']);
	});

	it('does not mutate the input', () => {
		const arr = [3, 1, 2];
		applyPermutation(arr, [1, 2, 0]);
		expect(arr).toEqual([3, 1, 2]);
	});
});

describe('isSorted', () => {
	it('returns true for already-ascending numbers', () => {
		expect(isSorted([1, 2, 3])).toBe(true);
		expect(isSorted([1, 1, 2])).toBe(true);
	});

	it('returns false for out-of-order numbers', () => {
		expect(isSorted([1, 3, 2])).toBe(false);
	});

	it('respects descending direction', () => {
		expect(isSorted([3, 2, 1], { direction: 'desc' })).toBe(true);
		expect(isSorted([3, 1, 2], { direction: 'desc' })).toBe(false);
	});

	it('ignores missing values when checking order', () => {
		expect(isSorted([1, null, 2, 3])).toBe(true);
		expect(isSorted([1, 2, NaN, 3])).toBe(true);
	});

	it('handles empty and single element', () => {
		expect(isSorted([])).toBe(true);
		expect(isSorted([5])).toBe(true);
	});

	it('works for strings', () => {
		expect(isSorted(['a', 'b', 'c'])).toBe(true);
		expect(isSorted(['a', 'c', 'b'])).toBe(false);
	});
});
