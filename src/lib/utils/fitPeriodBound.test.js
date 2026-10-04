// @ts-nocheck
/**
 * Review findings FIT-1 and FIT-2 (2026-10-03) for the rectangular-wave and double-logistic
 * fits. Data and RNGs are the reviewer's (scratchpad/review/fitting/rw2.mjs, dl2.mjs).
 *
 * FIT-1: the free period had no bound; trend plus noise with no rhythm fitted 2,243 h
 * (rectangular wave) and 111 h (double logistic), each with R squared 0.965, silently.
 * FIT-2: the periodic double logistic let t2 - t1 exceed T, so tiles overlapped and the
 * baseline M absorbed the overlap: 16 of 48 activity phases reported M near -30 for a
 * true baseline of 5.
 */
import { describe, it, expect } from 'vitest';
import { fitRectangularWave, rectWaveFitWarnings } from './rectwave.js';
import { fitDoubleLogistic, doubleLogisticFitWarnings } from './doublelogistic.js';
import { FREE_PERIOD_DEFAULTS } from './cosinor.js';

function lcg(seed) {
	let s = seed;
	const rnd = () => {
		s = (1103515245 * s + 12345) % 2147483648;
		return s / 2147483648;
	};
	const gauss = () => {
		const u = rnd() || 1e-12;
		const v = rnd();
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
	};
	return { rnd, gauss };
}

/** The reviewer's no-rhythm record: y = 0.1 t + N(0, 1), hourly for 7 days. */
function trendNoise() {
	const { rnd, gauss } = lcg(23);
	// rw2.mjs drew 40 square-wave records (each 2 * 336 normals + 1 uniform) first.
	for (let k = 0; k < 40; k++) {
		rnd();
		for (let i = 0; i < 7 * 24 * 2; i++) gauss();
	}
	const t = [];
	const y = [];
	for (let i = 0; i < 7 * 24; i++) {
		t.push(i);
		y.push(0.1 * i + gauss());
	}
	return { t, y };
}

/** A slow square wave (150 h, levels 5 and 15): the best period lies past the 48 h bound. */
function slowWave() {
	const t = [];
	const y = [];
	for (let i = 0; i < 10 * 24; i++) {
		t.push(i);
		y.push((i % 150) / 150 < 0.5 ? 15 : 5);
	}
	return { t, y };
}

describe('FIT-1: free period bounded, seeded and diagnosed', () => {
	it('trend + noise: the rectangular wave no longer runs to thousands of hours', () => {
		const { t, y } = trendNoise();
		const r = fitRectangularWave(t, y, {});
		expect(r.period).toBeGreaterThanOrEqual(FREE_PERIOD_DEFAULTS.minPeriod);
		expect(r.period).toBeLessThanOrEqual(FREE_PERIOD_DEFAULTS.maxPeriod); // was 2,243 h
		expect(r.rSquared).toBeLessThan(0.2); // was 0.965: nothing rhythmic is explained
		expect(r.diagnostics.periodRange).toEqual([2, 48]); // Nyquist (2 h) to 48 h
	});

	it('trend + noise: the double logistic no longer fits a 111 h period', () => {
		const { t, y } = trendNoise();
		const d = fitDoubleLogistic(t, y, { periodic: true });
		expect(d.parameters.T).toBeLessThanOrEqual(FREE_PERIOD_DEFAULTS.maxPeriod);
		expect(d.rSquared).toBeLessThan(0.2);
	});

	it('a period pinned on the bound is flagged with the cosinor warning (both models)', () => {
		const { t, y } = slowWave();
		const r = fitRectangularWave(t, y, {});
		expect(r.period).toBeCloseTo(48, 6);
		expect(r.diagnostics.atBound).toEqual(['max']);
		const wr = rectWaveFitWarnings([{ label: '"y"', result: r }]);
		expect(wr).toHaveLength(1);
		expect(wr[0]).toMatch(/rectangular-wave fit for "y" stopped at the upper limit/);
		const d = fitDoubleLogistic(t, y, { periodic: true });
		expect(d.parameters.T).toBeCloseTo(48, 6);
		expect(d.diagnostics.atBound).toEqual(['max']);
		expect(doubleLogisticFitWarnings([{ label: '"y"', result: d }])[0]).toMatch(
			/double-logistic fit for "y" stopped at the upper limit/
		);
	});

	it('honours a user range, and a wide enough range recovers the slow period', () => {
		const { t, y } = slowWave();
		const r = fitRectangularWave(t, y, { minPeriod: 50, maxPeriod: 200 });
		expect(r.period).toBeGreaterThan(145);
		expect(r.period).toBeLessThan(155);
		expect(r.diagnostics.atBound).toEqual([null]);
		expect(rectWaveFitWarnings([{ result: r }])).toEqual([]);
	});

	it('an empty range returns null (the node says why)', () => {
		const { t, y } = slowWave();
		expect(fitRectangularWave(t, y, { minPeriod: 30, maxPeriod: 20 })).toBeNull();
		expect(fitDoubleLogistic(t, y, { periodic: true, minPeriod: 30, maxPeriod: 20 })).toBeNull();
	});

	it('an optimiser that runs out of iterations is reported as not converged', () => {
		const { t, y } = trendNoise();
		const r = fitRectangularWave(t, y, { maxIterations: 2 });
		expect(r.diagnostics.converged).toBe(false);
		expect(rectWaveFitWarnings([{ result: r }])[0]).toMatch(/did not converge \(2 iterations\)/);
		const d = fitDoubleLogistic(t, y, { periodic: true, maxIterations: 2 });
		expect(d.diagnostics.converged).toBe(false);
		expect(doubleLogisticFitWarnings([{ result: d }])[0]).toMatch(/did not converge/);
	});

	it('fixed-period fits carry no range and never warn about it', () => {
		const { t, y } = slowWave();
		const r = fitRectangularWave(t, y, { fixOmega: true, fixedOmega: (2 * Math.PI) / 24 });
		expect(r.diagnostics.periodRange).toBeNull();
		expect(r.diagnostics.atBound).toEqual([null]);
		const d = fitDoubleLogistic(t, y, { periodic: true, fixPeriod: true, fixedPeriod: 24 });
		expect(d.diagnostics.periodRange).toBeNull();
	});

	it('moderate-SNR square waves still recover 24 h from periodogram-seeded starts', () => {
		// rw2.mjs's first block: 40 records, duty 0.35, levels 5 / 20, noise SD 10.
		const { rnd, gauss } = lcg(23);
		const periods = [];
		for (let k = 0; k < 40; k++) {
			const t = [];
			const y = [];
			const on = 24 * rnd();
			for (let i = 0; i < 7 * 24 * 2; i++) {
				const ti = i / 2;
				const ph = (((ti - on) % 24) + 24) % 24;
				t.push(ti);
				y.push((ph < 0.35 * 24 ? 20 : 5) + 10 * gauss());
			}
			const r = fitRectangularWave(t, y, {});
			expect(r.parameters.A).toBeGreaterThan(0); // canonical form
			periods.push(r.period);
		}
		for (const p of periods) expect(Math.abs(p - 24)).toBeLessThan(0.5);
	});
});

