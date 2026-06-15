import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock binData — the Chi-squared and Enright methods use it.
// Lomb-Scargle never calls it.
vi.mock('$lib/components/plotbits/helpers/wrangleData.js', () => ({
	binData: vi.fn()
}));

import { runPeriodogramCalculation } from './periodogram.js';
import { binData } from '$lib/components/plotbits/helpers/wrangleData.js';

// A simple uniform binning stub: one bin per `binSize` step starting at the
// minimum time, averaging the y-values that fall in each bin.
function fakeBinData(times, values, binSize) {
	if (!times.length) return { bins: [], y_out: [] };
	const tMin = Math.min(...times);
	const tMax = Math.max(...times);
	const nBins = Math.max(1, Math.ceil((tMax - tMin) / binSize) + 1);
	const sums = new Array(nBins).fill(0);
	const counts = new Array(nBins).fill(0);
	for (let i = 0; i < times.length; i++) {
		const b = Math.min(nBins - 1, Math.floor((times[i] - tMin) / binSize));
		if (!isNaN(values[i])) {
			sums[b] += values[i];
			counts[b]++;
		}
	}
	const bins = [];
	const y_out = [];
	for (let b = 0; b < nBins; b++) {
		bins.push(tMin + b * binSize);
		y_out.push(counts[b] > 0 ? sums[b] / counts[b] : NaN);
	}
	return { bins, y_out };
}

// Helpers
function cosineTimeSeries(periodH, durationH, stepH) {
	const t = [];
	const y = [];
	for (let ti = 0; ti <= durationH; ti += stepH) {
		t.push(ti);
		y.push(Math.cos((2 * Math.PI * ti) / periodH));
	}
	return { t, y };
}

describe('runPeriodogramCalculation — Lomb-Scargle', () => {
	it('detects a pure 24-hour cosine signal', () => {
		const { t, y } = cosineTimeSeries(24, 96, 0.25);

		const result = runPeriodogramCalculation({
			method: 'Lomb-Scargle',
			xData: t,
			yData: y,
			periodMin: 18,
			periodMax: 30,
			periodSteps: 0.1
		});

		expect(result.x.length).toBeGreaterThan(0);

		// Find period with peak power
		const peakIdx = result.y.indexOf(Math.max(...result.y));
		const peakPeriod = result.x[peakIdx];

		expect(peakPeriod).toBeCloseTo(24, 0);
	});

	it('returns empty arrays when yData is null', () => {
		const result = runPeriodogramCalculation({
			method: 'Lomb-Scargle',
			xData: [0, 1, 2],
			yData: null,
			periodMin: 20,
			periodMax: 28,
			periodSteps: 1
		});
		expect(result.y).toEqual([]);
	});

	it('handles NaN values in the input gracefully', () => {
		const { t, y } = cosineTimeSeries(24, 96, 0.5);
		// Scatter some NaNs
		y[5] = NaN;
		y[20] = NaN;
		y[40] = NaN;

		const result = runPeriodogramCalculation({
			method: 'Lomb-Scargle',
			xData: t,
			yData: y,
			periodMin: 18,
			periodMax: 30,
			periodSteps: 0.5
		});

		// Should still return valid power values (no NaN in output)
		const hasNaN = result.y.some((v) => isNaN(v));
		expect(hasNaN).toBe(false);
	});

	it('returns x and y arrays of equal length', () => {
		const { t, y } = cosineTimeSeries(24, 48, 0.5);
		const result = runPeriodogramCalculation({
			method: 'Lomb-Scargle',
			xData: t,
			yData: y,
			periodMin: 20,
			periodMax: 28,
			periodSteps: 1
		});
		expect(result.x.length).toBe(result.y.length);
	});

	it('detects a 12-hour period when present', () => {
		const { t, y } = cosineTimeSeries(12, 96, 0.25);
		const result = runPeriodogramCalculation({
			method: 'Lomb-Scargle',
			xData: t,
			yData: y,
			periodMin: 8,
			periodMax: 16,
			periodSteps: 0.1
		});
		const peakIdx = result.y.indexOf(Math.max(...result.y));
		expect(result.x[peakIdx]).toBeCloseTo(12, 0);
	});

	// BUG: for Lomb-Scargle the `threshold` and `pvalue` arrays are never
	// populated (they stay full of `undefined`). The final NaN-removal step then
	// filters them down to length 0, so they come back misaligned with `x`/`y`
	// (which keep all 25 entries). A caller indexing `result.pvalue[peakIdx]`
	// for an LS run would read `undefined`. Expected: either compute thresholds/
	// p-values for LS, or return them as same-length arrays (e.g. filled NaN).
	it.todo('Lomb-Scargle should return threshold/pvalue aligned in length with x/y');

	it('a 24h signal does not peak at an unrelated 9h period', () => {
		const { t, y } = cosineTimeSeries(24, 96, 0.5);
		const result = runPeriodogramCalculation({
			method: 'Lomb-Scargle',
			xData: t,
			yData: y,
			periodMin: 18,
			periodMax: 30,
			periodSteps: 0.5
		});
		const peakIdx = result.y.indexOf(Math.max(...result.y));
		expect(result.x[peakIdx]).toBeGreaterThan(22);
		expect(result.x[peakIdx]).toBeLessThan(26);
	});
});

