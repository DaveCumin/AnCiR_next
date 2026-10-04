// ROB-13: degenerate inputs to the spectral analyses.
//   - Constant or all-zero data has no rhythm, but the periodogram and FFT reported one: the
//     argmax started at index 0 (or -Infinity), so a flat spectrum gave period = periodMin
//     (MovingAnalysis reported 18 h on off-wrist windows). Worse, a constant like 0.1 leaves a
//     rounding-error residue after the mean is removed, which Chi-squared and Enright then
//     normalised by an equally tiny variance into a "significant" Qp.
//   - Chi-squared and Enright binned from t = 0, so a record starting at -120 h lost every
//     sample before 0 (Qp 238 instead of 477), and Unix-second times (~1.7e8) built hundreds of
//     millions of empty bins: seconds of stall at ~1 GB, then a RangeError.
// SPEC-14: the per-period chi-squared p-value was 1 - CDF, which underflows to 0.
//
// Real binning (no wrangleData mock), unlike periodogram.test.js.
import { describe, it, expect } from 'vitest';
import { runPeriodogramCalculation, isFlatSeries } from './periodogram.js';
import { computeFFT, fftPeak } from './fft.js';
import { computeMovingWindows, getStatKeys } from './movinganalysis.js';
import { chisqSf } from './chisqSf.js';
import { spectralPeakIndex } from '$lib/components/plotbits/helpers/peakFinder.js';

const METHODS = ['Lomb-Scargle', 'Chi-squared', 'Enright'];
const tAll = Array.from({ length: 480 }, (_, i) => i * 0.5);

function params(method, x, y, extra = {}) {
	return {
		method,
		xData: x,
		yData: y,
		periodMin: 18,
		periodMax: 30,
		periodSteps: 0.5,
		binSize: 0.5,
		chiSquaredAlpha: 0.05,
		...extra
	};
}

// A deterministic, rhythmic series indexed by SAMPLE, so shifting the time origin by a whole
// number of bins must not change any binned statistic.
const yIdx = tAll.map((_, i) => 10 + 5 * Math.cos((2 * Math.PI * i * 0.5) / 24) + ((i * 7) % 3));

describe('flat data has no peak (ROB-13)', () => {
	for (const [label, value] of [
		['all zero', 0],
		['constant 7', 7],
		// 0.1 is not representable: the mean differs from every sample by one rounding error.
		['constant 0.1', 0.1],
		['constant 123.456', 123.456],
		['constant 2.3', 2.3]
	]) {
		const y = tAll.map(() => value);
		for (const method of METHODS) {
			it(`${method}, ${label}: zero power everywhere and no peak index`, () => {
				const r = runPeriodogramCalculation(params(method, tAll, y));
				expect(r.y.length).toBeGreaterThan(0);
				for (const v of r.y) expect(v).toBe(0);
				expect(spectralPeakIndex(r.y)).toBe(-1);
			});
		}
		it(`Chi-squared, ${label}: p = 1 at every period, and the threshold is still drawn`, () => {
			const r = runPeriodogramCalculation(params('Chi-squared', tAll, y));
			for (const p of r.pvalue) expect(p).toBe(1);
			for (const th of r.threshold) expect(th).toBeGreaterThan(0);
		});
		it(`FFT, ${label}: no peak`, () => {
			const spec = computeFFT(tAll, y);
			expect(fftPeak(spec)).toBeNull();
		});
		for (const pgMethod of METHODS) {
			it(`MovingAnalysis periodogram (${pgMethod}), ${label}: NaN peak, not periodMin`, () => {
				const args = {
					analysis: 'periodogram',
					pgMethod,
					periodMin: 18,
					periodMax: 30,
					periodStep: 0.5,
					pgBinSize: 0.5
				};
				const out = computeMovingWindows({
					tAll,
					ys: [y],
					starts: [0],
					windowSize: 240,
					statKeys: getStatKeys(args),
					args
				});
				expect(out[0].peak_period[0]).toBeNaN();
				expect(out[0].peak_power[0]).toBeNaN();
			});
		}
		it(`MovingAnalysis FFT, ${label}: NaN peak, and no throw`, () => {
			const args = { analysis: 'fft' };
			const out = computeMovingWindows({
				tAll,
				ys: [y],
				starts: [0],
				windowSize: 240,
				statKeys: getStatKeys(args),
				args
			});
			expect(out[0].peak_period[0]).toBeNaN();
		});
	}

	it('a real rhythm is not mistaken for flat data', () => {
		expect(isFlatSeries(yIdx)).toBe(false);
		expect(isFlatSeries([5, 5, 5.000000001])).toBe(false);
		expect(isFlatSeries([0.1, 0.1, 0.1])).toBe(true);
		expect(isFlatSeries([3, null, 3, '', 3])).toBe(true);
		for (const method of METHODS) {
			const r = runPeriodogramCalculation(params(method, tAll, yIdx));
			const i = spectralPeakIndex(r.y);
			expect(i).toBeGreaterThanOrEqual(0);
			expect(r.x[i]).toBeCloseTo(24, 0);
		}
		expect(fftPeak(computeFFT(tAll, yIdx)).period).toBeCloseTo(24, 0);
	});
});