describe('FIT-2: periodic double logistic baseline across all activity phases', () => {
	it("reports M near the true baseline for every one of the reviewer's 48 onsets", () => {
		const { rnd, gauss } = lcg(77);
		void rnd;
		const bad = [];
		for (let k = 0; k < 48; k++) {
			const on = k / 2;
			const t = [];
			const y = [];
			for (let i = 0; i < 7 * 24 * 4; i++) {
				const ti = i / 4;
				const ph = (((ti - on) % 24) + 24) % 24;
				t.push(ti);
				y.push((ph < 12 ? 40 : 5) + 4 * gauss());
			}
			const r = fitDoubleLogistic(t, y, { periodic: true, fixPeriod: true, fixedPeriod: 24 });
			const { M, A, T } = r.parameters;
			// Was M = -29.5 to -31 (once -169.6) for onsets 14 to 22.5 h.
			if (Math.abs(M - 5) > 1 || Math.abs(A - 35) > 2) bad.push(`${on}: M ${M}, A ${A}`);
			expect(r.duration).toBeGreaterThan(0);
			expect(r.duration).toBeLessThan(T);
			expect(r.dutyCycle).toBeCloseTo(0.5, 1);
			let onErr = Math.abs(r.onsetPhase - on);
			onErr = Math.min(onErr, 24 - onErr);
			expect(onErr).toBeLessThan(0.5);
		}
		expect(bad).toEqual([]);
	}, 30000);

	it('the onset-18 example: M 5 not -30.8, duration 12 not 36.1', () => {
		const { gauss } = lcg(31);
		// dl.mjs order: [6,18], [20,8] then [18,6]; burn the first two records.
		for (let k = 0; k < 2 * 7 * 24 * 4; k++) gauss();
		const t = [];
		const y = [];
		for (let i = 0; i < 7 * 24 * 4; i++) {
			const ti = i / 4;
			const ph = (((ti - 18) % 24) + 24) % 24;
			t.push(ti);
			y.push((ph < 12 ? 40 : 5) + 4 * gauss());
		}
		const r = fitDoubleLogistic(t, y, { periodic: true, fixPeriod: true, fixedPeriod: 24 });
		expect(r.parameters.M).toBeCloseTo(5, 0);
		expect(r.duration).toBeCloseTo(12, 0);
		expect(r.onsetPhase).toBeCloseTo(18, 0);
		expect(r.offsetPhase).toBeCloseTo(6, 0);
	});
});

describe('FIT-2: canonical A >= 0 form of the periodic double logistic', () => {
	it('a negative-A vector becomes the same curve with A > 0, M the rest level', async () => {
		const { canonicalPeriodicParams, evaluateDoubleLogisticAtPoints } =
			await import('./doublelogistic.js');
		// A dip: level 40 with a 4 h drop to 5 starting at t = 10, written with A < 0.
		const neg = [40, -35, 2, 10, 1.5, 14, 24];
		const pos = canonicalPeriodicParams(neg);
		expect(pos).toEqual([5, 35, 1.5, 14, 2, 34, 24]);
		const asObj = ([M, A, k1, t1, k2, t2, T]) => ({ M, A, k1, t1, k2, t2, T });
		const ts = Array.from({ length: 200 }, (_, i) => i * 0.6);
		const a = evaluateDoubleLogisticAtPoints(asObj(neg), true, ts);
		const b = evaluateDoubleLogisticAtPoints(asObj(pos), true, ts);
		for (let i = 0; i < ts.length; i++) expect(b[i]).toBeCloseTo(a[i], 9);
		// Already canonical: unchanged.
		expect(canonicalPeriodicParams(pos)).toBe(pos);
	});
});
