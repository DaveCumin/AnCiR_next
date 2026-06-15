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

	it('defaults to z-score when no type is given', () => {
		// No normalizationType → falls back to 'z-score'.
		const out = normalize([1, 2, 3], {});
		const m = out.reduce((s, v) => s + v, 0) / out.length;
		expect(m).toBeCloseTo(0, 8);
	});
});

// ─── single-value behaviour across modes ───────────────────────────────────────

describe('normalize — single value', () => {
	it('z-score: single value has zero variance → 0', () => {
		expect(normalize([5], { normalizationType: 'z-score' })).toEqual([0]);
	});

	it('min-max: single value has zero range → customMin', () => {
		expect(normalize([5], { normalizationType: 'min-max', customMin: 0, customMax: 1 })).toEqual([0]);
	});

	it('robust: single value has zero MAD → 0', () => {
		expect(normalize([5], { normalizationType: 'robust' })).toEqual([0]);
	});

	it('unit-vector: single value normalises to its sign (±1)', () => {
		expect(normalize([5], { normalizationType: 'unit-vector' })).toEqual([1]);
		expect(normalize([-5], { normalizationType: 'unit-vector' })).toEqual([-1]);
	});
});

// ─── empty input across modes ──────────────────────────────────────────────────

describe('normalize — empty input', () => {
	for (const type of ['z-score', 'min-max', 'robust', 'unit-vector']) {
		it(`returns an empty array for ${type}`, () => {
			expect(normalize([], { normalizationType: type })).toEqual([]);
		});
	}
});

// ─── NaN/null preservation across all modes ────────────────────────────────────

describe('normalize — preserves null/NaN positions in every mode', () => {
	for (const type of ['z-score', 'min-max', 'robust', 'unit-vector']) {
		it(`keeps null and NaN entries in place (${type})`, () => {
			const out = normalize([1, null, 3, NaN, 5], { normalizationType: type });
			expect(out[1]).toBeNull();
			expect(Number.isNaN(out[3])).toBe(true);
			// Valid entries are transformed to finite numbers.
			[0, 2, 4].forEach((i) => expect(Number.isFinite(out[i])).toBe(true));
		});
	}
});

// ─── min-max range mapping ─────────────────────────────────────────────────────

describe('normalize — min-max range mapping', () => {
	it('maps to a negative custom range [-1, 1]', () => {
		const out = normalize([0, 5, 10], { normalizationType: 'min-max', customMin: -1, customMax: 1 });
		expect(out[0]).toBeCloseTo(-1, 8);
		expect(out[1]).toBeCloseTo(0, 8);
		expect(out[2]).toBeCloseTo(1, 8);
	});

	it('places every valid value within the requested range', () => {
		const x = [2, 7, 3, 9, 5, 1];
		const out = normalize(x, { normalizationType: 'min-max', customMin: 10, customMax: 20 });
		out.forEach((v) => {
			expect(v).toBeGreaterThanOrEqual(10 - 1e-9);
			expect(v).toBeLessThanOrEqual(20 + 1e-9);
		});
	});

	it('treats negative input values correctly', () => {
		const out = normalize([-10, -5, 0], { normalizationType: 'min-max', customMin: 0, customMax: 1 });
		expect(out[0]).toBeCloseTo(0, 8);
		expect(out[1]).toBeCloseTo(0.5, 8);
		expect(out[2]).toBeCloseTo(1, 8);
	});

	it('QUIRK: customMax of 0 is coerced to 1 via `|| 1` fallback', () => {
		// Number(args.customMax || 0/1): a falsy customMax (0) becomes 1.
		// This documents current behaviour, not necessarily desired behaviour.
		const out = normalize([0, 10], { normalizationType: 'min-max', customMin: -5, customMax: 0 });
		expect(out[0]).toBeCloseTo(-5, 8);
		expect(out[1]).toBeCloseTo(1, 8); // would be 0 if customMax=0 were honoured
	});
});

// ─── robust even-length & large values ─────────────────────────────────────────

describe('normalize — robust edge cases', () => {
	it('computes median/MAD correctly for an even-length array', () => {
		// [1,2,3,4]: median=2.5, deviations sorted=[0.5,0.5,1.5,1.5], MAD=1 → (x-2.5)/1
		const out = normalize([1, 2, 3, 4], { normalizationType: 'robust' });
		expect(out[0]).toBeCloseTo(-1.5, 8);
		expect(out[1]).toBeCloseTo(-0.5, 8);
		expect(out[2]).toBeCloseTo(0.5, 8);
		expect(out[3]).toBeCloseTo(1.5, 8);
	});

	it('is resistant to a single extreme outlier (median stays centred)', () => {
		const out = normalize([1, 2, 3, 4, 1000], { normalizationType: 'robust' });
		// median of [1,2,3,4,1000] is 3 → maps to 0.
		expect(out[2]).toBeCloseTo(0, 8);
	});
});

// ─── large values / unit-vector property ───────────────────────────────────────

describe('normalize — unit-vector property', () => {
	it('output L2 norm of valid entries equals 1', () => {
		const x = [1, 2, 3, 4];
		const out = normalize(x, { normalizationType: 'unit-vector' });
		const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0));
		expect(norm).toBeCloseTo(1, 8);
	});

	it('handles large magnitudes without producing NaN/Infinity', () => {
		const out = normalize([1e8, 2e8, 3e8], { normalizationType: 'unit-vector' });
		out.forEach((v) => expect(Number.isFinite(v)).toBe(true));
		const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0));
		expect(norm).toBeCloseTo(1, 8);
	});
});

describe('normalize — z-score with large values', () => {
	it('still yields mean≈0, std≈1', () => {
		const x = [1e6, 2e6, 3e6, 4e6, 5e6];
		const out = normalize(x, { normalizationType: 'z-score' });
		const m = out.reduce((s, v) => s + v, 0) / out.length;
		const std = Math.sqrt(out.reduce((s, v) => s + (v - m) ** 2, 0) / out.length);
		expect(m).toBeCloseTo(0, 6);
		expect(std).toBeCloseTo(1, 6);
	});
});
