// @ts-nocheck
/**
 * Tests that confirm or refute the unconfirmed fitting issues of the 2026-10-03 review
 * (vault "Known Issues and TODOs", "Possible issues, not confirmed"): FIT-U1, U2, U3, U5.
 * FIT-U6 (findCentileValue) is in plots/Actogram/findCentileValue.zeros.test.js.
 *
 * Every simulation is seeded. The sweeps that produced the numbers quoted below run with
 *   FIT_REVIEW_LONG=1 pnpm vitest run src/lib/utils/fitUnconfirmed.review.test.js --silent=false
 * and print their tables; the default suite keeps the fast guards.
 *
 * Verdicts (2026-10-28):
 *  - FIT-U1 CONFIRMED, ALREADY FIXED (v79.0): the old start phi = -atan2(S, C) was a quarter
 *    cycle late. At SNR 1 (half-amplitude = noise SD, free period, 7 days hourly, 40 seeds) it
 *    put 7 acrophases more than 3 h off; the current pi/2 - atan2(S, C) puts none. The guard
 *    below fails if the start is reverted.
 *  - FIT-U2 CONFIRMED, ALREADY FIXED (v79.0): A < 0 does happen (1 winning fit in 640
 *    rectangular-wave fits; 2 in 1,080 periodic double-logistic fits, both free-period fits
 *    to noise) and the canonical form
 *    reports it correctly. Without it that fit reported acrophase 11.75 h and duty 0.474 (the
 *    rest phase) instead of 23.75 h and 0.526. Guarded here and, in all three ports, by the
 *    parity fixture util-movingwindows-rectfit-negative-a.
 *  - FIT-U3 REFUTED as a source of material error: the stop leaves RSS to gain, but a tight
 *    tolerance is not reliably closer to the truth at any SNR tried and costs 3x to 300x the
 *    time. See the describe block.
 *  - FIT-U5 CONFIRMED (partial final days are used), a method choice: see the describe block.
 */
import { describe, it, expect } from 'vitest';
import { fitRectangularWave, evaluateRectWaveAtPoints } from './rectwave.js';
import { fitDoubleLogistic, evaluateDoubleLogisticAtPoints } from './doublelogistic.js';
import { computeNPCRA } from './npcra.js';

const LONG = !!process.env.FIT_REVIEW_LONG;
const W24 = (2 * Math.PI) / 24;

/** Numerical Recipes LCG, so a seed is the same data in every port and run. */
function rng(seed) {
	let s = seed >>> 0 || 1;
	return () => {
		s = (Math.imul(1664525, s) + 1013904223) >>> 0;
		return s / 4294967296;
	};
}
function gauss(r) {
	return Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
}
/**
 * Square wave 10 +/- amp (high for duty * T from each onset) plus N(0, sd), hourly by default.
 * `acro` is the true centre of the high phase, which is what the rectangular wave's
 * acrophase estimates.
 */
function square(seed, { T = 24, duty = 0.5, onset = 6, amp = 1, sd = 1, days = 7, dt = 1 } = {}) {
	const r = rng(seed);
	const t = [];
	const y = [];
	for (let i = 0; i < Math.round((days * 24) / dt); i++) {
		const ti = i * dt;
		const ph = (((ti - onset) % T) + T) % T;
		t.push(ti);
		y.push(10 + (ph < duty * T ? amp : -amp) + sd * gauss(r));
	}
	return { t, y, acro: (onset + (duty * T) / 2) % T };
}
const circ = (a, b, T) => {
	const d = (((a - b) % T) + T) % T;
	return Math.min(d, T - d);
};
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

