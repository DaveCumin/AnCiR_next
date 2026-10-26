import { describe, it, expect } from 'vitest';
import { runPeriodogramCalculation } from './periodogram.js';
import {
	periodogramPeakIndex,
	peakFamilywiseP,
	lombScargleFamilywiseP
} from './periodogramPeak.js';
import { spectralPeakIndex } from '$lib/components/plotbits/helpers/peakFinder.js';

// SPEC-9: the chi-squared (Sokolove-Bushell Qp) periodogram's peak was the LARGEST Qp. Qp is
// approximately chi-square on df = bins per period - 1, so both its noise level and its
// threshold rise with the period, and with a weak rhythm the largest raw Qp drifted to the
// longest trial periods (and to the 2x subharmonic of a 24 h rhythm). The peak is now the
// period with the largest Qp - threshold (periodogramPeakIndex), shared by the plot,
// RhythmicityAnalysis, MovingAnalysis and the Python/R ports.

// mulberry32, the seeded generator the parity fixtures use.
function mulberry32(seed) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let v = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v;
		return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
	};
}
function normal(rng) {
	const u = Math.max(rng(), 1e-12);
	const v = rng();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// 10 days at 6 min sampling, a 24 h sinusoid of amplitude `amp` (in noise SDs) plus N(0, 1).
function run(seed, amp, periodMin, periodMax) {
	const rng = mulberry32(seed);
	const t = Array.from({ length: 2400 }, (_, i) => i * 0.1);
	const y = t.map((tt) => amp * Math.sin((2 * Math.PI * tt) / 24) + normal(rng));
	return runPeriodogramCalculation({
		method: 'Chi-squared',
		xData: t,
		yData: y,
		binSize: 0.25,
		periodMin,
		periodMax,
		periodSteps: 0.1,
		chiSquaredAlpha: 0.05
	});
}

const SEEDS = [1, 2, 3, 4, 5];

describe('chi-squared peak = largest Qp - threshold (SPEC-9)', () => {
	it('a weak 24 h rhythm scanned 16-48 h: raw Qp drifts to ~48 h, the excess finds 24 h', () => {
		for (const seed of SEEDS) {
			const r = run(seed, 0.3, 16, 48);
			const oldIdx = spectralPeakIndex(r.y);
			const newIdx = periodogramPeakIndex(r);
			// The drift the old rule had: the longest periods win on raw Qp.
			expect(r.x[oldIdx]).toBeGreaterThan(45);
			expect(Math.abs(r.x[newIdx] - 24)).toBeLessThanOrEqual(1);
			// And it is a real rhythm: the chosen peak is family-wise significant.
			expect(peakFamilywiseP(r, newIdx)).toBeLessThan(0.05);
		}
	});

	it('a strong 24 h rhythm on 18-30 h (no subharmonic in range) is unchanged', () => {
		for (const seed of SEEDS) {
			const r = run(seed, 1, 18, 30);
			expect(periodogramPeakIndex(r)).toBe(spectralPeakIndex(r.y));
			expect(r.x[periodogramPeakIndex(r)]).toBe(24);
		}
	});

	it('a strong 24 h rhythm scanned 16-48 h no longer reports the 48 h subharmonic', () => {
		for (const seed of SEEDS) {
			const r = run(seed, 1, 16, 48);
			expect(r.x[spectralPeakIndex(r.y)]).toBeGreaterThan(47);
			expect(r.x[periodogramPeakIndex(r)]).toBe(24);
		}
	});

	it('when nothing crosses the line the peak is still reported, flagged by its family-wise p', () => {
		// amp 0.15, seed 1: the best excess is negative (no period crosses its threshold).
		const r = run(1, 0.15, 18, 30);
		const idx = periodogramPeakIndex(r);
		expect(idx).toBeGreaterThanOrEqual(0);
		expect(r.y[idx] - r.threshold[idx]).toBeLessThan(0);
		expect(peakFamilywiseP(r, idx)).toBeGreaterThanOrEqual(0.05);
	});

	it('the family-wise p is below alpha exactly when the chosen peak crosses its threshold', () => {
		for (const amp of [0.1, 0.15, 0.2, 0.3]) {
			for (const seed of SEEDS) {
				const r = run(seed, amp, 18, 30);
				const idx = periodogramPeakIndex(r);
				const crosses = r.y[idx] > r.threshold[idx];
				expect(peakFamilywiseP(r, idx) < 0.05).toBe(crosses);
			}
		}
	});

	it('restricts to candidate indices (the visible range)', () => {
		const r = run(1, 1, 16, 48);
		const vis = [];
		for (let i = 0; i < r.x.length; i++) if (r.x[i] >= 30) vis.push(i);
		const idx = periodogramPeakIndex(r, vis);
		expect(vis).toContain(idx);
		let best = vis[0];
		for (const i of vis) if (r.y[i] - r.threshold[i] > r.y[best] - r.threshold[best]) best = i;
		expect(idx).toBe(best);
	});

	it('without a threshold (Lomb-Scargle, Enright) it is the largest power, as before', () => {
		const res = { x: [1, 2, 3], y: [1, 5, 2], threshold: [NaN, NaN, NaN] };
		expect(periodogramPeakIndex(res)).toBe(1);
		expect(periodogramPeakIndex({ x: [1, 2], y: [3, 4] })).toBe(1);
	});

	it('flat data (zero power everywhere) has no peak (ROB-13)', () => {
		expect(periodogramPeakIndex({ y: [0, 0, 0], threshold: [5, 6, 7] })).toBe(-1);
		expect(periodogramPeakIndex({ y: [0, 0], threshold: [NaN, NaN] })).toBe(-1);
		expect(periodogramPeakIndex({ y: [] })).toBe(-1);
	});
});

// The Lomb-Scargle peak's family-wise p: Baluev's (2008, MNRAS 385:1279) false-alarm
// probability of the highest peak in the band, the "alias-free" bound astropy computes with
// LombScargle(t, y, fit_mean=False, center_data=True, normalization='standard')
// .false_alarm_probability(z, method='baluev'), here called as
// astropy.timeseries.periodograms.lombscargle._statistics.fap_baluev(z, fmax, t, y, None) with
// fmax = 1/16 exactly (the method snaps a maximum_frequency onto its own grid first). The app's power is the
// Horne and Baliunas (1986) normalisation P = z (N - 1) / 2. Reference values from astropy
// 8.0.1 on 300 uneven times over 10 days (variance 4801.5533588017315 h^2), band 16-32 h.
describe('Lomb-Scargle family-wise peak p (Baluev 2008)', () => {
	const T_VAR = 4801.5533588017315;
	const ASTROPY = [
		[2.963809828698259, 0.756779021401499],
		[8.29199568843595, 0.0096396781673619],
		[53.46944660187652, 3.998835363596621e-27]
	];
	it.each(ASTROPY)('power %d matches astropy', (power, fap) => {
		const p = lombScargleFamilywiseP(power, 300, T_VAR, 1 / 16);
		expect(p / fap).toBeCloseTo(1, 10);
	});

	it('is NaN without enough points or a time spread, and 1 for zero power', () => {
		expect(lombScargleFamilywiseP(3, 3, T_VAR, 1 / 16)).toBeNaN();
		expect(lombScargleFamilywiseP(3, 300, 0, 1 / 16)).toBeNaN();
		expect(lombScargleFamilywiseP(0, 300, T_VAR, 1 / 16)).toBe(1);
	});

	it('peakFamilywiseP reads it from a Lomb-Scargle result, over the band searched', () => {
		const rng = mulberry32(31);
		const t = [];
		const y = [];
		for (let i = 0; i < 240; i++) {
			t.push(i + 0.5 * rng());
			y.push(0.5 * Math.cos((2 * Math.PI * t[i]) / 24) + normal(rng));
		}
		const res = runPeriodogramCalculation({
			method: 'Lomb-Scargle',
			xData: t,
			yData: y,
			periodMin: 16,
			periodMax: 32,
			periodSteps: 0.1
		});
		expect(res.nObs).toBe(240);
		const mean = t.reduce((s, v) => s + v, 0) / t.length;
		expect(res.timeVar).toBeCloseTo(t.reduce((s, v) => s + (v - mean) ** 2, 0) / t.length, 9);
		const idx = periodogramPeakIndex(res);
		const p = peakFamilywiseP(res, idx);
		expect(p).toBeCloseTo(lombScargleFamilywiseP(res.y[idx], 240, res.timeVar, 1 / 16), 14);
		// A narrower search band (the visible range, from 20 h) has a lower fmax, 1/20: a smaller
		// family of frequencies, so a smaller p for the same power.
		const visible = res.x.map((v, i) => (v >= 20 ? i : -1)).filter((i) => i >= 0);
		const vIdx = periodogramPeakIndex(res, visible);
		expect(peakFamilywiseP(res, vIdx, visible)).toBeCloseTo(
			lombScargleFamilywiseP(res.y[vIdx], 240, res.timeVar, 1 / 20),
			14
		);
	});

	it('controls the false alarm rate on white noise (at most about alpha)', () => {
		let hits = 0;
		const trials = 200;
		for (let s = 0; s < trials; s++) {
			const rng = mulberry32(1000 + s);
			const t = [];
			const y = [];
			for (let i = 0; i < 120; i++) {
				t.push(i * 2 + rng());
				y.push(normal(rng));
			}
			const res = runPeriodogramCalculation({
				method: 'Lomb-Scargle',
				xData: t,
				yData: y,
				periodMin: 16,
				periodMax: 32,
				periodSteps: 0.25
			});
			if (peakFamilywiseP(res, periodogramPeakIndex(res)) < 0.05) hits++;
		}
		// Baluev's bound is conservative (an upper bound on the FAP), so the rate sits at or
		// below 5%; 200 records leave room for sampling error (binomial SD 1.5%).
		expect(hits / trials).toBeLessThanOrEqual(0.08);
	});

	it('chi-squared and Enright are unchanged (Enright has no p)', () => {
		const res = { x: [20, 24], y: [1, 2], threshold: [NaN, NaN], pvalue: [NaN, NaN] };
		expect(peakFamilywiseP(res, 1)).toBeNaN();
	});
});
