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

	it('returns an empty array when from > to with a positive step', () => {
		// floor((0-5)/1) = -5  →  loop never runs
		expect(makeSeqArray(5, 0, 1)).toEqual([]);
	});

	it('handles negative ranges', () => {
		expect(makeSeqArray(-3, 0, 1)).toEqual([-3, -2, -1, 0]);
	});

	it('every element equals from + i*step (no accumulation)', () => {
		const from = 1.1;
		const step = 0.1;
		const seq = makeSeqArray(from, from + 5, step);
		for (let i = 0; i < seq.length; i++) {
			expect(seq[i]).toBeCloseTo(from + i * step, 12);
		}
	});

	// BUG: step === 0 makes n = floor((to-from)/0) = Infinity, so the
	// `for (i = 0; i <= n; i++)` loop never terminates (the function hangs).
	// Expected: guard a zero step and return [] or [from] rather than looping
	// forever. Left as a todo so the suite does not hang.
	it.todo('does not hang when step is 0 (should return [] or [from])');
});

describe('KahanSum — edge cases', () => {
	it('starts at zero with no additions', () => {
		expect(new KahanSum().value).toBe(0);
	});

	it('handles negative and mixed-sign values', () => {
		const k = new KahanSum();
		k.add(-5).add(10).add(-2.5);
		expect(k.value).toBeCloseTo(2.5, 12);
	});

	it('propagates NaN once a NaN is added', () => {
		const k = new KahanSum();
		k.add(1).add(NaN).add(2);
		expect(k.value).toBeNaN();
	});

	it('propagates Infinity', () => {
		const k = new KahanSum();
		k.add(1).add(Infinity);
		expect(k.value).toBe(Infinity);
	});

	it('add() is chainable and returns the instance', () => {
		const k = new KahanSum();
		expect(k.add(1)).toBe(k);
	});

	it('preserves a small running value against alternating ±1e8 terms better than naive', () => {
		// A magnitude gap that Kahan can recover (unlike a gap at the eps limit).
		const big = 1e8;
		const small = 1;
		const k = new KahanSum();
		let naive = 0;
		k.add(small);
		naive += small;
		for (let i = 0; i < 5000; i++) {
			k.add(big).add(-big);
			naive += big;
			naive -= big;
		}
		// True sum is `small`. Kahan should land exactly on it here.
		expect(k.value).toBe(small);
		expect(Math.abs(k.value - small)).toBeLessThanOrEqual(Math.abs(naive - small));
	});
});

describe('kahanMean — edge cases', () => {
	it('handles a single element', () => {
		expect(kahanMean([42])).toBe(42);
	});

	it('handles negative numbers', () => {
		expect(kahanMean([-2, 0, 2])).toBeCloseTo(0, 12);
	});

	it('mixes valid and invalid entries, dividing by the valid count only', () => {
		// valid: 2, 4, 6 → mean 4
		expect(kahanMean([2, NaN, 4, undefined, 6])).toBeCloseTo(4, 12);
	});

	it('does NOT skip null (null coerces to 0 in arithmetic)', () => {
		// Documents current behaviour: null passes the `!== undefined && !isNaN`
		// guard because isNaN(null) === false, and null is summed as 0.
		// mean of [2, null→0, 4] over count 3 = 2
		expect(kahanMean([2, null, 4])).toBeCloseTo(2, 12);
	});
});
