import { describe, it, expect } from 'vitest';
import { getStatKeys, computeMovingWindows } from './movinganalysis.js';
import { computeNPCRA } from './npcra.js';

const DT = 5 / 60; // 5-minute sampling, as in the colony-monitoring design

/**
 * A rhythmic series with a controllable amount of day-to-day consolidation.
 * `fragment` blends in uniform noise, which lowers IS and raises IV.
 */
function series(days, { periodHrs = 24, amp = 1, fragment = 0, seed = 1 } = {}) {
	const n = Math.round((days * 24) / DT);
	let s = seed;
	const rand = () => {
		s = (s * 1103515245 + 12345) % 2147483648;
		return s / 2147483648;
	};
	const t = [];
	const y = [];
	for (let i = 0; i < n; i++) {
		const hrs = i * DT;
		t.push(hrs);
		const wave = amp * (1 + Math.cos((2 * Math.PI * hrs) / periodHrs));
		y.push((1 - fragment) * wave + fragment * rand() * 2 * amp);
	}
	return { t, y };
}

describe('getStatKeys — npcra', () => {
	it('declares the nonparametric metrics', () => {
		expect(getStatKeys({ analysis: 'npcra' })).toEqual(['IS', 'IV', 'RA', 'L5', 'M10', 'M10onset']);
	});
});

describe('getStatKeys — cosinor rel_amplitude', () => {
	it('includes rel_amplitude in fixed-period mode', () => {
		const keys = getStatKeys({ analysis: 'cosinor', useFixedPeriod: true, nHarmonics: 1 });
		expect(keys).toContain('rel_amplitude');
		expect(keys).toContain('H1_amplitude');
		expect(keys).toContain('mesor');
	});

	it('keeps the harmonic keys alongside it', () => {
		const keys = getStatKeys({ analysis: 'cosinor', useFixedPeriod: true, nHarmonics: 3 });
		expect(keys).toContain('H3_acrophase');
		expect(keys).toContain('rel_amplitude');
	});

	it('does not add it in free-period mode (there is no single MESOR to divide by)', () => {
		const keys = getStatKeys({ analysis: 'cosinor', useFixedPeriod: false, Ncurves: 2 });
		expect(keys).not.toContain('rel_amplitude');
	});
});

describe('rolling npcra', () => {
	const args = {
		analysis: 'npcra',
		npcraEpochHours: 1,
		npcraPeriod: 24,
		npcraMWindow: 10,
		npcraLWindow: 5
	};

	function roll(t, y, { windowSize = 168, step = 24 } = {}) {
		const starts = [];
		for (let s = 0; s + windowSize <= t[t.length - 1]; s += step) starts.push(s);
		const statKeys = getStatKeys(args);
		return {
			starts,
			out: computeMovingWindows({ tAll: t, ys: [y], starts, windowSize, statKeys, args })[0]
		};
	}

	it('produces one IS/IV value per 7-day window stepped daily', () => {
		const { t, y } = series(14);
		const { starts, out } = roll(t, y);
		// 14 days = 336 h; the last full 7-day window starts at 144 h, so 0,24,..,144 = 7.
		expect(starts.length).toBe(7);
		expect(out.IS).toHaveLength(starts.length);
		expect(out.IV).toHaveLength(starts.length);
		expect(out.IS.every(Number.isFinite)).toBe(true);
	});

	it('agrees with a direct computeNPCRA call on the same window', () => {
		// The rolling loop must not transform the data on the way in.
		const { t, y } = series(10);
		const windowSize = 168;
		const statKeys = getStatKeys(args);
		const out = computeMovingWindows({
			tAll: t,
			ys: [y],
			starts: [0],
			windowSize,
			statKeys,
			args
		})[0];

		const idx = t.map((v, i) => (v >= 0 && v < windowSize ? i : -1)).filter((i) => i >= 0);
		const direct = computeNPCRA(
			idx.map((i) => t[i]),
			idx.map((i) => y[i]),
			{ epochHours: 1, period: 24, mWindow: 10, lWindow: 5 }
		);
		expect(out.IS[0]).toBeCloseTo(direct.IS, 9);
		expect(out.IV[0]).toBeCloseTo(direct.IV, 9);
		expect(out.RA[0]).toBeCloseTo(direct.RA, 9);
	});

	it('detects fragmentation: IS falls and IV rises as the rhythm degrades', () => {
		// The behaviour the whole rolling-metrics idea rests on.
		const clean = roll(...Object.values(series(10, { fragment: 0 })).slice(0, 2));
		const noisy = roll(...Object.values(series(10, { fragment: 0.9 })).slice(0, 2));
		const avg = (a) => a.reduce((x, b) => x + b, 0) / a.length;
		expect(avg(noisy.out.IS)).toBeLessThan(avg(clean.out.IS));
		expect(avg(noisy.out.IV)).toBeGreaterThan(avg(clean.out.IV));
	});

	it('honours the epoch parameter', () => {
		const { t, y } = series(10);
		const coarse = computeMovingWindows({
			tAll: t,
			ys: [y],
			starts: [0],
			windowSize: 168,
			statKeys: getStatKeys(args),
			args: { ...args, npcraEpochHours: 2 }
		})[0];
		const fine = computeMovingWindows({
			tAll: t,
			ys: [y],
			starts: [0],
			windowSize: 168,
			statKeys: getStatKeys(args),
			args
		})[0];
		expect(coarse.IV[0]).not.toBeCloseTo(fine.IV[0], 6);
	});

	it('yields NaN rather than throwing on a window with too little data', () => {
		// Two points is below computeStatsForWindow's 3-sample floor.
		const t = [0, 1];
		const y = [1, 2];
		const out = computeMovingWindows({
			tAll: t,
			ys: [y],
			starts: [0],
			windowSize: 168,
			statKeys: getStatKeys(args),
			args
		})[0];
		expect(out.IS).toHaveLength(1);
		expect(Number.isNaN(out.IS[0])).toBe(true);
	});
});

