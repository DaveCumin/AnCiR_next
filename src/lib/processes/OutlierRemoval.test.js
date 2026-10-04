import { describe, it, expect, vi } from 'vitest';

// The module script in OutlierRemoval.svelte imports Svelte UI components that
// aren't needed for the pure logic. Mock them so the module loads cleanly.
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));

import {
	outlierremoval,
	detectOutliersIQR,
	detectOutliersZScore,
	outlierRemovalWarnings,
	definition
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

	it('flags nothing for a constant array (std === 0 guard, no accidental wipe)', () => {
		expect(detectOutliersZScore([7, 7, 7, 7, 7], 3)).toEqual([false, false, false, false, false]);
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

// ─── too-few-points warning (free-process warnings channel) ──────────────────
// Fewer than 4 valid points silently passed the data through with nothing
// removed and nothing on screen to say why. The compute is unchanged;
// outlierRemovalWarnings → definition.getWarnings explains it on the node's
// ⚠ badge (processWarnings.js).

describe('outlierRemovalWarnings', () => {
	it('warns that too few valid points means nothing was removed', () => {
		const w = outlierRemovalWarnings([1, 2, 900]);
		expect(w).toHaveLength(1);
		expect(w[0]).toContain('4'); // the requirement
		expect(w[0]).toContain('3'); // what the data contains
		expect(w[0]).toContain('unchanged'); // what actually happened
	});

	it('does not count missing cells as points', () => {
		const w = outlierRemovalWarnings([1, null, 2, NaN, 3]);
		expect(w).toHaveLength(1);
		expect(w[0]).toContain('3');
	});

	it('is silent with 4+ valid points and for an empty input', () => {
		expect(outlierRemovalWarnings([1, 2, 3, 4])).toEqual([]);
		expect(outlierRemovalWarnings([])).toEqual([]);
	});
});

describe('definition.getWarnings — node warnings channel', () => {
	const freeNode = (data, args = {}) => ({
		parentCol: null,
		inputCol: data ? { getData: () => data } : null,
		args
	});

	it('surfaces the too-few-points message for a wired free node', () => {
		const w = definition.getWarnings(freeNode([5, 6]));
		expect(w).toHaveLength(1);
		expect(w[0]).toContain('2');
	});

	it('returns [] when nothing is wired', () => {
		expect(definition.getWarnings(freeNode(null))).toEqual([]);
	});
});

// ─── review STAT-22 / STAT-6 ─────────────────────────────────────────────────
// STAT-22: the IQR rule took its quartiles as sorted[floor(n/4)] and sorted[floor(3n/4)],
// unlike the Boxplot and DescribeData (type 7, numpy.percentile's default), so the same
// column could have an outlier in the plot and none in this node. And the z rule uses the
// population SD, which bounds max |z| at (n - 1)/sqrt(n) (Shiffler 1988): 2.85 at n = 10, so
// nine 1s and a 1000 removed nothing at threshold 3, with nothing on screen to say why.
// STAT-6: the valid-value filter was `x != null && !isNaN(x)`, which let '' and ' ' through
// as zeros.

describe('outlierremoval — review STAT-22 / STAT-6', () => {
	it('IQR fences use type-7 quartiles (as the Boxplot and DescribeData)', () => {
		// [1..7, 12]: type 7 gives q1 = 2.75, q3 = 6.25, upper fence 11.5, so 12 is out.
		// floor(n/4) gave q1 = 3, q3 = 7, fence 13, and kept it.
		const mask = detectOutliersIQR([1, 2, 3, 4, 5, 6, 7, 12], 1.5);
		expect(mask).toEqual([false, false, false, false, false, false, false, true]);
		// The lower quartile too: [-3, 1..7] has type-7 q1 = 1.75 and q3 = 5.25, lower fence
		// -3.5, so -3 stays (numpy.percentile agrees).
		expect(detectOutliersIQR([-3, 1, 2, 3, 4, 5, 6, 7], 1.5)[0]).toBe(false);
	});

	it('blank and whitespace cells are missing, not zeros', () => {
		// As zeros, the blanks would drag the mean down and make 0-ish values look typical;
		// here they must neither count nor be touched.
		const x = [10, 11, '', 10, ' ', 12, 11, 10, 500];
		const out = outlierremoval(x, { method: 'iqr', iqrMultiplier: 1.5 });
		expect(out[2]).toBe('');
		expect(out[4]).toBe(' ');
		expect(out[8]).toBeNull();
		expect(outlierRemovalWarnings(['', ' ', 1, 2, 3])[0]).toContain('3');
	});

	it('numeric strings are numbers', () => {
		const out = outlierremoval(['10', '11', '10', '12', '11', '10', '500'], {
			method: 'iqr',
			iqrMultiplier: 1.5
		});
		expect(out[6]).toBeNull();
		expect(out[0]).toBe('10');
	});

	it('warns when the z rule cannot fire at this n (max |z| is (n-1)/sqrt(n))', () => {
		const x = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1000];
		expect(outlierremoval(x, { method: 'zscore', zThreshold: 3 })).toEqual(x);
		const w = outlierRemovalWarnings(x, { method: 'zscore', zThreshold: 3 });
		expect(w).toHaveLength(1);
		expect(w[0]).toMatch(/10 points/);
		expect(w[0]).toMatch(/2\.85/);
		expect(w[0]).toMatch(/threshold of 3/);
	});

	it('is silent when the z rule can fire, and for the IQR rule', () => {
		const x11 = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1000]; // bound 3.02 > 3
		expect(outlierRemovalWarnings(x11, { method: 'zscore', zThreshold: 3 })).toEqual([]);
		const x10 = x11.slice(1);
		expect(outlierRemovalWarnings(x10, { method: 'iqr', zThreshold: 3 })).toEqual([]);
	});

	it('the node badge passes its own arguments', () => {
		const x = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1000];
		const w = definition.getWarnings({
			parentCol: null,
			inputCol: { getData: () => x },
			args: { method: 'zscore', zThreshold: 3 }
		});
		expect(w.join(' ')).toMatch(/can never flag/);
	});
});