describe('FIT-U1: rectangular-wave starting phase', { timeout: 120000 }, () => {
	it('SNR 1 and 0.5, free period, 40 seeds each: no acrophase more than 3 h off', () => {
		// Old start (-atan2): 7 and 5 of 40 off by more than 3 h. Current: 0 and 0.
		for (const amp of [1, 0.5]) {
			const off = [];
			const perErr = [];
			for (let s = 1; s <= 40; s++) {
				const d = square(s, { amp, onset: 6 + (s % 24) });
				const r = fitRectangularWave(d.t, d.y);
				perErr.push(Math.abs(r.period - 24));
				if (circ(r.acrophase, d.acro, r.period) > 3) off.push(s);
			}
			expect(off).toEqual([]);
			expect(median(perErr)).toBeLessThan(0.25); // measured 0.054 h (amp 1), 0.193 h (0.5)
		}
	});

	it.runIf(LONG)(
		'sweep: accuracy and convergence by SNR (prints a table)',
		() => {
			const rows = [];
			for (const amp of [4, 1, 0.5, 0.3, 0.2]) {
				for (const fixed of [false, true]) {
					const pe = [];
					const ae = [];
					const de = [];
					let conv = 0;
					for (let s = 1; s <= 40; s++) {
						const d = square(s, { amp, onset: 6 + (s % 24) });
						const r = fitRectangularWave(
							d.t,
							d.y,
							fixed ? { fixOmega: true, fixedOmega: W24 } : {}
						);
						if (r.diagnostics.converged) conv++;
						pe.push(Math.abs(r.period - 24));
						ae.push(circ(r.acrophase, d.acro, r.period));
						de.push(Math.abs(r.parameters.dutyCycle - 0.5));
					}
					rows.push({
						snr: amp,
						fixed,
						medPeriodErrH: median(pe).toFixed(3),
						medAcroErrH: median(ae).toFixed(2),
						acroOver3h: ae.filter((e) => e > 3).length,
						medDutyErr: median(de).toFixed(3),
						converged: conv
					});
				}
			}
			console.table(rows);
		},
		600000
	);
});

describe('FIT-U2: sign canonicalisation of A', { timeout: 120000 }, () => {
	it('the fit whose best start ends with A < 0 reports the active phase, not the rest phase', () => {
		// Seed 15: high 6 h a day from 18 h (true centre 21 h), step 0.6, noise SD 1. The raw
		// optimum is A = -0.144, acrophase 11.75 h, duty 0.474: the same curve described from
		// its rest phase.
		const d = square(15, { amp: 0.3, duty: 0.25, onset: 18 });
		const r = fitRectangularWave(d.t, d.y, { fixOmega: true, fixedOmega: W24 });
		expect(r.parameters.A).toBeGreaterThan(0);
		expect(r.acrophase).toBeCloseTo(23.749, 2);
		expect(r.parameters.dutyCycle).toBeCloseTo(0.526, 3);
		// The reported acrophase is a maximum of the reported curve, and that curve is the fit.
		const [atAcro] = evaluateRectWaveAtPoints(r.parameters, [r.acrophase]);
		expect(atAcro).toBeGreaterThan(r.parameters.M);
		const again = evaluateRectWaveAtPoints(r.parameters, d.t);
		again.forEach((v, i) => expect(v).toBeCloseTo(r.fitted[i], 9));
	});

	it('the periodic double logistic whose best start ends with A < 0 reports the A >= 0 form', () => {
		// White noise with a 0.1 step (seed 9 of the hunt that found it; 2 such fits in 1,080).
		// The fit is degenerate (a 2.4 h period on noise), but its raw optimum has A = -0.81 and
		// duty 0: the canonical form is the same curve (to 1e-12) with A = +0.81 and duty 1.
		const r = rng(9 * 7 + 1);
		const t = [];
		const y = [];
		for (let i = 0; i < 168; i++) {
			const ph = (((i - 9) % 24) + 24) % 24;
			t.push(i);
			y.push(10 + (ph < 0.2 * 24 ? 0.1 : -0.1) + gauss(r));
		}
		const q = fitDoubleLogistic(t, y, { periodic: true });
		expect(q.parameters.A).toBeCloseTo(0.8124, 4);
		expect(q.parameters.M).toBeCloseTo(9.0565, 4);
		expect(q.dutyCycle).toBeGreaterThan(0.99);
		const again = evaluateDoubleLogisticAtPoints(q.parameters, true, t);
		again.forEach((v, i) => expect(v).toBeCloseTo(q.fitted[i], 9));
	});

	it('low-SNR and inverted sweeps: A >= 0 and the curve is high at the reported acrophase / active phase', () => {
		for (const amp of [0.2, 0.5]) {
			for (const duty of [0.5, 0.25]) {
				for (let s = 1; s <= 8; s++) {
					const d = square(s, { amp: -amp, duty, onset: 3 + (s % 24) }); // inverted
					const r = fitRectangularWave(d.t, d.y, { fixOmega: true, fixedOmega: W24 });
					expect(r.parameters.A).toBeGreaterThanOrEqual(0);
					const [v] = evaluateRectWaveAtPoints(r.parameters, [r.acrophase]);
					expect(v).toBeGreaterThanOrEqual(r.parameters.M);
					const q = fitDoubleLogistic(d.t, d.y, {
						periodic: true,
						fixPeriod: true,
						fixedPeriod: 24
					});
					const { M, A, t1 } = q.parameters;
					expect(A).toBeGreaterThanOrEqual(0);
					const [mid] = evaluateDoubleLogisticAtPoints(q.parameters, true, [t1 + q.duration / 2]);
					expect(mid).toBeGreaterThanOrEqual(M);
				}
			}
		}
	});
});

