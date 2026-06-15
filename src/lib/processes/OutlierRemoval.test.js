import { describe, it, expect, vi } from 'vitest';

// The module script in OutlierRemoval.svelte imports Svelte UI components that
// aren't needed for the pure logic. Mock them so the module loads cleanly.
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));

import {
	outlierremoval,
	detectOutliersIQR,
	detectOutliersZScore
} from './OutlierRemoval.svelte';

// ─── Z-score method ──────────────────────────────────────────────────────────

describe('outlierremoval — zscore', () => {
	it('replaces extreme outliers with null', () => {
		// 98 values near 0, plus two extreme outliers
		const data = new Array(49).fill(0).concat([1000, -1000]).concat(new Array(49).fill(0));
		const out = outlierremoval(data, { method: 'zscore', zThreshold: 3 });
		expect(out[49]).toBeNull();
		expect(out[50]).toBeNull();
	});

	it('preserves non-outlier values', () => {
		const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
		const out = outlierremoval(data, { method: 'zscore', zThreshold: 3 });
		// No outliers in tight distribution — original values preserved
		out.forEach((v, i) => expect(v).toBe(data[i]));
	});

	it('preserves existing null values at their original positions', () => {
		const data = [1, null, 3, 4, 5, 6, 7, 8, 9, 10];
		const out = outlierremoval(data, { method: 'zscore', zThreshold: 3 });
		expect(out[1]).toBeNull();
	});

	it('returns original array when fewer than 4 valid values', () => {
		const data = [1, 2, 3];
		const out = outlierremoval(data, { method: 'zscore', zThreshold: 3 });
		expect(out).toEqual(data);
	});

	it('returns same length as input', () => {
		const data = Array.from({ length: 20 }, (_, i) => i);
		const out = outlierremoval(data, { method: 'zscore', zThreshold: 3 });
		expect(out).toHaveLength(20);
	});

	it('uses a tighter threshold to remove more values', () => {
		const data = new Array(48).fill(0).concat([5, -5]);
		const outLoose = outlierremoval(data, { method: 'zscore', zThreshold: 5 });
		const outTight = outlierremoval(data, { method: 'zscore', zThreshold: 1 });
		const nullsLoose = outLoose.filter((v) => v === null).length;
		const nullsTight = outTight.filter((v) => v === null).length;
		expect(nullsTight).toBeGreaterThanOrEqual(nullsLoose);
	});
});

// ─── IQR method ──────────────────────────────────────────────────────────────

describe('outlierremoval — iqr', () => {
	it('removes high outlier beyond IQR fence', () => {
		// 48 values at 0–10, plus one extreme outlier at 1000
		const data = Array.from({ length: 48 }, (_, i) => i % 10).concat([1000]);
		const out = outlierremoval(data, { method: 'iqr', iqrMultiplier: 1.5 });
		expect(out[48]).toBeNull();
	});

	it('preserves values within IQR bounds', () => {
		const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
		const out = outlierremoval(data, { method: 'iqr', iqrMultiplier: 1.5 });
		// No outliers — all values kept
		const nullCount = out.filter((v) => v === null).length;
		expect(nullCount).toBe(0);
	});

	it('returns same length as input', () => {
		const data = Array.from({ length: 20 }, (_, i) => i);
		const out = outlierremoval(data, { method: 'iqr', iqrMultiplier: 1.5 });
		expect(out).toHaveLength(20);
	});

	it('smaller multiplier removes more points', () => {
		const data = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? i : -i));
		const outWide = outlierremoval(data, { method: 'iqr', iqrMultiplier: 3 });
		const outNarrow = outlierremoval(data, { method: 'iqr', iqrMultiplier: 0.5 });
		const nullsWide = outWide.filter((v) => v === null).length;
		const nullsNarrow = outNarrow.filter((v) => v === null).length;
		expect(nullsNarrow).toBeGreaterThanOrEqual(nullsWide);
	});

	it('defaults to IQR when method is unrecognised', () => {
		// outlierremoval routes any non-'zscore' method to the IQR branch.
		const data = Array.from({ length: 48 }, (_, i) => i % 10).concat([1000]);
		const out = outlierremoval(data, { method: 'something-else', iqrMultiplier: 1.5 });
		expect(out[48]).toBeNull();
	});
});

