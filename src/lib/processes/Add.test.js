import { describe, it, expect } from 'vitest';
import { add } from './Add.svelte';

describe('add', () => {
	it('adds a positive value to every element', () => {
		expect(add([1, 2, 3], { value: 10 })).toEqual([11, 12, 13]);
	});

	it('adds a negative value (subtraction)', () => {
		expect(add([5, 10, 15], { value: -3 })).toEqual([2, 7, 12]);
	});

	it('adding zero leaves values unchanged', () => {
		expect(add([1, 2, 3], { value: 0 })).toEqual([1, 2, 3]);
	});

	it('adds a decimal value', () => {
		const out = add([1, 2], { value: 0.5 });
		expect(out[0]).toBeCloseTo(1.5, 8);
		expect(out[1]).toBeCloseTo(2.5, 8);
	});

	it('returns an empty array for empty input', () => {
		expect(add([], { value: 5 })).toEqual([]);
	});

	it('coerces string value arg to number', () => {
		expect(add([3, 6], { value: '2' })).toEqual([5, 8]);
	});

	it('handles a single-element column', () => {
		expect(add([7], { value: 3 })).toEqual([10]);
	});

	it('preserves a constant column shifted by the value', () => {
		expect(add([4, 4, 4], { value: 1 })).toEqual([5, 5, 5]);
	});

	it('handles negative elements plus a positive value', () => {
		expect(add([-5, -1, 0], { value: 5 })).toEqual([0, 4, 5]);
	});

	it('handles very large values without overflow to Infinity', () => {
		const out = add([1e15, 2e15], { value: 1e15 });
		expect(out[0]).toBe(2e15);
		expect(out[1]).toBe(3e15);
		out.forEach((v) => expect(isFinite(v)).toBe(true));
	});

	it('returns a new array (does not mutate the input)', () => {
		const input = [1, 2, 3];
		const out = add(input, { value: 1 });
		expect(out).not.toBe(input);
		expect(input).toEqual([1, 2, 3]);
	});

	it('treats a missing/undefined value arg as NaN for every element', () => {
		// Number(undefined) === NaN, so every element becomes NaN.
		const out = add([1, 2, 3], {});
		out.forEach((v) => expect(Number.isNaN(v)).toBe(true));
	});

	it('propagates NaN for null/NaN entries in the column', () => {
		const out = add([1, null, NaN], { value: 2 });
		expect(out[0]).toBe(3);
		// null + 2 === 2 (null coerces to 0); NaN + 2 === NaN
		expect(out[1]).toBe(2);
		expect(Number.isNaN(out[2])).toBe(true);
	});
});