/**
 * FIT-U3. Both fits stop when one accepted step lowers the RSS by less than 1e-6 of it.
 * Measured against tolerance 1e-12 with maxIterations 1e5 (20 seeds, 7 days hourly, duty 0.5):
 *  - Rectangular wave: the early stop moves the free period by at most 2.1e-3 of it (0.05 h)
 *    at SNR 4, against a sampling error of 0.043 h (median) at that SNR; acrophase by at most
 *    0.19 h; duty by at most 0.021; RSS by at most 1.8e-4 of it. On clean data (T 23.5 h,
 *    15 min sampling, noise SD 1 to 0.05 for a half-amplitude of 4, 10 seeds) the median
 *    period error is 4.2e-3 h at the default and 3.4e-3 h tight, the largest 0.021 h at both:
 *    the floor is the model (tanh edges on sampled steps), not the tolerance.
 *  - Double logistic: the stop is early on weak rhythms. RSS is up to 18% higher than the
 *    tight optimum (SNR 1, free period) and the duty cycle differs by up to 0.51, but the
 *    tight fits are not reliably closer to the truth: median duty error (default vs tight)
 *    0.013 vs 0.009 and 0.006 vs 0.005 at SNR 4, 0.021 vs 0.024 (fixed) and 0.367 vs 0.271
 *    (free) at SNR 1, 0.389 vs 0.389 (fixed) and 0.443 vs 0.499 (free) at SNR 0.5. The
 *    surface is flat along shallow-slope fits, so on weak rhythms the duty cycle is not
 *    identified whatever the tolerance (a separate finding: see the review notes). On clean
 *    data the median free period error is 1.8e-3 to 3.3e-3 h at the default and 1.3e-3 to
 *    2.3e-3 h tight.
 *  - Cost: tight fits take 12x to 15x as long (rectangular wave, 15 min data: 20 to 33 ms
 *    becomes 280 to 460 ms) and 3x to 300x (double logistic: 4 to 72 ms becomes 13 ms to 6.8 s
 *    per fit hourly, 11 to 19 s per free-period fit on 672 points).
 * So the tolerance is not the limit on accuracy; it is NOT changed, and these tests guard
 * that the default stop stays within the noise.
 */
