import { describe, it, expect } from 'vitest';
import { runPeriodogramCalculation } from './periodogram.js';
import { periodogramPeakIndex, peakFamilywiseP } from './periodogramPeak.js';
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
