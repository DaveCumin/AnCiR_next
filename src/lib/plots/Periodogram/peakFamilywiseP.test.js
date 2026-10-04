// SPEC-6: the periodogram's peak_pvalue port exported the UNCORRECTED per-period p at the
// maximum. Reviewer setup: chi-squared, white noise, n = 240 hourly, 16-32 h, 1 h bins:
// P(peak_pvalue < 0.05) = 0.341 while the drawn Sidak line was crossed in 0.030.
// SPEC-14: the per-period p was 1 - CDF, which underflows to 0 (Qp 470.9 on 23 df).
import { describe, it, expect } from 'vitest';
import { chisqSf, peakFamilywiseP } from './Periodogram.svelte';
import { runPeriodogramCalculation } from '$lib/utils/periodogram.js';

function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
function gauss(r) {
	let u = 0;
	while (u === 0) u = r();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

describe('chisqSf (upper tail, no 1 - CDF underflow)', () => {
	// scipy.stats.chi2.sf, scipy 1.x
	const cases = [
		[470.9, 23, 3.930954728421994e-85],
		[30, 23, 0.14940164769632294],
		[5, 23, 0.9999718556011078],
		[0.5, 3, 0.9188914116546758],
		[100, 1, 1.5239706048320995e-23],
		[23, 23, 0.4607708905522918],
		[0.001, 2, 0.9995001249791693],
		[60, 40, 0.02187346844139091]
	];
	for (const [q, df, ref] of cases) {
		it(`chi2.sf(${q}, ${df})`, () => {
			expect(Math.abs(chisqSf(q, df) - ref) / ref).toBeLessThan(1e-9);
		});
	}
});

describe('SPEC-6: the peak p is family-wise and agrees with the drawn line', () => {
	it('is below alpha exactly when the peak crosses the Sidak line, and at the line rate', () => {
		const REPS = 300;
		let below = 0;
		let crossed = 0;
		let raw = 0;
		for (let s = 0; s < REPS; s++) {
			const r = rng(500 + s);
			const t = [];
			const y = [];
			for (let i = 0; i < 240; i++) {
				t.push(i);
				y.push(gauss(r));
			}
			const pd = runPeriodogramCalculation({
				method: 'Chi-squared',
				xData: t,
				yData: y,
				binSize: 1,
				periodMin: 16,
				periodMax: 32,
				periodSteps: 1,
				chiSquaredAlpha: 0.05
			});
			let idx = 0;
			for (let i = 1; i < pd.y.length; i++) if (pd.y[i] > pd.y[idx]) idx = i;
			const fw = peakFamilywiseP(pd, idx);
			const crosses = pd.y[idx] > pd.threshold[idx];
			expect(fw < 0.05).toBe(crosses);
			if (fw < 0.05) below++;
			if (crosses) crossed++;
			if (pd.pvalue[idx] < 0.05) raw++;
		}
		expect(below).toBe(crossed);
		expect(below / REPS).toBeLessThan(0.07);
		// The uncorrected p the port used to export is far more often "significant".
		expect(raw / REPS).toBeGreaterThan(0.2);
	});

	it('keeps a strong peak tiny instead of 0', () => {
		const pd = { y: [470.9, 10], df: [23, 23], pvalue: [0, 0.98] };
		const fw = peakFamilywiseP(pd, 0);
		expect(fw).toBeGreaterThan(0);
		expect(fw / (2 * 3.930954728421994e-85)).toBeCloseTo(1, 6);
	});

	it('is NaN for methods without an analytic p', () => {
		expect(peakFamilywiseP({ y: [1, 2], pvalue: [NaN, NaN] }, 1)).toBeNaN();
	});
});
