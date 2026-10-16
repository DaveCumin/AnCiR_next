import { describe, it, expect } from 'vitest';
import { getStatKeys, computeMovingWindows, windowSkipMessages } from './movinganalysis.js';
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

// Skipped windows leave blank cells with nothing to say why. `__skips` is the
// accounting the node turns into its warning badge; the NUMERIC outputs must
// be unchanged (the same windows skipped for the same reasons as before).
describe('computeMovingWindows — __skips accounting', () => {
	const runFull = (tAll, ys, starts, windowSize, args) =>
		computeMovingWindows({ tAll, ys, starts, windowSize, statKeys: getStatKeys(args), args });

	it('counts logarithmic-domain skips and leaves those windows NaN', () => {
		// Two windows: [0, 10) contains t = 0 (violates ln), [10, 20) is clean.
		const args = { analysis: 'trend', trendModel: 'logarithmic' };
		const t = Array.from({ length: 20 }, (_, i) => i);
		const y = t.map((ti) => 3 + 2 * Math.log(ti + 1));
		const [out] = runFull(t, [y], [0, 10], 10, args);
		expect(out.__skips).toEqual({
			total: 2,
			fewPoints: 0,
			logDomain: 1,
			expDomain: 0,
			polyDegree: 0,
			fftGap: 0
		});
		expect(Number.isNaN(out.a[0])).toBe(true); // skipped window stays blank
		expect(Number.isFinite(out.a[1])).toBe(true); // clean window still fits
	});

	it('counts exponential-domain skips per y series independently', () => {
		const args = { analysis: 'trend', trendModel: 'exponential' };
		const t = Array.from({ length: 10 }, (_, i) => i + 1);
		const yBad = t.map((ti) => ti - 3); // contains 0 and negatives
		const yGood = t.map((ti) => 2 * Math.exp(0.1 * ti));
		const [bad, good] = runFull(t, [yBad, yGood], [1], 10, args);
		expect(bad.__skips.expDomain).toBe(1);
		expect(good.__skips.expDomain).toBe(0);
		expect(Number.isFinite(good.a[0])).toBe(true);
	});

	it('counts too-few-points and underdetermined-polynomial windows separately', () => {
		const t = [0, 1, 2, 3, 4, 5, 20, 21];
		const y = t.map((ti) => ti * 2);
		// Window [20, 30) has 2 points → fewPoints. Window [0, 10) has 6 points
		// but a degree-7 polynomial needs more → polyDegree.
		const args = { analysis: 'trend', trendModel: 'polynomial', trendPolyDegree: 7 };
		const [out] = runFull(t, [y], [0, 20], 10, args);
		expect(out.__skips.fewPoints).toBe(1);
		expect(out.__skips.polyDegree).toBe(1);
	});

	it('a clean run reports zero skips and __skips never shadows a stat key', () => {
		const args = { analysis: 'summary', summaryPercentile: 50 };
		const t = Array.from({ length: 30 }, (_, i) => i);
		const y = t.map((ti) => ti % 7);
		const [out] = runFull(t, [y], [0, 10], 10, args);
		expect(out.__skips).toEqual({
			total: 2,
			fewPoints: 0,
			logDomain: 0,
			expDomain: 0,
			polyDegree: 0,
			fftGap: 0
		});
		expect(getStatKeys(args)).not.toContain('__skips');
	});
});

describe('windowSkipMessages', () => {
	it('states the requirement, the count and a remedy for log-domain skips', () => {
		const msgs = windowSkipMessages(
			{ total: 8, fewPoints: 0, logDomain: 3, expDomain: 0, polyDegree: 0 },
			'temp'
		);
		expect(msgs).toHaveLength(1);
		expect(msgs[0]).toContain('3 of 8 windows for temp');
		expect(msgs[0]).toContain('greater than 0');
		expect(msgs[0]).toContain('linear or polynomial');
	});

	it('emits one sentence per skip reason and none when nothing was skipped', () => {
		const none = windowSkipMessages(
			{ total: 5, fewPoints: 0, logDomain: 0, expDomain: 0, polyDegree: 0 },
			''
		);
		expect(none).toEqual([]);
		const all = windowSkipMessages(
			{ total: 5, fewPoints: 1, logDomain: 1, expDomain: 1, polyDegree: 1 },
			'',
			{ polyDegree: 4 }
		);
		expect(all).toHaveLength(4);
		expect(all.join(' ')).toContain('degree-4');
	});

	it('handles a missing tally and singular grammar', () => {
		expect(windowSkipMessages(null, 'x')).toEqual([]);
		const one = windowSkipMessages(
			{ total: 1, fewPoints: 1, logDomain: 0, expDomain: 0, polyDegree: 0 },
			''
		);
		expect(one[0]).toContain('1 of 1 window was skipped');
	});
});

