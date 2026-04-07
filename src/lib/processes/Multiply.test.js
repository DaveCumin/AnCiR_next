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
});
