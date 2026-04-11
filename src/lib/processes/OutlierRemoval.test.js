import { describe, it, expect, vi } from 'vitest';

// The module script in OutlierRemoval.svelte imports Svelte UI components that
// aren't needed for the pure logic. Mock them so the module loads cleanly.
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));

import { outlierremoval } from './OutlierRemoval.svelte';

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
});