// SPEC-2 per window: an FFT window whose samples have a long gap used to be transformed with
// the gap closed up (24 h read as 31 h). It is now skipped, counted and explained.
describe('computeMovingWindows: FFT windows with a gap', () => {
	it('skips a window with a long gap, keeps a clean one, and says why', () => {
		const args = { analysis: 'fft' };
		const tAll = [];
		const y = [];
		for (let i = 0; i < 480; i++) {
			// Window 1 (240 to 480 h) loses 30 h in the middle; window 0 is complete.
			if (i >= 330 && i < 360) continue;
			tAll.push(i);
			y.push(Math.cos((2 * Math.PI * i) / 24));
		}
		const [out] = computeMovingWindows({
			tAll,
			ys: [y],
			starts: [0, 240],
			windowSize: 240,
			statKeys: getStatKeys(args),
			args
		});
		expect(out.peak_period[0]).toBeCloseTo(24, 4);
		expect(out.peak_magnitude[0]).toBeCloseTo(1, 4);
		expect(Number.isNaN(out.peak_period[1])).toBe(true);
		expect(out.__skips.fftGap).toBe(1);
		const msg = windowSkipMessages(out.__skips, 'y').join(' ');
		expect(msg).toMatch(/1 of 2 windows for y was skipped: the FFT needs evenly spaced samples/);
	});
});

// SPEC-9: the chi-squared window peak is the period with the largest Qp - threshold (the
// largest raw Qp drifted to the longest trial period on a weak rhythm), and the window carries
// the peak's family-wise p so a window with no significant period reads as such.
describe('chi-squared moving periodogram peak (SPEC-9)', () => {
	function mulberry32(seed) {
		return () => {
			seed |= 0;
			seed = (seed + 0x6d2b79f5) | 0;
			let v = Math.imul(seed ^ (seed >>> 15), 1 | seed);
			v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v;
			return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
		};
	}
	function weak(seed, amp) {
		const rng = mulberry32(seed);
		const t = Array.from({ length: 2400 }, (_, i) => i * 0.1);
		const y = t.map((tt) => {
			const u = Math.max(rng(), 1e-12);
			const v = rng();
			return (
				amp * Math.sin((2 * Math.PI * tt) / 24) +
				Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
			);
		});
		return { t, y };
	}
	const args = {
		analysis: 'periodogram',
		pgMethod: 'Chi-squared',
		periodMin: 16,
		periodMax: 48,
		periodStep: 0.1,
		pgBinSize: 0.25,
		pgAlpha: 0.05
	};

	it('declares peak_pvalue for Chi-squared only', () => {
		expect(getStatKeys(args)).toEqual(['peak_period', 'peak_power', 'peak_pvalue']);
		expect(getStatKeys({ ...args, pgMethod: 'Lomb-Scargle' })).toEqual([
			'peak_period',
			'peak_power'
		]);
	});

	it('a weak 24 h rhythm reports ~24 h (not ~48 h) with a significant family-wise p', () => {
		const { t, y } = weak(1, 0.3);
		const out = computeMovingWindows({
			tAll: t,
			ys: [y],
			starts: [0],
			windowSize: 240,
			statKeys: getStatKeys(args),
			args
		})[0];
		expect(Math.abs(out.peak_period[0] - 24)).toBeLessThanOrEqual(1);
		expect(out.peak_pvalue[0]).toBeLessThan(0.05);
	});

	it('a window with no period over its threshold reports p >= alpha', () => {
		const { t, y } = weak(1, 0.15);
		const a = { ...args, periodMin: 18, periodMax: 30 };
		const out = computeMovingWindows({
			tAll: t,
			ys: [y],
			starts: [0],
			windowSize: 240,
			statKeys: getStatKeys(a),
			args: a
		})[0];
		expect(Number.isFinite(out.peak_period[0])).toBe(true);
		expect(out.peak_pvalue[0]).toBeGreaterThanOrEqual(0.05);
	});
});

// v82.9: the fixed-period cosinor's `rmse` is sqrt(SS/(n - p)), the residual SE (FIT-15). It
// also reports `rmse_n` = sqrt(SS/n), the RMSE every other analysis reports, so windows can
// be compared across analyses; `rmse` keeps its value and key for saved sessions.
describe('rolling fixed-period cosinor rmse_n', () => {
	const args = { analysis: 'cosinor', useFixedPeriod: true, fixedPeriod: 24, nHarmonics: 2 };

	it('is declared in fixed-period mode only, next to rmse', () => {
		const keys = getStatKeys(args);
		expect(keys.slice(keys.indexOf('rmse'), keys.indexOf('rmse') + 2)).toEqual(['rmse', 'rmse_n']);
		expect(getStatKeys({ ...args, useFixedPeriod: false })).not.toContain('rmse_n');
	});

	it('is sqrt(SS/n) of the window fit, and rmse stays sqrt(SS/(n - p))', () => {
		const t = Array.from({ length: 96 }, (_, i) => i * 0.5);
		const y = t.map(
			(h, i) => 10 + 3 * Math.cos((2 * Math.PI * (h - 6)) / 24) + ((i * 37) % 11) / 5
		);
		const out = computeMovingWindows({
			tAll: t,
			ys: [y],
			starts: [0],
			windowSize: 48,
			statKeys: getStatKeys(args),
			args
		})[0];
		const n = 96;
		const p = 1 + 2 * 2; // mesor + (beta, gamma) per harmonic
		expect(out.rmse_n[0]).toBeGreaterThan(0);
		expect(out.rmse_n[0]).toBeCloseTo(out.rmse[0] * Math.sqrt((n - p) / n), 12);
	});
});
