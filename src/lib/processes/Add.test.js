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
});