describe('runPeriodogramCalculation — Enright', () => {
	beforeEach(() => {
		binData.mockImplementation(fakeBinData);
	});

	it('detects a 24-hour period in a binned cosine', () => {
		const { t, y } = cosineTimeSeries(24, 24 * 10, 0.5);
		const result = runPeriodogramCalculation({
			method: 'Enright',
			xData: t,
			yData: y,
			binSize: 1,
			periodMin: 18,
			periodMax: 30,
			periodSteps: 0.5
		});
		expect(result.x.length).toBeGreaterThan(0);
		const peakIdx = result.y.indexOf(Math.max(...result.y));
		// Discrete binning (binSize 1h) quantises the period grid, so allow ±1h.
		expect(Math.abs(result.x[peakIdx] - 24)).toBeLessThanOrEqual(1);
	});

	it('returns NaN-free power values', () => {
		const { t, y } = cosineTimeSeries(24, 24 * 8, 0.5);
		const result = runPeriodogramCalculation({
			method: 'Enright',
			xData: t,
			yData: y,
			binSize: 1,
			periodMin: 20,
			periodMax: 28,
			periodSteps: 1
		});
		expect(result.y.some((v) => isNaN(v))).toBe(false);
	});
});

describe('runPeriodogramCalculation — Chi-squared', () => {
	beforeEach(() => {
		binData.mockImplementation(fakeBinData);
	});

	it('returns empty arrays when yData is missing', () => {
		const result = runPeriodogramCalculation({
			method: 'Chi-squared',
			xData: [0, 1, 2],
			yData: null,
			binSize: 1,
			periodMin: 20,
			periodMax: 28,
			periodSteps: 1
		});
		expect(result.y).toEqual([]);
	});

	it('strips NaN x values before binning and still produces output', () => {
		const { t, y } = cosineTimeSeries(24, 24 * 6, 0.5);
		// Inject a NaN x at the end (the regression this guards against).
		t.push(NaN);
		y.push(1);
		const result = runPeriodogramCalculation({
			method: 'Chi-squared',
			xData: t,
			yData: y,
			binSize: 1,
			periodMin: 20,
			periodMax: 28,
			periodSteps: 1,
			chiSquaredAlpha: 0.05
		});
		expect(result.x.length).toBeGreaterThan(0);
		// thresholds are quantiles → finite positive numbers
		expect(result.threshold.every((v) => Number.isFinite(v))).toBe(true);
	});

	it('peaks at 24h for a 24h cosine and reports a low p-value there', () => {
		const { t, y } = cosineTimeSeries(24, 24 * 10, 0.5);
		const result = runPeriodogramCalculation({
			method: 'Chi-squared',
			xData: t,
			yData: y,
			binSize: 1,
			periodMin: 18,
			periodMax: 30,
			periodSteps: 0.5,
			chiSquaredAlpha: 0.05
		});
		const peakIdx = result.y.indexOf(Math.max(...result.y));
		// Discrete binning (binSize 1h) quantises the period grid, so allow ±1h.
		expect(Math.abs(result.x[peakIdx] - 24)).toBeLessThanOrEqual(1);
		// p-value at the peak should be small (significant rhythm).
		expect(result.pvalue[peakIdx]).toBeLessThan(0.05);
	});
});
