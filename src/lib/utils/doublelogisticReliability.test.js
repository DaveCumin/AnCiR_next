// @ts-nocheck
/**
 * The double-logistic "shallow or weak rhythm" warning (decision 2026-11-01, from the
 * 2026-10-28 fit review, FIT-U3 in fitUnconfirmed.review.test.js). The fit is NOT changed;
 * the warning says when its duty cycle, onset and offset cannot be trusted.
 */
import { describe, it, expect } from 'vitest';
import { fitDoubleLogistic } from './doublelogistic.js';
import {
	doubleLogisticReliability,
	doubleLogisticReliabilityWarnings,
	DL_EDGE_TIME_PER_RATE,
	DL_MAX_EDGE_FRACTION,
	DL_MIN_R2,
	rollingDoubleLogisticWarning
} from './doublelogisticReliability.js';

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
/** 10 +/- amp, square (or cosine) wave, hourly for 7 days, plus N(0, 1). */
function wave(seed, { amp = 1, duty = 0.5, onset = 6, shape = 'square' } = {}) {
	const r = rng(seed);
	const t = [];
	const y = [];
	for (let i = 0; i < 168; i++) {
		const ph = (((i - onset) % 24) + 24) % 24;
		const v = shape === 'square' ? (ph < duty * 24 ? 1 : -1) : Math.cos((2 * Math.PI * ph) / 24);
		t.push(i);
		y.push(10 + amp * v + gauss(r));
	}
	return { t, y };
}
const FIXED = { periodic: true, fixPeriod: true, fixedPeriod: 24 };

/** A fit result with the given rates, period and R squared. */
const res = (k1, k2, rSquared = 0.9, T = 24) => ({
	parameters: { M: 0, A: 1, k1, t1: 6, k2, t2: 18, T },
	dutyCycle: 0.5,
	rSquared
});

describe('doubleLogisticReliability', () => {
	it('the edge time is the 10% to 90% time of a logistic, 2 ln 9 / k', () => {
		expect(DL_EDGE_TIME_PER_RATE).toBeCloseTo(2 * Math.log(9), 15);
		const k = 1.3;
		const s = (x) => 1 / (1 + Math.exp(-x));
		const t10 = Math.log(1 / 9) / k;
		const t90 = Math.log(9) / k;
		expect(s(k * t10)).toBeCloseTo(0.1, 12);
		expect(s(k * t90)).toBeCloseTo(0.9, 12);
		expect(t90 - t10).toBeCloseTo(DL_EDGE_TIME_PER_RATE / k, 12);
	});

	it('shallow when the rise and fall together take longer than one period', () => {
		// Each edge exactly half the period: the sum is the period, not over it.
		const kHalf = DL_EDGE_TIME_PER_RATE / 12;
		expect(DL_MAX_EDGE_FRACTION).toBe(1);
		expect(doubleLogisticReliability(res(kHalf, kHalf)).shallow).toBe(false);
		expect(doubleLogisticReliability(res(kHalf * 0.99, kHalf)).shallow).toBe(true);
		expect(doubleLogisticReliability(res(kHalf * 0.99, kHalf)).edgeHours).toBeCloseTo(
			12 / 0.99 + 12,
			10
		);
		// One very shallow edge is enough.
		expect(doubleLogisticReliability(res(50, 0.1)).shallow).toBe(true);
		expect(doubleLogisticReliability(res(5, 5)).shallow).toBe(false);
	});

	it('weak when R squared is below 0.3 or the permutation p is not significant', () => {
		expect(DL_MIN_R2).toBe(0.3);
		expect(doubleLogisticReliability(res(5, 5, 0.3)).weak).toBe(false);
		expect(doubleLogisticReliability(res(5, 5, 0.29)).weak).toBe(true);
		expect(doubleLogisticReliability(res(5, 5, 0.9), { pValue: 0.2 }).weak).toBe(true);
		expect(doubleLogisticReliability(res(5, 5, 0.9), { pValue: 0.01 }).weak).toBe(false);
		// A permutation test that did not run says nothing.
		expect(doubleLogisticReliability(res(5, 5, 0.9), { pValue: NaN }).weak).toBe(false);
	});

	it('a non-periodic fit has no period to compare with: only the weak rule applies', () => {
		// Even with a T present (it is ignored), and with no T at all.
		expect(doubleLogisticReliability(res(0.01, 0.01, 0.9, 24), { periodic: false }).shallow).toBe(
			false
		);
		const r = res(0.01, 0.01, 0.9, null);
		expect(doubleLogisticReliability(r, { periodic: false }).shallow).toBe(false);
		expect(doubleLogisticReliability(res(0.01, 0.01, 0.1, null), { periodic: false }).weak).toBe(
			true
		);
	});

	it('no result or non-finite numbers: no verdict, no warning', () => {
		expect(doubleLogisticReliability(null)).toBeNull();
		expect(doubleLogisticReliabilityWarnings([{ label: '"y"', result: null }])).toEqual([]);
	});
});

