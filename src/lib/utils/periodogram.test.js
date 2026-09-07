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

	// Regression: for Lomb-Scargle the `threshold`/`pvalue` arrays used to stay
	// full of `undefined`, then the NaN-removal step filtered them to length 0 —
	// misaligned with `x`/`y`. They are now filled with NaN so they stay numeric
	// and index-aligned; a caller reading pvalue[peakIdx] gets NaN, not undefined.
	it('returns threshold/pvalue aligned in length with x/y (filled NaN)', () => {
		const { t, y } = cosineTimeSeries(24, 96, 0.25);
		const result = runPeriodogramCalculation({
			method: 'Lomb-Scargle',
			xData: t,
			yData: y,
			periodMin: 18,
			periodMax: 30,
			periodSteps: 0.1
		});
		expect(result.threshold.length).toBe(result.x.length);
		expect(result.pvalue.length).toBe(result.x.length);
		expect(result.threshold.every((v) => Number.isNaN(v))).toBe(true);
		expect(result.pvalue.every((v) => Number.isNaN(v))).toBe(true);
	});

	it('returns finite (non-Infinity) power for a flat/zero-variance series', () => {
		const t = Array.from({ length: 96 }, (_, i) => i * 0.25);
		const yFlat = t.map(() => 7); // constant → zero variance
		const result = runPeriodogramCalculation({
			method: 'Lomb-Scargle',
			xData: t,
			yData: yFlat,
			periodMin: 18,
			periodMax: 30,
			periodSteps: 0.5
		});
		expect(result.y.length).toBe(result.x.length);
		expect(result.y.every((v) => Number.isFinite(v))).toBe(true);
		expect(result.y.every((v) => v === 0)).toBe(true);
	});

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

	it('does not throw (RangeError) for a tiny binSize that would demand a huge colNum', () => {
		// A vanishingly small bin size makes colNum = round(period / binSize)
		// astronomically large; without the guard, Array.from({ length: colNum })
		// throws "RangeError: Invalid array length". Fixed binned result so the
		// stub itself doesn't choke on the tiny binSize.
		binData.mockReturnValue({ bins: [0, 1, 2, 3], y_out: [1, 2, 3, 4], droppedCount: 0 });
		expect(() =>
			runPeriodogramCalculation({
				method: 'Chi-squared',
				xData: [0, 1, 2, 3],
				yData: [1, 2, 3, 4],
				binSize: 1e-9,
				periodMin: 20,
				periodMax: 28,
				periodSteps: 4,
				chiSquaredAlpha: 0.05
			})
		).not.toThrow();
	});

	// The drawn significance line must be the Sidak-corrected UPPER chi-square
	// quantile. It used to be computed as quantile(1 - correctedAlpha, df) — the
	// LOWER tail — which for alpha 0.05 over a 25-period grid at df 23 gives 8.24
	// instead of 47.31. Since noise-level Qp averages about df, the drawn line sat
	// BELOW the noise floor and nearly every period looked significant.
	// Reference values pinned against scipy.stats.chi2.ppf((1-0.05)**(1/25), df).
	it('draws the Sidak-corrected upper-tail chi-square quantile as the threshold', () => {
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
		// Grid is 18..30 step 0.5 → M = 25 trial periods; df = round(P/binSize) - 1.
		const pinned = [
			[18, 38.571630187617615],
			[24, 47.30749996546788],
			[30, 55.7022178391594]
		];
		for (const [period, expected] of pinned) {
			const idx = result.x.findIndex((x) => Math.abs(x - period) < 1e-9);
			expect(idx).toBeGreaterThanOrEqual(0);
			expect(result.threshold[idx]).toBeCloseTo(expected, 6);
		}
	});

	it('keeps the threshold above the noise floor for pure noise', () => {
		// Deterministic pseudo-noise (mulberry32, the seeded generator the parity
		// fixtures use) — no rhythm, so nothing should look significant.
		let seed = 12345;
		const rng = () => {
			seed |= 0;
			seed = (seed + 0x6d2b79f5) | 0;
			let v = Math.imul(seed ^ (seed >>> 15), 1 | seed);
			v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v;
			return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
		};
		const t = Array.from({ length: 336 }, (_, i) => i);
		const y = t.map(() => rng());
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
		// Under the null, Qp ~ chi-square(df) whose mean is df, so the Sidak
		// upper quantile must sit ABOVE the mean noise power at every period.
		const meanPower = result.y.reduce((a, b) => a + b, 0) / result.y.length;
		for (const thr of result.threshold) {
			expect(thr).toBeGreaterThan(meanPower * 0.9);
		}
		// And essentially nothing in a pure-noise record should cross the line.
		const nAbove = result.y.filter((v, i) => v > result.threshold[i]).length;
		expect(nAbove / result.y.length).toBeLessThan(0.1);
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