describe('FIT-U3: stopping tolerance', { timeout: 120000 }, () => {
	it('rectangular wave: the default stop agrees with a tight one within the noise (SNR 4)', () => {
		const d = square(1, { amp: 4, onset: 4 });
		const a = fitRectangularWave(d.t, d.y);
		const b = fitRectangularWave(d.t, d.y, { tolerance: 1e-12, maxIterations: 100000 });
		expect(a.diagnostics.converged).toBe(true);
		expect(Math.abs(a.period - b.period)).toBeLessThan(0.06);
		expect(circ(a.acrophase, b.acrophase, 24)).toBeLessThan(0.2);
		expect(Math.abs(a.rss - b.rss) / b.rss).toBeLessThan(1e-3);
	});

	it('double logistic, strong rhythm: default and tight stops agree (fixed period, SNR 4)', () => {
		const d = square(1, { amp: 4, onset: 4 });
		const o = { periodic: true, fixPeriod: true, fixedPeriod: 24 };
		const a = fitDoubleLogistic(d.t, d.y, o);
		const b = fitDoubleLogistic(d.t, d.y, { ...o, tolerance: 1e-12, maxIterations: 100000 });
		expect(Math.abs(a.dutyCycle - b.dutyCycle)).toBeLessThan(0.02);
		expect(Math.abs(a.rss - b.rss) / b.rss).toBeLessThan(1e-4);
	});

	it.runIf(LONG)(
		'sweep: default vs tight tolerance, and both against the truth (prints tables)',
		() => {
			const rows = [];
			for (const amp of [4, 1, 0.5]) {
				for (const fixed of [true, false]) {
					const dl = { rss: [], T: [], duty: [], errA: [], errB: [], msA: 0, msB: 0 };
					const rw = { rss: [], T: [], duty: [], acro: [] };
					for (let s = 1; s <= 20; s++) {
						const d = square(s, { amp, onset: 3 + (s % 24) });
						const o = { periodic: true, fixPeriod: fixed, fixedPeriod: 24 };
						let t0 = performance.now();
						const a = fitDoubleLogistic(d.t, d.y, o);
						dl.msA += performance.now() - t0;
						t0 = performance.now();
						const b = fitDoubleLogistic(d.t, d.y, {
							...o,
							tolerance: 1e-12,
							maxIterations: 100000
						});
						dl.msB += performance.now() - t0;
						dl.rss.push((a.rss - b.rss) / b.rss);
						dl.duty.push(Math.abs(a.dutyCycle - b.dutyCycle));
						dl.errA.push(Math.abs(a.dutyCycle - 0.5));
						dl.errB.push(Math.abs(b.dutyCycle - 0.5));
						if (!fixed) dl.T.push(Math.abs(a.parameters.T - b.parameters.T) / 24);
						const ro = fixed ? { fixOmega: true, fixedOmega: W24 } : {};
						const ra = fitRectangularWave(d.t, d.y, ro);
						const rb = fitRectangularWave(d.t, d.y, {
							...ro,
							tolerance: 1e-12,
							maxIterations: 100000
						});
						rw.rss.push((ra.rss - rb.rss) / rb.rss);
						rw.duty.push(Math.abs(ra.parameters.dutyCycle - rb.parameters.dutyCycle));
						rw.acro.push(circ(ra.acrophase, rb.acrophase, 24));
						if (!fixed) rw.T.push(Math.abs(ra.period - rb.period) / 24);
					}
					const mx = (v) => (v.length ? Math.max(...v).toExponential(2) : '-');
					rows.push({
						snr: amp,
						fixed,
						dlMaxRelRss: mx(dl.rss),
						dlMaxRelT: mx(dl.T),
						dlMaxDutyDiff: mx(dl.duty),
						dlMedDutyErrDefault: median(dl.errA).toFixed(3),
						dlMedDutyErrTight: median(dl.errB).toFixed(3),
						dlMsDefault: (dl.msA / 20).toFixed(0),
						dlMsTight: (dl.msB / 20).toFixed(0),
						rwMaxRelRss: mx(rw.rss),
						rwMaxRelT: mx(rw.T),
						rwMaxDutyDiff: mx(rw.duty),
						rwMaxAcroDiffH: mx(rw.acro)
					});
				}
			}
			console.table(rows);
		},
		1800000
	);
});

/**
 * FIT-U5. computeNPCRA folds every epoch, so a record of D days + h hours contributes its
 * partial last day to the hourly profile and to n. nparACT (Blume, Santhi & Schabus 2016,
 * MethodsX 3:430-435, doi:10.1016/j.mex.2016.05.006) defaults to fulldays = TRUE, which cuts
 * the data to floor(length / 24 h) whole days from the first sample before IS and IV
 * (nparACT_base.R: `data <- data[1:(e*bin_hr*24*full_days),]`, CRAN 0.9.1). Van Someren et
 * al. (1999, Chronobiol Int 16(4):505-518, p.509) define IS and IV over the n hourly values
 * and p values per day without saying what to do with a partial day.
 *
 * Measured (minute data, active 16 h from about 07:00 with 0.5 h SD day-to-day jitter, 30
 * seeds, start hour varied): IS with the partial day minus IS truncated to full days has mean
 * -0.002 to +0.006 (no consistent bias) and largest |difference| 0.061 (5 d + 18 h), 0.040
 * (7 d + 18 h), 0.021 (14 d + 18 h), against a between-seed IS SD of 0.016 to 0.020. IV
 * moves by at most 0.0017 on average, RA by at most 0.0016. Truncating is a method choice, so
 * the behaviour is NOT changed here.
 */