describe('doubleLogisticReliabilityWarnings', () => {
	it('words each case plainly and names the series', () => {
		const [shallow] = doubleLogisticReliabilityWarnings([{ label: '"a"', result: res(0.3, 0.3) }]);
		expect(shallow).toContain('"a"');
		expect(shallow).toContain('The rise and fall are too gradual to pin down the active period');
		expect(shallow).toContain('treat the duty cycle and the onset and offset as unreliable');
		expect(shallow).toContain('29.3 h'); // 2 * 2 ln 9 / 0.3
		expect(shallow).toContain('24 h');
		const [weak] = doubleLogisticReliabilityWarnings([{ label: '"b"', result: res(5, 5, 0.12) }]);
		expect(weak).toContain('"b"');
		expect(weak).toContain('The rhythm is too weak to pin down the active period');
		expect(weak).toContain('R² 0.12');
		const [both] = doubleLogisticReliabilityWarnings([
			{ label: '"c"', result: res(0.3, 0.3, 0.1), pValue: 0.4 }
		]);
		expect(both).toContain('too gradual');
		expect(both).toContain('weak');
		expect(both).toContain('permutation p 0.4');
		expect(doubleLogisticReliabilityWarnings([{ label: '"d"', result: res(5, 5) }])).toEqual([]);
		// The unit follows x.
		const [u] = doubleLogisticReliabilityWarnings([{ label: '"e"', result: res(0.3, 0.3) }], {
			unit: 'x units'
		});
		expect(u).toContain('29.3 x units');
	});

	it('does not touch the fit', () => {
		const d = wave(1, { amp: 0.5 });
		const f = fitDoubleLogistic(d.t, d.y, FIXED);
		const before = JSON.stringify(f);
		doubleLogisticReliabilityWarnings([{ label: '"y"', result: f }]);
		expect(JSON.stringify(f)).toBe(before);
	});
});

/**
 * The thresholds come from a sweep (2026-11-01, 1,920 periodic fits, hourly for 7 days, 12
 * seeds per cell): square, logistic-edged (k 2, 1, 0.5) and cosine truths; half-amplitude to
 * noise SD 4, 2, 1, 0.5; duty 0.5 and 0.25; period fixed at 24 h and free. Taking a duty error
 * under 0.05 as a good fit and over 0.1 as a bad one (cosine truths left out, having no duty):
 *  - rise + fall > 1 period flags 72% of bad fits, 3.6% of good fits at SNR >= 2 and 8.0% of all
 *    good fits; R² < 0.3 flags 58% of bad fits and none of the good fits at SNR >= 2;
 *  - together they flag 93% of bad fits, 3.6% of good fits at SNR >= 2 and 10.7% of all good
 *    fits (the rest are weak fits whose duty came out near the truth by chance).
 * The guards below are the clean cases at the ends of that range.
 */
describe('on real fits', { timeout: 60000 }, () => {
	it('strong square waves (SNR 4, fixed period, 10 seeds): no warning', () => {
		for (let s = 1; s <= 10; s++) {
			const d = wave(s, { amp: 4, onset: 3 + s });
			const f = fitDoubleLogistic(d.t, d.y, FIXED);
			expect(doubleLogisticReliabilityWarnings([{ label: '"y"', result: f }])).toEqual([]);
		}
	});

	it('weak square waves (SNR 0.5, fixed period): most warn, and the warned fits have bad duty', () => {
		let warned = 0;
		for (let s = 1; s <= 10; s++) {
			const d = wave(s, { amp: 0.5, onset: 3 + s });
			const f = fitDoubleLogistic(d.t, d.y, FIXED);
			if (doubleLogisticReliabilityWarnings([{ label: '"y"', result: f }]).length) warned++;
		}
		expect(warned).toBeGreaterThanOrEqual(8);
	});

	it('a cosine (no plateaus) fitted at SNR 4 is flagged as too gradual', () => {
		const d = wave(2, { amp: 4, shape: 'cosine' });
		const f = fitDoubleLogistic(d.t, d.y, FIXED);
		const v = doubleLogisticReliability(f);
		expect(f.rSquared).toBeGreaterThan(0.8);
		expect(v.shallow).toBe(true);
		expect(v.weak).toBe(false);
	});
});

describe('rollingDoubleLogisticWarning', () => {
	const kShallow = 0.3; // 29.3 h of edges against a 24 h period
	it('counts flagged windows among the fitted ones, with the reasons', () => {
		const stats = {
			k1: [5, kShallow, 5, kShallow, NaN],
			k2: [5, kShallow, 5, kShallow, NaN],
			r2: [0.9, 0.9, 0.1, 0.1, NaN],
			period: [24, 24, 24, 24, NaN]
		};
		const w = rollingDoubleLogisticWarning(stats, { label: 'y' });
		expect(w).toContain('in 3 of 4 fitted windows for y');
		expect(w).toContain('2 with the rise and fall together longer than the cycle');
		expect(w).toContain('2 with R² below 0.3');
	});
	it('a fixed period is used when the period stat is absent; non-periodic has no shallow rule', () => {
		const stats = { k1: [kShallow], k2: [kShallow], r2: [0.9] };
		expect(rollingDoubleLogisticWarning(stats, { fixedPeriod: 24 })).toContain(
			'1 of 1 fitted window '
		);
		expect(rollingDoubleLogisticWarning(stats, { periodic: false })).toBeNull();
		expect(rollingDoubleLogisticWarning({ k1: [5], k2: [5], r2: [0.9], period: [24] })).toBeNull();
	});
});
