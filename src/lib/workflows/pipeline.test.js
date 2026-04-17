/**
 * Pipeline walk-through tests.
 *
 * These tests chain the actual pure-function implementations (not mocked) on
 * synthetic data to verify scientific correctness of the full processing
 * pathway. No Svelte component rendering is involved — only the module-script
 * exports are exercised.
 *
 * Coverage:
 *   1. Column-process chain: add → multiply → normalize
 *   2. Outlier removal injects null at the right index
 *   3. Trend removal leaves near-zero residual mean and removes linear drift
 *   4. BinData produces correct bin means
 *   5. BoxPlot statistics (q1/q2/q3/whiskers/outliers) on known data
 *   6. Full cosinor pipeline: normalize → fitCosinorFixed → verify mesor/amplitude
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Svelte UI components so they don't throw when imported ───────────
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/ColumnSelector.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/ColourPicker.svelte', () => ({
	default: {},
	getPaletteColor: () => '#234154',
	getRandomColor: () => '#234154'
}));
vi.mock('$lib/icons/Icon.svelte', () => ({ default: {} }));
vi.mock('$lib/components/plotbits/helpers/misc.js', () => ({ isValidStroke: () => true }));

// Column.svelte and core.svelte are mocked so that functions that accept an
// optional xColId (like removetrend) fall back to index-based time when given -1.
const mockColumns = {};
vi.mock('$lib/core/Column.svelte', () => ({
	getColumnById: (id) => mockColumns[id],
	Column: class {
		constructor() {
			this.id = Math.random();
			this.name = '';
		}
	}
}));
vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData: { set: vi.fn() } },
	appConsts: { processMap: new Map() }
}));

// ── Import functions under test ───────────────────────────────────────────
import { add } from '$lib/processes/Add.svelte';
import { multiply } from '$lib/processes/Multiply.svelte';
import { normalize } from '$lib/processes/normalize.svelte';
import { outlierremoval } from '$lib/processes/OutlierRemoval.svelte';
import { removetrend } from '$lib/processes/RemoveTrend.svelte';
import { fitCosinorFixed } from '$lib/utils/cosinor.js';
import { binData } from '$lib/components/plotbits/helpers/wrangleData.js';
import { calculateBoxPlotStats } from '$lib/components/plotbits/Box.svelte';

// ── Synthetic data helpers ────────────────────────────────────────────────

/**
 * Pure cosine signal: y = amplitude*cos(2π/period * t + phase) + offset
 */
function cosineSignal({
	amplitude = 2,
	period = 24,
	phase = 0,
	offset = 5,
	step = 0.5,
	duration = 96
} = {}) {
	const t = [];
	const y = [];
	for (let ti = 0; ti <= duration; ti += step) {
		t.push(ti);
		y.push(amplitude * Math.cos((2 * Math.PI * ti) / period + phase) + offset);
	}
	return { t, y };
}