// ─── boundary / constant / minimum-data edge cases ─────────────────────────────

describe('outlierremoval — boundary and degenerate inputs', () => {
	it('returns original (same reference) when exactly 3 valid values', () => {
		const data = [1, 2, 3];
		expect(outlierremoval(data, { method: 'zscore', zThreshold: 3 })).toBe(data);
	});

	it('processes when exactly 4 valid values (the minimum)', () => {
		// 4 valid values clears the `< 4` guard; output must have same length.
		const data = [1, 2, 3, 4];
		const out = outlierremoval(data, { method: 'iqr', iqrMultiplier: 1.5 });
		expect(out).toHaveLength(4);
	});

	it('removes nothing from a constant column (zscore: std=0 → NaN compares false)', () => {
		const data = [5, 5, 5, 5, 5];
		const out = outlierremoval(data, { method: 'zscore', zThreshold: 3 });
		expect(out).toEqual([5, 5, 5, 5, 5]);
	});

	it('removes nothing from a constant column (iqr: iqr=0)', () => {
		const data = [5, 5, 5, 5, 5];
		const out = outlierremoval(data, { method: 'iqr', iqrMultiplier: 1.5 });
		expect(out).toEqual([5, 5, 5, 5, 5]);
	});

	it('counts only non-null entries toward the 4-value minimum', () => {
		// 3 valid + 2 nulls → still under the threshold, original returned.
		const data = [1, null, 2, null, 3];
		expect(outlierremoval(data, { method: 'zscore', zThreshold: 3 })).toBe(data);
	});

	it('handles negative outliers symmetrically', () => {
		const data = new Array(48).fill(0).concat([-1000]);
		const out = outlierremoval(data, { method: 'zscore', zThreshold: 3 });
		expect(out[48]).toBeNull();
	});
});

// ─── exported detector functions: boundary strictness ──────────────────────────

describe('detectOutliersZScore — boundary', () => {
	it('flags nothing when |z| equals the threshold exactly (strict >)', () => {
		// [-1, 1]: mean 0, std 1, so z = ±1 exactly.
		expect(detectOutliersZScore([-1, 1], 1)).toEqual([false, false]);
	});

	it('flags both when the threshold is just below |z|', () => {
		expect(detectOutliersZScore([-1, 1], 0.99)).toEqual([true, true]);
	});

	it('uses a default threshold of 3 when omitted', () => {
		// A single moderate point in tight data: not an outlier at default 3.
		expect(detectOutliersZScore([1, 2, 3, 4, 5]).every((v) => v === false)).toBe(true);
	});

	it('returns a boolean mask of the same length', () => {
		expect(detectOutliersZScore([1, 2, 3, 4], 3)).toHaveLength(4);
	});
});

describe('detectOutliersIQR — boundary', () => {
	it('keeps a value sitting exactly on the upper fence (strict >)', () => {
		// [1..8] → q1=3, q3=7, iqr=4, upper fence = 7 + 1.5*4 = 13.
		const data = [1, 2, 3, 4, 5, 6, 7, 8, 13];
		const mask = detectOutliersIQR(data, 1.5);
		// recompute for the 9-element set: the value 13 should not be flagged
		// when it lands on the fence; assert it is kept (false) at minimum.
		expect(mask[mask.length - 1]).toBe(false);
	});

	it('uses a default multiplier of 1.5 when omitted', () => {
		const data = [1, 2, 3, 4, 5, 6, 7, 1000];
		const mask = detectOutliersIQR(data);
		expect(mask[mask.length - 1]).toBe(true);
	});

	it('returns a boolean mask of the same length', () => {
		expect(detectOutliersIQR([1, 2, 3, 4], 1.5)).toHaveLength(4);
	});
});
