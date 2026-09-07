import { describe, it, expect } from 'vitest';
import { runPeriodogramCalculation } from './periodogram.js';

// Chi-squared (Sokolove-Bushell) periodogram CALIBRATION tests, run through the
// REAL binData pipeline (periodogram.test.js mocks binData; a synthetic stub
// cannot catch an empty-bin miscount — the exact green-suite blindness that let
// this bug ship). The acceptance property: for pure noise, E[Qp] ≈ df at ANY
// binSize, including binSize SMALLER than the sampling interval, where most
// bins are empty. Before the occupancy-weighted fix, 0.25 h bins on hourly
// noise gave mean Qp ≈ 237 against a nominal df of 95 (2.5x inflated, and
// worse on other grids), so noise dwarfed even the corrected threshold.

// mulberry32 — the seeded generator the parity fixtures use.
function mulberry32(seed) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let v = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v;
		return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
	};
}

function normal(rng, mean = 0, sd = 1) {
	const u = Math.max(rng(), 1e-12);
	const v = rng();
	return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const GRID = { periodMin: 18, periodMax: 30, periodSteps: 0.5, chiSquaredAlpha: 0.05 };

function noiseRun(seed, binSize) {
	const rng = mulberry32(seed);
	const t = Array.from({ length: 336 }, (_, i) => i); // hourly, 14 days
	const y = t.map(() => normal(rng, 0, 1));
	return runPeriodogramCalculation({ method: 'Chi-squared', xData: t, yData: y, binSize, ...GRID });
}

describe('chi-squared periodogram calibration (E[Qp] ≈ df at any binSize)', () => {
	// The core property. Under the no-rhythm null Qp ~ chi-square(df) whose mean
	// IS df, so the grid-mean of Qp/df must sit near 1 for every binSize —
	// including 0.25 h and 0.5 h bins on hourly data, where 3/4 (resp. 1/2) of
	// the bins are permanently empty. Averaged over 5 seeds to keep the
	// tolerance honest. Fails against the pre-fix code at 0.25/0.5 (ratios
	// 2.5-4x); binSize 1 was already calibrated and must stay so.
	it.each([[0.25], [0.5], [1.0]])('mean Qp/df ≈ 1 for pure noise at binSize %s h', (binSize) => {
		const seeds = [12345, 777, 2026, 424242, 9090];
		let ratioSum = 0;
		let nRatios = 0;
		for (const seed of seeds) {
			const res = noiseRun(seed, binSize);
			expect(res.y.length).toBeGreaterThan(0);
			for (let i = 0; i < res.y.length; i++) {
				expect(res.df[i]).toBeGreaterThanOrEqual(1);
				ratioSum += res.y[i] / res.df[i];
				nRatios++;
			}
		}
		const meanRatio = ratioSum / nRatios;
		expect(meanRatio).toBeGreaterThan(0.85);
		expect(meanRatio).toBeLessThan(1.15);
	});

	it('lets essentially no pure-noise period cross the Sidak threshold, even at 0.25 h bins', () => {
		for (const binSize of [0.25, 1.0]) {
			let above = 0;
			let total = 0;
			for (const seed of [12345, 777, 2026]) {
				const res = noiseRun(seed, binSize);
				above += res.y.filter((v, i) => v > res.threshold[i]).length;
				total += res.y.length;
			}
			expect(above / total).toBeLessThan(0.05);
		}
	});

	// df must count only OCCUPIED fold columns: hourly data folded at 24 h has
	// 24 occupied columns whatever the binSize, so df = 23 — not the nominal
	// round(24 / 0.25) - 1 = 95 of the empty-bin-counting code.
	it('reports the effective df (occupied columns - 1), not the nominal bin count', () => {
		const res = noiseRun(12345, 0.25);
		const i24 = res.x.findIndex((p) => Math.abs(p - 24) < 1e-9);
		expect(res.df[i24]).toBe(23);
	});

	// Empty bins carry no information, so at a trial period where the fold
	// aligns with the sampling grid the sub-sampling binSize must reproduce the
	// matched binSize EXACTLY — statistic, df, threshold and p-value together.
	// The threshold value is pinned against scipy:
	// scipy.stats.chi2.ppf((1 - 0.05) ** (1 / 25), 23) = 47.30749996546788
	// (25 trial periods on the 18..30 x 0.5 grid).
	it('matches the binSize-1 result exactly at period 24 with 0.25 h bins (scipy-pinned threshold)', () => {
		const fine = noiseRun(12345, 0.25);
		const coarse = noiseRun(12345, 1.0);
		const iF = fine.x.findIndex((p) => Math.abs(p - 24) < 1e-9);
		const iC = coarse.x.findIndex((p) => Math.abs(p - 24) < 1e-9);
		expect(fine.y[iF]).toBeCloseTo(coarse.y[iC], 9);
		expect(fine.df[iF]).toBe(coarse.df[iC]);
		expect(fine.threshold[iF]).toBeCloseTo(47.30749996546788, 6);
		expect(coarse.threshold[iC]).toBeCloseTo(47.30749996546788, 6);
		expect(fine.pvalue[iF]).toBeCloseTo(coarse.pvalue[iC], 9);
	});

	// Statistic, threshold and p-value must key off the SAME df: crossing the
	// drawn line and clearing the Sidak-corrected p cut are the same event.
	it('keeps power/threshold/p-value mutually consistent at every period', () => {
		const pCut = 1 - Math.pow(1 - 0.05, 1 / 25); // per-period Sidak alpha, M = 25
		for (const binSize of [0.25, 1.0]) {
			const res = noiseRun(777, binSize);
			for (let i = 0; i < res.y.length; i++) {
				expect(res.y[i] > res.threshold[i]).toBe(res.pvalue[i] < pCut);
			}
		}
	});

	it('still detects a real 24 h rhythm at 0.25 h bins on hourly data', () => {
		const rng = mulberry32(907);
		const t = Array.from({ length: 336 }, (_, i) => i);
		const y = t.map((h) => 45 + 30 * Math.cos((2 * Math.PI * (h - 6)) / 24) + normal(rng, 0, 8));
		const res = runPeriodogramCalculation({
			method: 'Chi-squared',
			xData: t,
			yData: y,
			binSize: 0.25,
			...GRID
		});
		const peakIdx = res.y.indexOf(Math.max(...res.y));
		expect(Math.abs(res.x[peakIdx] - 24)).toBeLessThanOrEqual(0.5);
		expect(res.y[peakIdx]).toBeGreaterThan(res.threshold[peakIdx]);
		expect(res.pvalue[peakIdx]).toBeLessThan(0.001);
	});
});
