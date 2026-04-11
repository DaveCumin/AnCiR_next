import { describe, it, expect } from 'vitest';
import { normalize } from './Normalize.svelte';

describe('normalize — z-score', () => {
	it('produces mean≈0 and std≈1', () => {
		const x = [2, 4, 4, 4, 5, 5, 7, 9];
		const out = normalize(x, { normalizationType: 'z-score' });
		const m = out.reduce((s, v) => s + v, 0) / out.length;
		const std = Math.sqrt(out.reduce((s, v) => s + (v - m) ** 2, 0) / out.length);
		expect(m).toBeCloseTo(0, 8);
		expect(std).toBeCloseTo(1, 5);
	});

	it('returns all zeros for constant array', () => {
		const out = normalize([3, 3, 3, 3], { normalizationType: 'z-score' });
		out.forEach((v) => expect(v).toBe(0));
	});

	it('preserves null/NaN positions', () => {
		const out = normalize([1, null, 3], { normalizationType: 'z-score' });
		expect(out[1]).toBeNull();
	});

	it('returns copy of input when no valid data', () => {
		const x = [null, null];
		const out = normalize(x, { normalizationType: 'z-score' });
		expect(out).toEqual(x);
	});
});

describe('normalize — min-max', () => {
	it('scales to [0, 1] by default', () => {
		const out = normalize([0, 5, 10], { normalizationType: 'min-max', customMin: 0, customMax: 1 });
		expect(out[0]).toBeCloseTo(0, 8);
		expect(out[1]).toBeCloseTo(0.5, 8);
		expect(out[2]).toBeCloseTo(1, 8);
	});

	it('scales to custom range [2, 8]', () => {
		const out = normalize([0, 10], { normalizationType: 'min-max', customMin: 2, customMax: 8 });
		expect(out[0]).toBeCloseTo(2, 8);
		expect(out[1]).toBeCloseTo(8, 8);
	});

	it('returns customMin for constant array', () => {
		const out = normalize([5, 5, 5], { normalizationType: 'min-max', customMin: 0, customMax: 1 });
		out.forEach((v) => expect(v).toBeCloseTo(0, 8));
	});

	it('preserves null/NaN positions', () => {
		const out = normalize([0, null, 10], {
			normalizationType: 'min-max',
			customMin: 0,
			customMax: 1
		});
		expect(out[1]).toBeNull();
	});
});

describe('normalize — robust (median/MAD)', () => {
	it('centres on median and scales by MAD', () => {
		// [1,2,3,4,5]: median=3, MAD=1 → (x-3)/1
		const out = normalize([1, 2, 3, 4, 5], { normalizationType: 'robust' });
		expect(out[2]).toBeCloseTo(0, 8); // median → 0
		expect(out[4]).toBeCloseTo(2, 8); // 5-3=2, MAD=1
	});

	it('returns all zeros when MAD is 0', () => {
		const out = normalize([7, 7, 7], { normalizationType: 'robust' });
		out.forEach((v) => expect(v).toBe(0));
	});
});

describe('normalize — unit-vector', () => {
	it('produces output with unit L2 norm', () => {
		const x = [3, 4]; // ||x|| = 5
		const out = normalize(x, { normalizationType: 'unit-vector' });
		expect(out[0]).toBeCloseTo(3 / 5, 8);
		expect(out[1]).toBeCloseTo(4 / 5, 8);
	});

	it('returns zeros for zero-magnitude array', () => {
		const out = normalize([0, 0, 0], { normalizationType: 'unit-vector' });
		out.forEach((v) => expect(v).toBe(0));
	});
});

describe('normalize — unknown type', () => {
	it('returns a copy of the input unchanged', () => {
		const x = [1, 2, 3];
		const out = normalize(x, { normalizationType: 'bogus' });
		expect(out).toEqual(x);
		expect(out).not.toBe(x); // different reference
	});
});