function actigraphy(seed, days, extraH, startHour) {
	const r = rng(seed);
	const t = [];
	const y = [];
	const nMin = Math.round((days * 24 + extraH) * 60);
	const dayOn = Array.from({ length: days + 3 }, () => 7 + 0.5 * gauss(r));
	for (let i = 0; i < nMin; i++) {
		const th = startHour + i / 60;
		const dd = Math.floor(th / 24);
		const h = th - 24 * dd;
		const act = h >= dayOn[dd] && h < dayOn[dd] + 16;
		t.push(i / 60);
		y.push(Math.max(0, act ? 200 + 150 * gauss(r) : r() < 0.05 ? 50 * r() : 0));
	}
	return { t, y };
}

/** IS on whole days the nparACT way: hourly means, then Van Someren's formula. */
function isFullDaysNparACT(t, y) {
	const hours = Math.floor((t[t.length - 1] - t[0] + 1 / 60) / 24) * 24;
	const x = new Array(hours).fill(0);
	const c = new Array(hours).fill(0);
	t.forEach((ti, i) => {
		const k = Math.floor(ti - t[0] + 1e-9);
		if (k < hours) {
			x[k] += y[i];
			c[k]++;
		}
	});
	for (let k = 0; k < hours; k++) x[k] /= c[k];
	const n = hours;
	const p = 24;
	const mean = x.reduce((s, v) => s + v, 0) / n;
	let num = 0;
	for (let h = 0; h < p; h++) {
		let m = 0;
		for (let d = 0; d < n / p; d++) m += x[d * p + h];
		num += (m / (n / p) - mean) ** 2;
	}
	const den = x.reduce((s, v) => s + (v - mean) ** 2, 0);
	return (n * num) / (p * den);
}

describe(
	'FIT-U5: NPCRA uses partial final days (documents current behaviour)',
	{ timeout: 120000 },
	() => {
		it('a 7 d + 12 h record folds all 180 epochs; cutting it to whole days is the nparACT IS', () => {
			const diffs = [];
			for (let s = 1; s <= 10; s++) {
				const d = actigraphy(s, 7, 12, (s * 5) % 24);
				const all = computeNPCRA(d.t, d.y, { epochHours: 1 });
				const nKeep = 7 * 24 * 60;
				const cut = computeNPCRA(d.t.slice(0, nKeep), d.y.slice(0, nKeep), { epochHours: 1 });
				expect(all.nEpochs).toBe(180); // the partial day is in
				expect(cut.nEpochs).toBe(168);
				// The truncated record reproduces nparACT's fulldays = TRUE definition exactly.
				expect(cut.IS).toBeCloseTo(isFullDaysNparACT(d.t, d.y), 10);
				diffs.push(all.IS - cut.IS);
			}
			// Present but small: no consistent sign, largest |difference| well under 0.05.
			expect(diffs.some((v) => Math.abs(v) > 1e-4)).toBe(true);
			expect(Math.max(...diffs.map(Math.abs))).toBeLessThan(0.05);
			expect(Math.abs(diffs.reduce((a, b) => a + b, 0) / diffs.length)).toBeLessThan(0.01);
		});

		it.runIf(LONG)(
			'sweep: IS, IV and RA with vs without the partial day (prints a table)',
			() => {
				const rows = [];
				const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
				const sd = (v) => Math.sqrt(v.reduce((s, x) => s + (x - mean(v)) ** 2, 0) / (v.length - 1));
				for (const days of [5, 7, 14]) {
					for (const extra of [1, 6, 12, 18, 23]) {
						const dIS = [];
						const dIV = [];
						const dRA = [];
						const isCut = [];
						for (let s = 1; s <= 30; s++) {
							const d = actigraphy(s, days, extra, (s * 5) % 24);
							const a = computeNPCRA(d.t, d.y, { epochHours: 1 });
							const nKeep = days * 24 * 60;
							const b = computeNPCRA(d.t.slice(0, nKeep), d.y.slice(0, nKeep), { epochHours: 1 });
							dIS.push(a.IS - b.IS);
							dIV.push(a.IV - b.IV);
							dRA.push(a.RA - b.RA);
							isCut.push(b.IS);
						}
						rows.push({
							days,
							extraH: extra,
							meanIS: mean(isCut).toFixed(3),
							sdIS: sd(isCut).toFixed(4),
							meanDiffIS: mean(dIS).toFixed(4),
							maxAbsDiffIS: Math.max(...dIS.map(Math.abs)).toFixed(4),
							meanDiffIV: mean(dIV).toFixed(4),
							maxAbsDiffRA: Math.max(...dRA.map(Math.abs)).toFixed(4)
						});
					}
				}
				console.table(rows);
			},
			600000
		);
	}
);
