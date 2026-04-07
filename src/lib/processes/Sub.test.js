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
});