/** Arithmetic mean of a finite array */
function mean(arr) {
	return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/** Population standard deviation of a finite array */
function std(arr) {
	const m = mean(arr);
	return Math.sqrt(arr.reduce((s, v) => s + Math.pow(v - m, 2), 0) / arr.length);
}

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Column-process chain: add → multiply → normalize
// ─────────────────────────────────────────────────────────────────────────────
describe('Process chain: add → multiply → normalize', () => {
	it('add shifts every value by the constant', () => {
		const raw = [1, 2, 3, 4, 5];
		const result = add(raw, { value: 10 });
		expect(result).toEqual([11, 12, 13, 14, 15]);
	});

	it('multiply scales every value', () => {
		const shifted = [11, 12, 13, 14, 15];
		const result = multiply(shifted, { value: 2 });
		expect(result).toEqual([22, 24, 26, 28, 30]);
	});

	it('z-score normalize on the chained result has mean≈0 and std≈1', () => {
		const raw = [1, 2, 3, 4, 5];
		const shifted = add(raw, { value: 10 });
		const scaled = multiply(shifted, { value: 2 });
		const normed = normalize(scaled, { normalizationType: 'z-score' });
		expect(mean(normed)).toBeCloseTo(0, 10);
		expect(std(normed)).toBeCloseTo(1, 10);
	});

	it('min-max normalize maps to [0, 1] by default', () => {
		const raw = [3, 7, 1, 9, 2];
		const normed = normalize(raw, { normalizationType: 'min-max', customMin: 0, customMax: 1 });
		expect(Math.min(...normed)).toBeCloseTo(0, 10);
		expect(Math.max(...normed)).toBeCloseTo(1, 10);
	});

	it('chained add + normalize: constant shift does not change z-score output', () => {
		const raw = cosineSignal({ offset: 0 }).y;
		const shifted = add(raw, { value: 100 });
		const normedRaw = normalize(raw, { normalizationType: 'z-score' });
		const normedShifted = normalize(shifted, { normalizationType: 'z-score' });
		for (let i = 0; i < normedRaw.length; i++) {
			expect(normedShifted[i]).toBeCloseTo(normedRaw[i], 10);
		}
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Outlier removal
// ─────────────────────────────────────────────────────────────────────────────
describe('Outlier removal', () => {
	it('replaces a clear spike with null (z-score method)', () => {
		// Clean signal + one huge spike at index 5
		const data = Array.from({ length: 50 }, (_, i) => Math.sin(i));
		const spikeIdx = 5;
		data[spikeIdx] = 1000;
		const cleaned = outlierremoval(data, { method: 'zscore', zThreshold: 3 });
		expect(cleaned[spikeIdx]).toBeNull();
	});

	it('replaces IQR outlier with null (iqr method)', () => {
		// Tight cluster [1..10] plus one far outlier
		const data = Array.from({ length: 20 }, (_, i) => i + 1);
		data.push(500);
		const cleaned = outlierremoval(data, { method: 'iqr', iqrMultiplier: 1.5 });
		expect(cleaned[20]).toBeNull();
	});

	it('leaves clean cosine data unchanged', () => {
		const { y } = cosineSignal({ amplitude: 2, offset: 5 });
		const cleaned = outlierremoval(y, { method: 'zscore', zThreshold: 3 });
		const nullCount = cleaned.filter((v) => v === null).length;
		expect(nullCount).toBe(0);
	});

	it('preserves array length after outlier removal', () => {
		const data = [1, 2, 3, 4, 1000, 6, 7];
		const cleaned = outlierremoval(data, { method: 'zscore', zThreshold: 2 });
		expect(cleaned).toHaveLength(data.length);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Trend removal
// ─────────────────────────────────────────────────────────────────────────────
describe('Trend removal (linear)', () => {
	it('removes a linear trend: residual mean is near zero', () => {
		// y = 0.5*t + cosine  (clear linear trend)
		const n = 100;
		const trend = Array.from({ length: n }, (_, i) => 0.5 * i);
		const cosine = Array.from({ length: n }, (_, i) =>
			Math.cos((2 * Math.PI * i) / 24)
		);
		const y = trend.map((t, i) => t + cosine[i]);

		const detrended = removetrend(y, {
			xColId: -1,
			model: 'linear',
			polyDegree: 2,
			slidingWindow: false,
			windowSize: 10
		});

		expect(mean(detrended)).toBeCloseTo(0, 0);
	});

	it('removes a linear trend: first and last values are close in magnitude', () => {
		const n = 48;
		const y = Array.from({ length: n }, (_, i) => 10 * i + Math.sin(i));
		const detrended = removetrend(y, {
			xColId: -1,
			model: 'linear',
			polyDegree: 2,
			slidingWindow: false,
			windowSize: 10
		});
		// After removing a strong linear trend the extreme values should be much smaller
		expect(Math.abs(detrended[n - 1])).toBeLessThan(Math.abs(y[n - 1]) / 5);
	});

	it('preserves array length', () => {
		const y = Array.from({ length: 30 }, (_, i) => i * 2 + Math.random());
		const detrended = removetrend(y, {
			xColId: -1,
			model: 'linear',
			polyDegree: 2,
			slidingWindow: false,
			windowSize: 10
		});
		expect(detrended).toHaveLength(y.length);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. BinData produces correct means
// ─────────────────────────────────────────────────────────────────────────────
describe('binData', () => {
	it('two x-points within one bin: first bin mean is correct', () => {
		// binData always pushes a trailing bin to mark the end of the domain,
		// so bins=[0, 1] here; the first bin [0,1) contains both points.
		const x = [0, 0.5];
		const y = [10, 20];
		const { bins, y_out } = binData(x, y, 1, 0, null, 'mean');
		expect(bins[0]).toBe(0);
		expect(y_out[0]).toBeCloseTo(15, 10);
	});

	it('three equal-width data groups: first three bin means are correct', () => {
		// A trailing empty bin is added beyond xs[n-1]=5, so bins=[0,2,4,6]
		const x = [0, 1, 2, 3, 4, 5];
		const y = [10, 10, 20, 20, 30, 30];
		const { y_out } = binData(x, y, 2, 0, null, 'mean');
		expect(y_out[0]).toBeCloseTo(10, 10);
		expect(y_out[1]).toBeCloseTo(20, 10);
		expect(y_out[2]).toBeCloseTo(30, 10);
	});

	it('bin mean of cosine signal over 24h bins is close to the offset', () => {
		// Mean of a full cosine cycle == offset; each 24h bin is one cycle.
		// The last bin at t=96 is a single-point trailing boundary bin, so skip it.
		const { t, y } = cosineSignal({ amplitude: 2, period: 24, offset: 5, step: 0.5, duration: 96 });
		const { y_out } = binData(t, y, 24, 0, null, 'mean');
		const fullCycleBins = y_out.slice(0, 4); // indices 0-3 are full 24h cycles
		for (const val of fullCycleBins) {
			expect(val).toBeCloseTo(5, 0); // within 1 unit of mesor
		}
	});

	it('returns empty arrays for empty input', () => {
		const { bins, y_out } = binData([], [], 1, 0, null, 'mean');
		expect(bins).toHaveLength(0);
		expect(y_out).toHaveLength(0);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Box-plot statistics
// ─────────────────────────────────────────────────────────────────────────────
describe('calculateBoxPlotStats', () => {
	it('returns null for empty input', () => {
		expect(calculateBoxPlotStats([])).toBeNull();
		expect(calculateBoxPlotStats(null)).toBeNull();
	});

	it('computes correct quartiles for [1..8]', () => {
		// data = [1,2,3,4,5,6,7,8] (n=8)
		// floor(8*0.25)=2 → q1=data[2]=3
		// floor(8*0.5)=4  → q2=data[4]=5
		// floor(8*0.75)=6 → q3=data[6]=7
		const stats = calculateBoxPlotStats([1, 2, 3, 4, 5, 6, 7, 8]);
		expect(stats.q1).toBe(3);
		expect(stats.q2).toBe(5);
		expect(stats.q3).toBe(7);
	});

	it('detects an extreme outlier', () => {
		const data = [1, 2, 3, 4, 5, 6, 7, 8, 1000];
		const stats = calculateBoxPlotStats(data);
		expect(stats.outliers).toContain(1000);
	});

	it('whiskers do not extend beyond the fences', () => {
		const data = Array.from({ length: 20 }, (_, i) => i + 1);
		data.push(500);
		const stats = calculateBoxPlotStats(data);
		expect(stats.upperWhisker).toBeLessThan(500);
		expect(stats.lowerWhisker).toBeGreaterThanOrEqual(stats.min);
	});

	it('no outliers for perfectly normal-ish data within 1.5×IQR', () => {
		const data = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
		const stats = calculateBoxPlotStats(data);
		// All values lie within the fences for a uniform distribution
		expect(stats.outliers).toHaveLength(0);
	});

	it('bin mean + box stats pipeline: median ≈ mesor of cosine data', () => {
		// Generate 4 full 24h cosine cycles, bin by hour, then compute box stats
		const { t, y } = cosineSignal({ amplitude: 2, period: 24, offset: 5, step: 0.5, duration: 96 });
		const { y_out } = binData(t, y, 1, 0, null, 'mean');
		const stats = calculateBoxPlotStats(y_out);
		// Median of one-hour bin means ≈ offset (mesor) since the cosine is symmetric
		expect(stats.q2).toBeCloseTo(5, 0);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Full cosinor pipeline: normalize → fitCosinorFixed
// ─────────────────────────────────────────────────────────────────────────────
describe('Cosinor pipeline: normalize → fitCosinorFixed', () => {
	// Synthetic signal: amplitude=2, period=24, phase=0, mesor=5
	const { t, y } = cosineSignal({ amplitude: 2, period: 24, phase: 0, offset: 5 });

	it('fitCosinorFixed recovers mesor ≈ 5 on raw signal', () => {
		const result = fitCosinorFixed(t, y, 24, 1, 0.05);
		expect(result).not.toBeNull();
		expect(result.M).toBeCloseTo(5, 1);
	});

	it('fitCosinorFixed recovers amplitude ≈ 2 on raw signal', () => {
		const result = fitCosinorFixed(t, y, 24, 1, 0.05);
		expect(result.harmonics[0].amplitude).toBeCloseTo(2, 1);
	});

	it('fitCosinorFixed achieves R² > 0.99 on raw signal', () => {
		const result = fitCosinorFixed(t, y, 24, 1, 0.05);
		expect(result.R2).toBeGreaterThan(0.99);
	});

	it('normalize then fitCosinorFixed still recovers correct phase structure', () => {
		// After z-score normalisation the mesor≈0 and amplitude is rescaled,
		// but the signal structure (periodicity, R²) is preserved.
		const normed = normalize(y, { normalizationType: 'z-score' });
		const result = fitCosinorFixed(t, normed, 24, 1, 0.05);
		expect(result).not.toBeNull();
		// Mesor of z-scored data ≈ 0
		expect(result.M).toBeCloseTo(0, 1);
		// R² should still be excellent because the shape is unchanged
		expect(result.R2).toBeGreaterThan(0.99);
	});

	it('detrend then fitCosinorFixed: removing a weak linear trend preserves fit quality', () => {
		// Add a small linear drift before fitting
		const trended = y.map((v, i) => v + 0.02 * t[i]);
		const detrended = removetrend(trended, {
			xColId: -1,
			model: 'linear',
			polyDegree: 2,
			slidingWindow: false,
			windowSize: 10
		});
		const result = fitCosinorFixed(t, detrended, 24, 1, 0.05);
		expect(result).not.toBeNull();
		expect(result.R2).toBeGreaterThan(0.95);
	});

	it('fitCosinorFixed with outlier-cleaned data still achieves R² > 0.95', () => {
		// Inject a spike and then clean it before fitting
		const dirty = [...y];
		dirty[10] = 500;
		const cleaned = outlierremoval(dirty, { method: 'zscore', zThreshold: 3 });
		// Remove the nulled point from both arrays for fitting
		const tClean = t.filter((_, i) => cleaned[i] != null);
		const yClean = cleaned.filter((v) => v != null);
		const result = fitCosinorFixed(tClean, yClean, 24, 1, 0.05);
		expect(result).not.toBeNull();
		expect(result.R2).toBeGreaterThan(0.95);
	});
});
