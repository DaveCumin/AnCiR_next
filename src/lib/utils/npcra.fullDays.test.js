// @ts-nocheck
/**
 * "Full days only" (decision 2026-11-01, review FIT-U5). nparACT defaults to fulldays = TRUE
 * and cuts the record to whole days from the first sample before computing anything
 * (nparACT_base.R, CRAN 0.9.1: `data <- data[1:(e*bin_hr*24*full_days),]`; Blume, Santhi &
 * Schabus 2016, MethodsX 3:430-435, doi:10.1016/j.mex.2016.05.006). With `fullDays: true`
 * computeNPCRA keeps floor(epochs / p) whole periods of epochs from the first sample, so IS,
 * IV, RA, M10 and L5 all rest on the same whole days.
 *
 * The reference below is written independently of npcra.js: it cuts the raw samples to whole
 * days the nparACT way (by time from the first sample), takes hourly means and applies the
 * Van Someren et al. (1999, Chronobiol Int 16(4):505-518, p.509) formulas directly.
 */
import { describe, it, expect } from 'vitest';
import { computeNPCRA } from './npcra.js';

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
/** Minute actigraphy, active 16 h from about 07:00 (as fitUnconfirmed.review.test.js). */
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

/** Whole-day cut, hourly means, then IS, IV, M10, L5 and RA from their definitions. */
function nparACTStyle(t, y, mWindow = 10, lWindow = 5) {
	const days = Math.floor((t[t.length - 1] - t[0] + 1 / 60) / 24);
	const n = days * 24;
	const x = new Array(n).fill(0);
	const c = new Array(n).fill(0);
	t.forEach((ti, i) => {
		const k = Math.floor(ti - t[0] + 1e-9);
		if (k < n) {
			x[k] += y[i];
			c[k]++;
		}
	});
	for (let k = 0; k < n; k++) x[k] /= c[k];
	const mean = x.reduce((s, v) => s + v, 0) / n;
	const ss = x.reduce((s, v) => s + (v - mean) ** 2, 0);
	const prof = Array.from({ length: 24 }, (_, h) => {
		let m = 0;
		for (let d = 0; d < days; d++) m += x[d * 24 + h];
		return m / days;
	});
	const IS = (n * prof.reduce((s, v) => s + (v - mean) ** 2, 0)) / (24 * ss);
	let dss = 0;
	for (let k = 1; k < n; k++) dss += (x[k] - x[k - 1]) ** 2;
	const IV = (n * dss) / ((n - 1) * ss);
	const win = (w) =>
		Array.from({ length: 24 }, (_, s) => {
			let m = 0;
			for (let j = 0; j < w; j++) m += prof[(s + j) % 24];
			return m / w;
		});
	const M10 = Math.max(...win(mWindow));
	const L5 = Math.min(...win(lWindow));
	return { IS, IV, M10, L5, RA: (M10 - L5) / (M10 + L5), n, days };
}

describe('computeNPCRA fullDays', () => {
	it('off (the default) folds every epoch, as before', () => {
		const d = actigraphy(3, 7, 12, 5);
		const a = computeNPCRA(d.t, d.y, { epochHours: 1 });
		const b = computeNPCRA(d.t, d.y, { epochHours: 1, fullDays: false });
		expect(a.nEpochs).toBe(180);
		expect(b).toEqual(a);
		expect(a.fullDaysKept).toBeNull();
	});

	it('on: IS, IV, M10, L5 and RA equal an independent whole-day computation to 1e-10', () => {
		for (let s = 1; s <= 10; s++) {
			const d = actigraphy(s, 7, 12, (s * 5) % 24);
			const r = computeNPCRA(d.t, d.y, { epochHours: 1, fullDays: true });
			const ref = nparACTStyle(d.t, d.y);
			expect(ref.days).toBe(7);
			expect(r.nEpochs).toBe(168);
			expect(r.n).toBe(168);
			expect(r.fullDaysKept).toBe(7);
			expect(r.droppedEpochs).toBe(12);
			expect(r.IS).toBeCloseTo(ref.IS, 10);
			expect(r.IV).toBeCloseTo(ref.IV, 10);
			expect(r.M10).toBeCloseTo(ref.M10, 10);
			expect(r.L5).toBeCloseTo(ref.L5, 10);
			expect(r.RA).toBeCloseTo(ref.RA, 10);
		}
	});

	it('on: the same as cutting the record to whole days by hand', () => {
		const d = actigraphy(7, 5, 18, 9);
		const keep = 5 * 24 * 60;
		const cut = computeNPCRA(d.t.slice(0, keep), d.y.slice(0, keep), { epochHours: 1 });
		const r = computeNPCRA(d.t, d.y, { epochHours: 1, fullDays: true });
		for (const k of ['IS', 'IV', 'RA', 'M10', 'L5', 'M10onset', 'L5onset', 'n'])
			expect(r[k]).toBe(cut[k]);
		expect(r.profile).toEqual(cut.profile);
		// And it differs from using the partial day (otherwise the test proves nothing).
		const all = computeNPCRA(d.t, d.y, { epochHours: 1 });
		expect(Math.abs(all.IS - r.IS)).toBeGreaterThan(1e-4);
	});

	it('on: a record of exactly whole days is unchanged', () => {
		const d = actigraphy(2, 7, 0, 0);
		const a = computeNPCRA(d.t, d.y, { epochHours: 1 });
		const b = computeNPCRA(d.t, d.y, { epochHours: 1, fullDays: true });
		expect(b.IS).toBe(a.IS);
		expect(b.IV).toBe(a.IV);
		expect(b.droppedEpochs).toBe(0);
		expect(b.fullDaysKept).toBe(7);
	});

	it('on: whole periods of the folding period and epoch, not of 24 h', () => {
		// 15 min epochs, a 20 h period: p = 80 epochs; 3 d of minute data = 288 epochs = 3 periods + 48.
		const d = actigraphy(4, 3, 0, 0);
		const r = computeNPCRA(d.t, d.y, { epochHours: 0.25, period: 20, fullDays: true });
		expect(r.p).toBe(80);
		expect(r.nEpochs).toBe(240);
		expect(r.fullDaysKept).toBe(3);
		expect(r.droppedEpochs).toBe(48);
	});

	it('on: a record shorter than one period keeps every epoch and says no whole day was cut', () => {
		const d = actigraphy(5, 0, 20, 0);
		const a = computeNPCRA(d.t, d.y, { epochHours: 1 });
		const b = computeNPCRA(d.t, d.y, { epochHours: 1, fullDays: true });
		expect(b.IS).toBe(a.IS);
		expect(b.nEpochs).toBe(a.nEpochs);
		expect(b.fullDaysKept).toBe(0);
		expect(b.droppedEpochs).toBe(0);
	});
});
