// @ts-nocheck
// Enright's periodogram (SPEC-7, SPEC-8 of the 2026-10-03 review).
//
// Enright (1965, J Theor Biol 8:426) folds the series into a Buys-Ballot table (one row per
// cycle, one column per phase) and measures the spread of the column means. The statistic is
// eq. 12.12 of Legendre & Legendre (Numerical Ecology, 2nd English ed. 1998, section 12.4.1),
// the standard deviation of the column means about their mean with the number of columns as
// the divisor, each column mean taken over the cells that have data (their eq. 12.13).
//
// The app used to report the mean lag-product autocorrelation at every multiple of the fold
// over the variance, with empty bins as 0: a different statistic that could be negative (the
// review's record, n = 240 and P = 20: -0.0495 where A_p is 0.2612), and whose peak differed
// from A_p's in 292 of 500 noisy records. On hourly data at the old 0.25 h default the true
// period of a 24.5 h rhythm scored half its whole-hour neighbours, because three of every
// four bins were empty and counted as 0.
//
// The pinned values come from an independent numpy implementation written from the
// definition (Buys-Ballot table with NaN cells, nanmean down the columns), which agrees with
// this code to 1e-15 on every record below and reproduces the textbook example exactly.
import { describe, it, expect } from 'vitest';
import {
	runPeriodogramCalculation,
	enrightAmplitude,
	medianSamplingInterval
} from './periodogram.js';

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
function record(n, dt, tau, amp, noise, seed, mod) {
	const r = rng(seed);
	let t = [];
	let y = [];
	for (let i = 0; i < n; i++) {
		t.push(i * dt);
		y.push(amp * Math.cos((2 * Math.PI * i * dt) / tau) + noise * gauss(r));
	}
	if (mod) ({ t, y } = mod(t, y, r));
	return { t, y };
}
const enright = (t, y, binSize, periodMin, periodMax, periodSteps) =>
	runPeriodogramCalculation({
		method: 'Enright',
		xData: t,
		yData: y,
		binSize,
		periodMin,
		periodMax,
		periodSteps
	});
const at = (res, period) => res.y[res.x.findIndex((x) => Math.abs(x - period) < 1e-9)];

/** A second, deliberately naive A_p: build the table row by row, then the textbook formula. */
function naiveAp(series, ncol) {
	const cols = Array.from({ length: ncol }, () => []);
	for (let row = 0; row * ncol < series.length; row++) {
		for (let c = 0; c < ncol; c++) {
			const v = series[row * ncol + c];
			if (v !== undefined && !Number.isNaN(v)) cols[c].push(v);
		}
	}
	const means = cols.filter((c) => c.length).map((c) => c.reduce((a, b) => a + b, 0) / c.length);
	const m = means.reduce((a, b) => a + b, 0) / means.length;
	return Math.sqrt(means.reduce((a, b) => a + (b - m) ** 2, 0) / means.length);
}

describe("Enright's A_p: the definition", () => {
	// Legendre & Legendre, section 12.4.1, numerical example: periods 4 and 5 of
	// 2,2,4,7,10,5,2,5,8,4,1,2,5,9,6,3. Period 5 has a partial last row (column 1 has four
	// values, the others three), and the book still divides by the five columns.
	const LL = [2, 2, 4, 7, 10, 5, 2, 5, 8, 4, 1, 2, 5, 9, 6, 3];
	it('reproduces the textbook example (1.0951 at period 4, 2.2708 at period 5)', () => {
		expect(enrightAmplitude(LL, 4)).toBeCloseTo(1.0951, 4);
		expect(enrightAmplitude(LL, 5)).toBeCloseTo(2.2708, 4);
		const res = enright(
			LL.map((_, i) => i),
			LL,
			1,
			4,
			5,
			1
		);
		expect(res.x).toEqual([4, 5]);
		expect(res.y[0]).toBeCloseTo(1.095088466745952, 12);
		expect(res.y[1]).toBeCloseTo(2.2708295107001466, 12);
	});

	it('the review record (n = 240, P = 20): 0.2612, not the old -0.0495', () => {
		const { t, y } = record(240, 1, 24, 0.5, 1, 77 + 240);
		const res = enright(t, y, 1, 20, 30, 1);
		expect(at(res, 20)).toBeCloseTo(0.26121070231864163, 12);
		expect(at(res, 24)).toBeCloseTo(0.4697596737501978, 12);
		expect(res.x[res.y.indexOf(Math.max(...res.y))]).toBe(24);
	});

	it('an empty column is left out and a fold with < 2 occupied columns has no statistic', () => {
		expect(enrightAmplitude([1, NaN, 3, NaN, 5, NaN], 2)).toBeNaN();
		// Columns 0 and 2 occupied, column 1 empty: SD of the two means (3 and 4) over 2.
		expect(enrightAmplitude([1, NaN, 3, 5, NaN, 5], 3)).toBeCloseTo(0.5, 15);
		// A fold longer than the record is not a fold.
		expect(enrightAmplitude([1, 2, 3], 4)).toBeNaN();
	});

	it('is never negative, over 200 noisy records and every fold', () => {
		for (let s = 0; s < 200; s++) {
			const { t, y } = record(240, 1, 24, 0.35, 1, 300 + s);
			const res = enright(t, y, 1, 4, 60, 1);
			expect(res.y.length).toBe(57);
			for (const v of res.y) expect(v).toBeGreaterThanOrEqual(0);
		}
	});

	it("agrees with a naive Buys-Ballot A_p at every fold, so the peaks agree (the review's 500 records)", () => {
		let disagree = 0;
		for (let s = 0; s < 500; s++) {
			const { y } = record(240, 1, 24, 0.35, 1, 300 + s);
			const res = enright(
				y.map((_, i) => i),
				y,
				1,
				16,
				32,
				1
			);
			for (let i = 0; i < res.x.length; i++) {
				expect(res.y[i]).toBeCloseTo(naiveAp(y, res.x[i]), 12);
			}
			let best = 16;
			for (let P = 17; P <= 32; P++) if (naiveAp(y, P) > naiveAp(y, best)) best = P;
			if (res.x[res.y.indexOf(Math.max(...res.y))] !== best) disagree++;
		}
		expect(disagree).toBe(0);
	});
});

