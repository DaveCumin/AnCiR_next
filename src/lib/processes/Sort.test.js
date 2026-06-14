// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { sort } from './Sort.svelte';

describe('sort (column process)', () => {
	it('sorts numeric values ascending by default', () => {
		expect(sort([3, 1, 2], { direction: 'asc' })).toEqual([1, 2, 3]);
	});
	it('sorts descending when direction=desc', () => {
		expect(sort([1, 3, 2], { direction: 'desc' })).toEqual([3, 2, 1]);
	});
	it('puts null/undefined/NaN at the end', () => {
		const out = sort([2, null, 1, undefined, NaN, 3], { direction: 'asc' });
		expect(out.slice(0, 3)).toEqual([1, 2, 3]);
		expect(out.slice(3).every((v) => v == null || (typeof v === 'number' && isNaN(v)))).toBe(true);
	});
	it('sorts strings lexicographically when direction=asc', () => {
		expect(sort(['b', 'a', 'c'], { direction: 'asc' })).toEqual(['a', 'b', 'c']);
	});
	it('returns a new array (does not mutate input)', () => {
		const input = [3, 1, 2];
		sort(input, { direction: 'asc' });
		expect(input).toEqual([3, 1, 2]);
	});
});
