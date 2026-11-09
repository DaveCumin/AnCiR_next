// Sample times that sit exactly on bin edges, written rounded (10-min data stored as
// t_h = 24.1667, 24.3333, ... with a 1/6 h bin). Before the fix, the bins started on the
// binSize grid, so every sample lay on a bin edge and rounding put some bins with two
// samples and others with none. The Chi-squared (Sokolove-Bushell) spectrum then
// saw-toothed (every third fold had fewer effective columns, so its threshold was ~30%
// lower) and the peak could land hours away from the true period.
import { describe, it, expect } from 'vitest';
import { binData } from '$lib/components/plotbits/helpers/wrangleData.js';
import { binOrigin, runPeriodogramCalculation } from './periodogram.js';

const BIN = 1 / 6;

/** Deterministic pseudo-random noise (mulberry32). */
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** 10-min samples from 24 h 10 min for `days`, times rounded to 4 decimals. */
function roundedTenMinuteSeries(days = 7, period = 24, seed = 1) {
	const r = rng(seed);
	const t = [];
	const y = [];
	for (let k = 145; k < 145 + days * 144; k++) {
		const exact = k / 6;
		t.push(Math.round(exact * 1e4) / 1e4);
		y.push(10 + 5 * Math.cos((2 * Math.PI * exact) / period) + 3 * (r() - 0.5));
	}
	return { t, y };
}

describe('binned periodogram with samples on bin edges', () => {
	it('puts exactly one sample in every bin', () => {
		const { t, y } = roundedTenMinuteSeries();
		const binned = binData(t, y, BIN, binOrigin(t, BIN), null, 'count');
		const counts = binned.y_out.filter((c) => Number.isFinite(c));
		expect(counts.filter((c) => c > 0).length).toBe(t.length);
		expect(new Set(counts.filter((c) => c > 0))).toEqual(new Set([1]));
	});

	it('keeps each sample in the middle of its bin, not on an edge', () => {
		const { t } = roundedTenMinuteSeries();
		const o = binOrigin(t, BIN);
		for (const x of t) {
			const frac = (x - o) / BIN - Math.floor((x - o) / BIN);
			expect(frac).toBeGreaterThan(0.4);
			expect(frac).toBeLessThan(0.6);
		}
	});

	it('Chi-squared spectrum has no fold-to-fold saw-tooth in its threshold', () => {
		const { t, y } = roundedTenMinuteSeries();
		const res = runPeriodogramCalculation({
			method: 'Chi-squared',
			xData: t,
			yData: y,
			binSize: BIN,
			periodMin: 20,
			periodMax: 28,
			periodSteps: BIN,
			chiSquaredAlpha: 0.05
		});
		// Every fold of n bins has n non-empty columns, so df = n - 1 exactly.
		for (let i = 0; i < res.x.length; i++) {
			expect(res.df[i]).toBe(Math.round(res.x[i] / BIN) - 1);
		}
		// The threshold rises monotonically with df (no every-third-fold dip).
		for (let i = 1; i < res.threshold.length; i++) {
			expect(res.threshold[i]).toBeGreaterThan(res.threshold[i - 1]);
		}
		const peak = res.x[res.y.indexOf(Math.max(...res.y))];
		expect(Math.abs(peak - 24)).toBeLessThanOrEqual(BIN + 1e-9);
	});

	it('Enright peaks at the true period on the same data', () => {
		const { t, y } = roundedTenMinuteSeries();
		const res = runPeriodogramCalculation({
			method: 'Enright',
			xData: t,
			yData: y,
			binSize: BIN,
			periodMin: 20,
			periodMax: 28,
			periodSteps: BIN
		});
		const peak = res.x[res.y.indexOf(Math.max(...res.y))];
		expect(Math.abs(peak - 24)).toBeLessThanOrEqual(BIN + 1e-9);
	});

	it('gives the same binned values whether times are rounded or exact', () => {
		const { t, y } = roundedTenMinuteSeries();
		const exact = t.map((_, i) => (145 + i) / 6);
		const a = binData(t, y, BIN, binOrigin(t, BIN)).y_out.filter(Number.isFinite);
		const b = binData(exact, y, BIN, binOrigin(exact, BIN)).y_out.filter(Number.isFinite);
		expect(a).toEqual(b);
		expect(a.length).toBe(y.length);
	});

	it('one-minute data rounded to 4 dp, binned at 1 min and at 20 min: no bin is doubled or emptied', () => {
		const t = [];
		const y = [];
		for (let k = 0; k < 3 * 1440; k++) {
			t.push(Math.round((k / 60) * 1e4) / 1e4);
			y.push(k);
		}
		for (const bin of [1 / 60, 1 / 3]) {
			const counts = binData(t, y, bin, binOrigin(t, bin), null, 'count').y_out;
			const per = Math.round(bin * 60);
			// Every bin but the trailing ones holds exactly `per` samples.
			const full = counts.filter((c) => c > 0);
			expect(full.slice(0, -1).every((c) => c === per)).toBe(true);
			expect(full.reduce((a, c) => a + c, 0)).toBe(t.length);
		}
	});

	it('bins of 2.5 samples keep their old 3-2-3-2 membership (edges between samples)', () => {
		const t = Array.from({ length: 100 }, (_, i) => i * 0.1);
		const counts = binData(t, t, 0.25, binOrigin(t, 0.25), null, 'count').y_out;
		expect(counts.slice(0, 6)).toEqual([3, 2, 3, 2, 3, 2]);
		const o = binOrigin(t, 0.25);
		for (const x of t) {
			const frac = (x - o) / 0.25 - Math.floor((x - o) / 0.25);
			expect(Math.min(frac, 1 - frac) * 0.25).toBeGreaterThan(0.02);
		}
	});

	it('irregular (jittered) times keep the binSize-grid origin', () => {
		const r = rng(5);
		const t = Array.from({ length: 300 }, (_, i) => 3.2 + i * 0.5 + 0.3 * r());
		expect(binOrigin(t, 1)).toBe(3);
	});

	it('regular data whose samples sit mid-bin keeps the same bins as before', () => {
		const t = Array.from({ length: 48 }, (_, i) => i + 0.5);
		const y = t.map((v) => Math.sin(v));
		const before = binData(t, y, 1, 0).y_out;
		const after = binData(t, y, 1, binOrigin(t, 1)).y_out;
		expect(after.filter(Number.isFinite)).toEqual(before.filter(Number.isFinite));
	});
});
