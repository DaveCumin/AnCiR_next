import { describe, it, expect } from 'vitest';
import { KahanSum, kahanMean, makeSeqArray } from './numerics.js';

describe('KahanSum', () => {
	it('sums simple integers correctly', () => {
		const k = new KahanSum();
		k.add(1).add(2).add(3);
		expect(k.value).toBe(6);
	});

	it('initialises with a given value', () => {
		const k = new KahanSum(10);
		k.add(5);
		expect(k.value).toBe(15);
	});

	it('is more accurate than naive summation for many small floats', () => {
		// Sum 10_000 copies of 0.1 — naive gives accumulated FP error
		const n = 10_000;
		const val = 0.1;
		const expected = n * val; // 1000 exactly in real math

		// Naive summation
		let naive = 0;
		for (let i = 0; i < n; i++) naive += val;

		// Kahan summation
		const k = new KahanSum();
		for (let i = 0; i < n; i++) k.add(val);

		const naiveError = Math.abs(naive - expected);
		const kahanError = Math.abs(k.value - expected);

		// Kahan error should be strictly less than naive error
		expect(kahanError).toBeLessThan(naiveError);
		// And Kahan result should be very close to exact
		expect(k.value).toBeCloseTo(expected, 10);
	});
});

describe('kahanMean', () => {
	it('computes mean of a simple array', () => {
		expect(kahanMean([1, 2, 3, 4, 5])).toBeCloseTo(3, 10);
	});

	it('skips NaN values', () => {
		expect(kahanMean([1, NaN, 3])).toBeCloseTo(2, 10);
	});

	it('skips undefined values', () => {
		expect(kahanMean([2, undefined, 4])).toBeCloseTo(3, 10);
	});

	it('returns 0 for an empty array', () => {
		expect(kahanMean([])).toBe(0);
	});

	it('returns 0 for an all-NaN array', () => {
		expect(kahanMean([NaN, NaN])).toBe(0);
	});
});

describe('makeSeqArray', () => {
	it('generates sequence with step 1', () => {
		expect(makeSeqArray(0, 5, 1)).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it('generates correct length for fractional step', () => {
		const seq = makeSeqArray(0, 1, 0.25);
		expect(seq).toHaveLength(5);
		expect(seq[0]).toBe(0);
		expect(seq[4]).toBe(1);
	});

	it('avoids accumulated drift by using start + i*step', () => {
		// If drift were accumulated, values would grow out of sync
		const seq = makeSeqArray(0, 96, 0.25);
		// Check a few non-trivial positions
		expect(seq[100]).toBeCloseTo(25, 10); // 0 + 100*0.25 = 25
		expect(seq[200]).toBeCloseTo(50, 10);
		expect(seq[384]).toBeCloseTo(96, 10);
	});

	it('generates a single element when from === to', () => {
		expect(makeSeqArray(5, 5, 1)).toEqual([5]);
	});
});
