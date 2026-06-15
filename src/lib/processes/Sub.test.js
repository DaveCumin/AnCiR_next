import { describe, it, expect } from 'vitest';
import { sub } from './Sub.svelte';

describe('sub (Substitute)', () => {
	it('replaces matching numeric values', () => {
		expect(sub([1, 2, 3, 2, 1], { find: 2, replace: 99 })).toEqual([1, 99, 3, 99, 1]);
	});

	it('leaves non-matching values unchanged', () => {
		expect(sub([1, 2, 3], { find: 5, replace: 0 })).toEqual([1, 2, 3]);
	});

	it('replaces string values in a category-style array', () => {
		expect(sub(['a', 'b', 'a'], { find: 'a', replace: 'z' })).toEqual(['z', 'b', 'z']);
	});

	it('replaces 0 with another value', () => {
		expect(sub([0, 1, 0], { find: 0, replace: -1 })).toEqual([-1, 1, -1]);
	});

	it('returns empty array for empty input', () => {
		expect(sub([], { find: 1, replace: 2 })).toEqual([]);
	});

	it('replaces null when find is null', () => {
		expect(sub([1, null, 3], { find: null, replace: 0 })).toEqual([1, 0, 3]);
	});

	it('handles a single-element column (match)', () => {
		expect(sub([5], { find: 5, replace: 1 })).toEqual([1]);
	});

	it('handles a single-element column (no match)', () => {
		expect(sub([5], { find: 9, replace: 1 })).toEqual([5]);
	});

	it('replaces every element of a constant column when it matches', () => {
		expect(sub([7, 7, 7], { find: 7, replace: 0 })).toEqual([0, 0, 0]);
	});

	it('handles negative values', () => {
		expect(sub([-1, -2, -1], { find: -1, replace: 0 })).toEqual([0, -2, 0]);
	});

	it('uses loose equality: numeric find matches string element', () => {
		// i == find with find=0 matches the string "0".
		expect(sub([0, '0', 1], { find: 0, replace: 9 })).toEqual([9, 9, 1]);
	});

	it('uses loose equality: find=null also matches undefined entries', () => {
		// null == undefined is true under loose equality.
		expect(sub([null, undefined, 1], { find: null, replace: 9 })).toEqual([9, 9, 1]);
	});

	it('never matches NaN entries even when find is NaN (NaN != NaN)', () => {
		const out = sub([NaN, 1], { find: NaN, replace: 9 });
		expect(Number.isNaN(out[0])).toBe(true);
		expect(out[1]).toBe(1);
	});

	it('returns a new array (does not mutate the input)', () => {
		const input = [1, 2, 3];
		const out = sub(input, { find: 2, replace: 9 });
		expect(out).not.toBe(input);
		expect(input).toEqual([1, 2, 3]);
	});
});