describe('binned methods bin from the first sample, not from t = 0 (ROB-13)', () => {
	const base = (method) => runPeriodogramCalculation(params(method, tAll, yIdx));
	for (const method of ['Chi-squared', 'Enright']) {
		// Whole-bin offsets. (An offset off the bin grid, e.g. -0.25 h, moves a trailing empty
		// bin into or out of the record; Chi-squared ignores empty bins, Enright still counts
		// them as zero-deviation pairs, a separate pre-existing issue.)
		for (const off of method === 'Chi-squared'
			? [-120, -239.5, 1000, -0.25]
			: [-120, -239.5, 1000]) {
			it(`${method}: a time origin of ${off} h gives the same spectrum as 0 h`, () => {
				const b = base(method);
				const r = runPeriodogramCalculation(
					params(
						method,
						tAll.map((t) => t + off),
						yIdx
					)
				);
				expect(r.x).toEqual(b.x);
				for (let i = 0; i < b.y.length; i++) expect(r.y[i]).toBeCloseTo(b.y[i], 9);
			});
		}
		it(`${method}: Unix-second-sized times finish quickly and match`, () => {
			const t0 = performance.now();
			const r = runPeriodogramCalculation(
				params(
					method,
					tAll.map((t) => t + 1.7e8),
					yIdx
				)
			);
			expect(performance.now() - t0).toBeLessThan(1000);
			const b = base(method);
			expect(r.x).toEqual(b.x);
			for (let i = 0; i < b.y.length; i++) expect(r.y[i]).toBeCloseTo(b.y[i], 6);
		});
	}
	it('Chi-squared keeps every sample of a record that starts before 0', () => {
		// The review's numbers: the full record peaks near Qp 477; dropping t < 0 gave ~238.
		const b = base('Chi-squared');
		const r = runPeriodogramCalculation(
			params(
				'Chi-squared',
				tAll.map((t) => t - 120),
				yIdx
			)
		);
		expect(Math.max(...r.y)).toBeCloseTo(Math.max(...b.y), 9);
	});
});

describe('per-period chi-squared p is the upper tail, not 1 - CDF (SPEC-14)', () => {
	it('a strong rhythm keeps a tiny but non-zero p, equal to chi2.sf(Qp, df)', () => {
		const strong = tAll.map((t) => 100 * Math.cos((2 * Math.PI * t) / 24));
		const r = runPeriodogramCalculation(params('Chi-squared', tAll, strong));
		const i = spectralPeakIndex(r.y);
		expect(r.pvalue[i]).toBeGreaterThan(0);
		expect(r.pvalue[i]).toBeLessThan(1e-20);
		for (let k = 0; k < r.y.length; k++) {
			expect(r.pvalue[k]).toBe(chisqSf(r.y[k], r.df[k]));
		}
	});
});