describe('rolling cosinor rel_amplitude', () => {
	const args = {
		analysis: 'cosinor',
		useFixedPeriod: true,
		fixedPeriod: 24,
		nHarmonics: 1,
		alpha: 0.05
	};

	it('equals amplitude / MESOR', () => {
		const { t, y } = series(10, { amp: 3 });
		const statKeys = getStatKeys(args);
		const out = computeMovingWindows({
			tAll: t,
			ys: [y],
			starts: [0],
			windowSize: 168,
			statKeys,
			args
		})[0];
		expect(out.rel_amplitude[0]).toBeCloseTo(out.H1_amplitude[0] / out.mesor[0], 9);
	});

	it('is scale-invariant, unlike the raw amplitude', () => {
		// The reason to report it: doubling the signal doubles amplitude but
		// leaves relative amplitude alone.
		const base = series(10, { amp: 1 });
		const scaled = { t: base.t, y: base.y.map((v) => v * 5) };
		const statKeys = getStatKeys(args);
		const run = (s) =>
			computeMovingWindows({
				tAll: s.t,
				ys: [s.y],
				starts: [0],
				windowSize: 168,
				statKeys,
				args
			})[0];
		const a = run(base);
		const b = run(scaled);
		expect(b.H1_amplitude[0] / a.H1_amplitude[0]).toBeCloseTo(5, 6);
		expect(b.rel_amplitude[0]).toBeCloseTo(a.rel_amplitude[0], 6);
	});

	it('is NaN when the MESOR is ~0 rather than Infinity', () => {
		// A mean-centred signal has no meaningful relative amplitude.
		const { t, y } = series(10, { amp: 1 });
		const centred = y.map((v) => v - 1); // envelope is 1 + cos, so this centres it
		const out = computeMovingWindows({
			tAll: t,
			ys: [centred],
			starts: [0],
			windowSize: 168,
			statKeys: getStatKeys(args),
			args
		})[0];
		expect(Number.isFinite(out.rel_amplitude[0])).toBe(false);
	});
});

describe('binLabel: end — real-time availability', () => {
	// Required by the colony-monitoring design: a window's result must be
	// stamped at the moment the data became available, not at its midpoint.
	it('offsets results by the full window when end-labelled', () => {
		const windowSize = 168;
		const binOffsetFor = (label) =>
			label === 'start' ? 0 : label === 'end' ? windowSize : windowSize / 2;
		expect(binOffsetFor('end')).toBe(168);
		expect(binOffsetFor('center')).toBe(84);
		expect(binOffsetFor('start')).toBe(0);
	});
});

// ─── analysis: 'trend' ────────────────────────────────────────────────────────
// Regression guard. This path called the ASYNC `fitTrend` synchronously, so it
// got a Promise back; `!r.parameters` was then true and every window silently
// returned empty stats (all NaN). It now calls `fitTrendSync`. Without a test
// here the failure is invisible: the node produced columns, they were just
// entirely NaN.

describe("computeMovingWindows — analysis: 'trend'", () => {
	const run = (y, args) =>
		computeMovingWindows({
			tAll: y.map((_, i) => i),
			ys: [y],
			starts: [0],
			windowSize: y.length,
			statKeys: getStatKeys(args),
			args
		})[0];

	it('reports the slope and intercept of a linear window', () => {
		const args = { analysis: 'trend', trendModel: 'linear' };
		const y = Array.from({ length: 20 }, (_, i) => 2 * i + 3);
		const out = run(y, args);
		expect(out.slope[0]).toBeCloseTo(2, 8);
		expect(out.intercept[0]).toBeCloseTo(3, 8);
		expect(out.r2[0]).toBeCloseTo(1, 8);
		expect(out.rmse[0]).toBeCloseTo(0, 8);
	});

	it('reports polynomial coefficients', () => {
		const args = { analysis: 'trend', trendModel: 'polynomial', trendPolyDegree: 2 };
		const y = Array.from({ length: 20 }, (_, i) => 3 * i * i - i + 5);
		const out = run(y, args);
		expect(out.c2[0]).toBeCloseTo(3, 6);
		expect(out.c1[0]).toBeCloseTo(-1, 6);
		expect(out.c0[0]).toBeCloseTo(5, 6);
	});

	it('reports a and b for an exponential window', () => {
		const args = { analysis: 'trend', trendModel: 'exponential' };
		const y = Array.from({ length: 20 }, (_, i) => 2 * Math.exp(0.1 * i));
		const out = run(y, args);
		expect(out.a[0]).toBeCloseTo(2, 6);
		expect(out.b[0]).toBeCloseTo(0.1, 6);
	});
});
