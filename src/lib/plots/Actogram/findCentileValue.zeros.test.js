// @ts-nocheck
/**
 * FIT-U6 (2026-10-03 review, "possible issues, not confirmed"): findCentileValue leaves zeros
 * out of the threshold percentile. Verdict (2026-10-28): CONFIRMED and intended, now
 * documented in onsetUnwrap.js and already in the handbook (Ch05, "the percentile of the
 * non-zero activity in its row and the next"). Why it matters, measured on seeded bout-style
 * wheel-running data (0.1 h bins, 10 days, active 12 h from 06:00, 10 seeds):
 *  - With zeros counted, any record that is more than centile% zeros gets a threshold of 0,
 *    so the % control does nothing: 20, 50 and 80 gave identical markers on sparse records
 *    (active bins 30% non-zero, rest 10%). Without zeros the control still sets how intense a
 *    bin must be to count as active.
 *  - Neither rule is better everywhere. At 50% (the default) the non-zero rule put 9 of 100
 *    onsets more than 1 h off on dense data (60% of active bins non-zero, rest 5%) against 6
 *    with zeros, but 4 against 17 when the rest phase has frequent small counts.
 * A side effect: on two-level data (0 and one active level, e.g. 0/1 scored sleep-wake or
 * beam breaks) the threshold IS the active level and nothing is above it. The template match
 * was then flat and every marker landed N hours into the window whatever the true onset (all
 * 10 days 3 h off in the case below). Since 2026-10-28 such a window reports no marker.
 */
import { describe, it, expect } from 'vitest';
import { findCentileValue, matchTemplateMarkers } from './onsetUnwrap.js';

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

/** Sparse counts: active 12 h from 06:00, bouts with probability pActive / pRest per bin. */
function sparseRow(seed, { pActive = 0.3, pRest = 0.1, bin = 0.1 } = {}) {
	const r = rng(seed);
	const y = [];
	for (let t = 0; t < 48 - 1e-9; t += bin) {
		const ph = (((t - 6) % 24) + 24) % 24;
		const p = ph < 12 ? pActive : pRest;
		y.push(r() < p ? Math.round(5 + 30 * r()) : 0);
	}
	return y;
}

/** The rule with zeros counted, for comparison only. */
function centileWithZeros(data, centile) {
	const s = data.filter((v) => !isNaN(v)).sort((a, b) => a - b);
	return s[Math.ceil((centile / 100) * s.length) - 1];
}

describe('FIT-U6: findCentileValue ignores zeros', { timeout: 120000 }, () => {
	it('takes the percentile of the non-zero, non-NaN values only', () => {
		expect(findCentileValue([0, 0, 0, 0, 0, 0, 2, 4, 6, 8], 50)).toBe(4);
		expect(findCentileValue([0, 0, NaN, 0, 3, 1, 2], 100)).toBe(3);
		expect(findCentileValue([0, 0, 0], 50)).toBeUndefined(); // nothing non-zero
	});

	it('keeps the % control meaningful on sparse records (zeros counted would pin it at 0)', () => {
		const y = sparseRow(3);
		expect(y.filter((v) => v === 0).length / y.length).toBeGreaterThan(0.8);
		const withZeros = [20, 50, 80].map((c) => centileWithZeros(y, c));
		const nonZero = [20, 50, 80].map((c) => findCentileValue(y, c));
		expect(withZeros).toEqual([0, 0, 0]);
		expect(nonZero[0]).toBeLessThan(nonZero[1]);
		expect(nonZero[1]).toBeLessThan(nonZero[2]);
	});

	function twoLevel(level = 1) {
		const xByPeriod = {};
		const yByPeriod = {};
		for (let t = 0; t < 240; t += 0.25) {
			const ph = (((t - 6) % 24) + 24) % 24;
			const p = Math.floor(t / 24);
			(xByPeriod[p] ||= []).push(t);
			(yByPeriod[p] ||= []).push(ph < 12 ? level : 0);
		}
		return { xByPeriod, yByPeriod };
	}
	const opts = { periodHrs: 24, binSize: 0.25, hrsBefore: 3, hrsAfter: 3, centile: 50 };

	for (const type of ['onset', 'offset']) {
		it(`on 0 / 1 data no bin is above the threshold, so there is no ${type} marker (not a made-up one)`, () => {
			const { xByPeriod, yByPeriod } = twoLevel();
			expect(findCentileValue(yByPeriod[0], 50)).toBe(1); // the only non-zero level
			const { hours, times } = matchTemplateMarkers(xByPeriod, yByPeriod, { ...opts, type });
			expect(hours).toHaveLength(10);
			expect(hours.every(Number.isNaN)).toBe(true);
			expect(times.every(Number.isNaN)).toBe(true);
		});
	}

	it('the same holds for one active level other than 1, and for every centile', () => {
		const { xByPeriod, yByPeriod } = twoLevel(7);
		for (const centile of [10, 50, 90]) {
			const { hours } = matchTemplateMarkers(xByPeriod, yByPeriod, {
				...opts,
				centile,
				type: 'onset'
			});
			expect(hours.every(Number.isNaN)).toBe(true);
		}
	});
});
