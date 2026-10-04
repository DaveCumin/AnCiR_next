// @ts-nocheck
/**
 * Review findings SPEC-5 and FIT-10 (2026-10-03): the harmonic check exported tau / 2 for
 * bimodal activity (12 h from a correctly fitted 24 h line) and for short daily bouts,
 * because any two-bout or narrow-pulse waveform has as much Lomb-Scargle power at tau / 2.
 * Decision 2b stands (the tau port IS the check's pick); the fix is a margin: an alternative
 * must be supported by a half-cycle F-test (harmonicCheck.js header). Cases and RNGs are the
 * reviewers' (scratchpad/review/spectral/e12_harm.mjs, scratchpad/review/fitting/hc.mjs).
 * The genuine switches (tau fixed at 12.3 h and 47 h on the rest-activity demo) are pinned in
 * harmonicCheck.pin.svelte.test.js and must still switch.
 */
import { describe, it, expect } from 'vitest';
import { harmonicCheck, halfCycleTest } from './harmonicCheck.js';
import { tauReadout } from './tauReadout.js';

/** The spectral reviewer's RNG (common.mjs). */
function mulberry(seed) {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** e12_harm.mjs: morning bout ZT23-2 of size M, evening bout of 1 starting at ZT`sep`. */
function bimodal(M, sep) {
	const r = mulberry(4);
	const x = [];
	const y = [];
	for (let i = 0; i < 480; i++) {
		const t = i * 0.5;
		const ph = t % 24;
		let v = 0.2 * r();
		if (ph < 2 || ph >= 23) v += M;
		if (ph >= sep && ph < sep + 3) v += 1;
		x.push(t);
		y.push(v);
	}
	return { xData: x, yData: y, binSize: 0.5, tau: 24 };
}

describe('SPEC-5: bimodal activity keeps the fitted 24 h', () => {
	for (const [M, sep, powers] of [
		[0.6, 11, 'tau 8.8 vs tau/2 115.4'],
		[0.8, 11, 'tau 1.9 vs tau/2 124.0'],
		[0.6, 9, 'tau 19.2 vs tau/2 87.6'],
		[0, 11, 'single 3 h bout: tau 63.7 vs tau/2 51.6']
	]) {
		it(`morning ${M}x evening, evening at ZT${sep} (${powers}) -> 24 h`, () => {
			const h = harmonicCheck(bimodal(M, sep));
			expect(h.strongest.label).toBe('τ');
			expect(h.strongest.peakPeriod).toBe(24);
			const half = h.candidates.find((c) => c.label === 'τ/2');
			// The halves of a 24 h day differ, so 12 h is not eligible.
			expect(half.eligible).toBe(false);
			expect(half.test.pValue).toBeLessThan(0.05);
		});
	}

	it('the old power-only pick is still reported, and was tau / 2 for the 0.6x case', () => {
		const h = harmonicCheck(bimodal(0.6, 11));
		expect(h.powerStrongest.label).toBe('τ/2');
		expect(h.candidates.find((c) => c.label === 'τ').power).toBeCloseTo(8.8, 1);
		expect(h.candidates.find((c) => c.label === 'τ/2').power).toBeCloseTo(115.4, 1);
	});

	it('two EQUAL bouts exactly 12 h apart are a 12 h rhythm, and do switch', () => {
		const h = harmonicCheck(bimodal(1, 11));
		expect(h.strongest.label).toBe('τ/2');
		expect(h.strongest.peakPeriod).toBe(12);
	});
});

describe('FIT-10: short daily bouts keep tau', () => {
	// hc.mjs: rectangular activity, tau 24.5, 14 days at 0.1 h, 20 records per duty cycle.
	it('tau is picked 20 of 20 times at every duty cycle down to 0.04 (was 14 of 20)', () => {
		let s = 21;
		const rnd = () => {
			s = (1103515245 * s + 12345) % 2147483648;
			return s / 2147483648;
		};
		for (const d of [0.5, 0.3, 0.15, 0.08, 0.04]) {
			const picks = {};
			for (let k = 0; k < 20; k++) {
				const x = [];
				const y = [];
				const tau = 24.5;
				const bin = 0.1;
				for (let i = 0; i < (14 * 24) / bin; i++) {
					const t = i * bin;
					const ph = ((((t - 3) % tau) + tau) % tau) / tau;
					y.push((ph < d ? 50 : 0) + 5 * rnd());
					x.push(t);
				}
				const r = harmonicCheck({ xData: x, yData: y, binSize: 0.1, tau: 24.5 });
				picks[r.strongest.label] = (picks[r.strongest.label] ?? 0) + 1;
			}
			expect(picks, `duty ${d}`).toEqual({ τ: 20 });
		}
	}, 60000);
});

describe('genuine harmonics still switch', () => {
	function wave(period, slope, active) {
		const r = mulberry(8);
		const x = [];
		const y = [];
		for (let i = 0; i < 480; i++) {
			const t = i * 0.5;
			x.push(t);
			y.push((t % period < active ? 1 : 0) + 0.2 * r());
		}
		return { xData: x, yData: y, binSize: 0.5, tau: slope };
	}
	it('a 12 h rhythm under a 24 h line reports 12 h', () => {
		const h = harmonicCheck(wave(12, 24, 3));
		expect(h.strongest.label).toBe('τ/2');
		expect(h.strongest.peakPeriod).toBe(12);
	});
	it('a 24 h rhythm under a 12 h line reports 24 h', () => {
		const h = harmonicCheck(wave(24, 12, 6));
		expect(h.strongest.label).toBe('2τ');
		expect(h.strongest.peakPeriod).toBe(24);
	});
	it('2 tau needs alternate cycles to differ: a clean 24 h rhythm under a 24 h line keeps 24', () => {
		const h = harmonicCheck(wave(24, 24, 6));
		expect(h.strongest.label).toBe('τ');
		const dbl = h.candidates.find((c) => c.label === '2τ');
		expect(dbl.eligible).toBe(false);
	});
});

describe('halfCycleTest', () => {
	it('is the nested F-test of the odd harmonics (exact on a constructed case)', () => {
		// y = cos(2 pi t / 24) has nothing at 12 h: its 24 h halves are mirror images, F huge.
		const x = Array.from({ length: 96 }, (_, i) => i);
		const y = x.map((t) => Math.cos((2 * Math.PI * t) / 24) + 0.01 * Math.sin(t * 7.3));
		const r = halfCycleTest(x, y, 24, 1);
		expect(r.harmonics).toBe(6);
		expect(r.df1).toBe(6);
		expect(r.df2).toBe(96 - 1 - 12);
		expect(r.pValue).toBeLessThan(1e-10);
		// y = cos(2 pi t / 12) is periodic in 12 h: the halves agree, F near 0.
		const y2 = x.map((t) => Math.cos((2 * Math.PI * t) / 12) + 0.01 * Math.sin(t * 7.3));
		expect(halfCycleTest(x, y2, 24, 1).pValue).toBeGreaterThan(0.05);
	});
	it('skips missing samples and returns null with too few points', () => {
		expect(halfCycleTest([0, 1, 2], [1, 2, 3], 24, 1)).toBeNull();
		const x = Array.from({ length: 96 }, (_, i) => i);
		const y = x.map((t) => (t % 10 === 0 ? null : Math.cos((2 * Math.PI * t) / 24)));
		expect(halfCycleTest(x, y, 24, 1).df2).toBe(96 - 10 - 1 - 12);
	});
});

describe('tauReadout tooltip explains the margin', () => {
	const block = (hc, slope) => ({
		fittedSlope: slope,
		harmonicCheck: hc,
		linearRegression: { slope, intercept: 0, rSquared: 0.5, rmse: 0.3 },
		fitPoints: { xs: [1, 2, 3] },
		estimatedPhase: { phase: 6 },
		isInstance: true
	});
	it('when the margin keeps the slope against more power at tau / 2', () => {
		const t = tauReadout(block(harmonicCheck(bimodal(0.6, 11)), 24));
		expect(t.tau).toBe(24);
		expect(t.disagree).toBe(false);
		expect(t.note).toMatch(/more power at 12\.00 h \(τ\/2\)/);
		expect(t.note).toMatch(/keeps the slope/);
		expect(t.note).toMatch(/two halves of each τ cycle differ significantly \(p < 0\.001\)/);
	});
	it('when the check switches, the note gives the test that allowed it', () => {
		const r = mulberry(8);
		const x = [];
		const y = [];
		for (let i = 0; i < 480; i++) {
			x.push(i * 0.5);
			y.push(((i * 0.5) % 12 < 3 ? 1 : 0) + 0.2 * r());
		}
		const t = tauReadout(block(harmonicCheck({ xData: x, yData: y, binSize: 0.5, tau: 24 }), 24));
		expect(t.disagree).toBe(true);
		expect(t.tau).toBe(12);
		expect(t.note).toMatch(/do not differ significantly \(p = 0\.\d{3}\)/);
		expect(t.note).toMatch(/The rule's τ output reports the harmonic check, 12\.00 h\./);
	});
	it('no note when tau wins on power too', () => {
		const t = tauReadout(block(harmonicCheck(bimodal(0, 11)), 24));
		expect(t.note).toBe('');
	});
});
