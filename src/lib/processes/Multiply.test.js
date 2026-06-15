import { describe, it, expect } from 'vitest';
import { multiply } from './Multiply.svelte';

describe('multiply', () => {
	it('multiplies every element by a positive scalar', () => {
		expect(multiply([1, 2, 3], { value: 3 })).toEqual([3, 6, 9]);
	});

	it('multiplying by 1 leaves values unchanged', () => {
		expect(multiply([4, 5, 6], { value: 1 })).toEqual([4, 5, 6]);
	});

	it('multiplying by 0 zeroes every element', () => {
		expect(multiply([1, 2, 3], { value: 0 })).toEqual([0, 0, 0]);
	});

	it('multiplying by -1 negates every element', () => {
		expect(multiply([1, -2, 3], { value: -1 })).toEqual([-1, 2, -3]);
	});

	it('multiplies by a decimal value', () => {
		const out = multiply([2, 4], { value: 0.5 });
		expect(out[0]).toBeCloseTo(1, 8);
		expect(out[1]).toBeCloseTo(2, 8);
	});

	it('returns an empty array for empty input', () => {
		expect(multiply([], { value: 5 })).toEqual([]);
	});

	it('coerces string value arg to number', () => {
		expect(multiply([2, 4], { value: '3' })).toEqual([6, 12]);
	});

	it('handles a single-element column', () => {
		expect(multiply([7], { value: 2 })).toEqual([14]);
	});

	it('scales a constant column uniformly', () => {
		expect(multiply([3, 3, 3], { value: 2 })).toEqual([6, 6, 6]);
	});

	it('handles negative scalar with mixed-sign column', () => {
		expect(multiply([-2, 0, 4], { value: -2 })).toEqual([4, -0, -8]);
	});

	it('handles very large values', () => {
		const out = multiply([1e8, 2e8], { value: 1e8 });
		expect(out[0]).toBe(1e16);
		expect(out[1]).toBe(2e16);
	});

	it('returns a new array (does not mutate the input)', () => {
		const input = [1, 2, 3];
		const out = multiply(input, { value: 2 });
		expect(out).not.toBe(input);
		expect(input).toEqual([1, 2, 3]);
	});

	it('treats a missing value arg as NaN for every element', () => {
		// Number(undefined) === NaN.
		const out = multiply([1, 2, 3], {});
		out.forEach((v) => expect(Number.isNaN(v)).toBe(true));
	});

	it('propagates NaN for NaN entries; null coerces to 0', () => {
		const out = multiply([2, null, NaN], { value: 3 });
		expect(out[0]).toBe(6);
		expect(out[1]).toBe(0); // null * 3 === 0
		expect(Number.isNaN(out[2])).toBe(true);
	});

	it('is the inverse of dividing by the same factor', () => {
		const x = [3, 7, 11];
		const out = multiply(x, { value: 4 });
		out.forEach((v, i) => expect(v / 4).toBeCloseTo(x[i], 10));
	});
});