describe('A_p pinned to the independent numpy reference', () => {
	const cases = [
		[
			'hourly, 14 days, tau 24.3',
			() => record(336, 1, 24.3, 30, 5, 921),
			[1, 18, 30, 0.5],
			{ 18: 1.3147584757455648, 23: 6.3505937379189845, 24: 20.739166828350832 }
		],
		[
			'15 min data at 15 min bins',
			() => record(4 * 24 * 7, 0.25, 23.6, 1, 0.8, 5),
			[0.25, 20, 28, 0.25],
			{ 20: 0.31196517726906564, 23.75: 0.7320872115202369, 24.5: 0.6826622044461954 }
		],
		[
			'partial last cycle (250 hourly points)',
			() => record(250, 1, 24, 1, 0.7, 11),
			[1, 18, 30, 1],
			{ 19: 0.2293396070914932, 24: 0.7466588204317078, 29: 0.22337865964684323 }
		],
		[
			'missing values and a 40 h gap',
			() =>
				record(300, 1, 25, 1, 0.5, 12, (t, y) => ({
					t,
					y: y.map((v, i) => (i % 9 === 4 || (i >= 100 && i < 140) ? null : v))
				})),
			[1, 20, 30, 1],
			{ 20: 0.1801375060662455, 25: 0.7089270220829116, 30: 0.17228057943402408 }
		],
		[
			'uneven occupancy (jittered, 35% dropped, 0 to 2 samples per bin)',
			() =>
				record(400, 0.5, 24, 1, 0.6, 13, (t, y, r) => {
					const tt = [];
					const yy = [];
					for (let i = 0; i < t.length; i++) {
						if (r() < 0.35) continue;
						tt.push(t[i] + 0.3 * r());
						yy.push(y[i]);
					}
					return { t: tt, y: yy };
				}),
			[1, 20, 28, 0.25],
			{ 20: 0.26055887545704354, 24: 0.8159266417315146, 28: 0.33741743092840243 }
		],
		[
			'negative times (origin -120.5 h)',
			() => record(240, 1, 24, 1, 0.5, 14, (t, y) => ({ t: t.map((v) => v - 120.5), y })),
			[1, 18, 30, 1],
			{ 18: 0.17797888953514882, 24: 0.7256435955596751, 30: 0.21410209976600078 }
		]
	];
	it.each(cases)('%s', (_, make, [b, lo, hi, step], pins) => {
		const { t, y } = make();
		const res = enright(t, y, b, lo, hi, step);
		for (const [P, v] of Object.entries(pins)) expect(at(res, Number(P))).toBeCloseTo(v, 12);
	});
});

describe('empty bins are missing, not 0 (SPEC-8)', () => {
	// Hourly data, tau 24.5 h, the review's record. At 0.25 h bins three of every four bins
	// are empty. They used to count as 0: 24.00 0.647, 24.50 0.377, 25.00 0.664.
	const { t, y } = record(240, 1, 24.5, 1, 0.3, 1);
	it('the true period now scores above its whole-hour neighbours', () => {
		const res = enright(t, y, 0.25, 23, 26, 0.25);
		expect(at(res, 24.5)).toBeCloseTo(0.7137356003426041, 12);
		expect(at(res, 24)).toBeCloseTo(0.6615269754746014, 12);
		expect(at(res, 25)).toBeCloseTo(0.6709074108623893, 12);
		expect(at(res, 24.5)).toBeGreaterThan(at(res, 24));
		expect(at(res, 24.5)).toBeGreaterThan(at(res, 25));
	});
	it('and does so on every one of 50 noise draws', () => {
		for (let s = 1; s <= 50; s++) {
			const rec = record(240, 1, 24.5, 1, 0.3, s);
			const res = enright(rec.t, rec.y, 0.25, 23, 26, 0.25);
			expect(at(res, 24.5)).toBeGreaterThan(at(res, 24));
			expect(at(res, 24.5)).toBeGreaterThan(at(res, 25));
		}
	});
	it('a whole-hour fold is identical at 0.25 h and 1 h bins (the empty columns drop out)', () => {
		const fine = enright(t, y, 0.25, 23, 26, 0.25);
		const coarse = enright(t, y, 1, 23, 26, 1);
		for (const P of [23, 24, 25, 26]) expect(at(fine, P)).toBeCloseTo(at(coarse, P), 12);
	});
});

describe('medianSamplingInterval (the default bin size of a new binned periodogram)', () => {
	it('is the median positive gap between sorted valid times', () => {
		expect(medianSamplingInterval([0, 1, 2, 3, 4])).toBe(1);
		expect(medianSamplingInterval([0, 0.25, 0.5, 0.75, 5])).toBe(0.25);
		expect(medianSamplingInterval([3, 1, 2, null, '', NaN, 0])).toBe(1);
		// Repeated times are not a gap; even counts average the middle two.
		expect(medianSamplingInterval([0, 0, 1, 3])).toBe(1.5);
		expect(medianSamplingInterval([5])).toBeNaN();
		expect(medianSamplingInterval([])).toBeNaN();
	});
});
