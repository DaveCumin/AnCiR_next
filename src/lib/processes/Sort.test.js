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

	it('returns an empty array for empty input', () => {
		expect(sort([], { direction: 'asc' })).toEqual([]);
	});

	it('handles a single value', () => {
		expect(sort([42], { direction: 'asc' })).toEqual([42]);
		expect(sort([42], { direction: 'desc' })).toEqual([42]);
	});

	it('defaults to ascending when direction is omitted', () => {
		expect(sort([3, 1, 2], {})).toEqual([1, 2, 3]);
		expect(sort([3, 1, 2], undefined)).toEqual([1, 2, 3]);
	});

	it('sorts negative and mixed-sign numbers ascending', () => {
		expect(sort([-3, 2, -1, 0], { direction: 'asc' })).toEqual([-3, -1, 0, 2]);
	});

	it('sorts negative and mixed-sign numbers descending', () => {
		expect(sort([-3, 2, -1, 0], { direction: 'desc' })).toEqual([2, 0, -1, -3]);
	});

	it('orders very large and very small magnitudes correctly', () => {
		expect(sort([1e20, 1, 1e-20], { direction: 'asc' })).toEqual([1e-20, 1, 1e20]);
	});

	it('keeps numeric ties together and preserves equal values', () => {
		const out = sort([2, 1, 2, 1, 2], { direction: 'asc' });
		expect(out).toEqual([1, 1, 2, 2, 2]);
	});

	it('puts missing values last in descending order too', () => {
		const out = sort([2, null, 3, NaN, 1], { direction: 'desc' });
		expect(out.slice(0, 3)).toEqual([3, 2, 1]);
		expect(out.slice(3).every((v) => v == null || (typeof v === 'number' && isNaN(v)))).toBe(true);
	});

	it('keeps all-missing input unchanged in length and missing-ness', () => {
		const out = sort([null, NaN, undefined], { direction: 'asc' });
		expect(out).toHaveLength(3);
		expect(out.every((v) => v == null || (typeof v === 'number' && isNaN(v)))).toBe(true);
	});

	it('sorts strings descending lexicographically', () => {
		expect(sort(['b', 'a', 'c'], { direction: 'desc' })).toEqual(['c', 'b', 'a']);
	});

	it('preserves order of equal strings (stable for ties)', () => {
		// localeCompare returns 0 for equal strings; V8 sort is stable.
		const out = sort(['b', 'a', 'b', 'a'], { direction: 'asc' });
		expect(out).toEqual(['a', 'a', 'b', 'b']);
	});

	it('string branch uses lexicographic order, not numeric (10 before 2)', () => {
		expect(sort(['10', '2', '1'], { direction: 'asc' })).toEqual(['1', '10', '2']);
	});
});
