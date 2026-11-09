// Robustness of the rhythm analyses to the sampling grid. For regular data at 1, 5, 10 and 30 min
// and 1 h, with times rounded to 2 to 6 decimals (as a CSV of hours writes them) and with offset
// starts, every analysis must:
//   · find the period of a known 24 h rhythm (Lomb-Scargle, Chi-squared, Enright, correlogram,
//     free-period cosinor);
//   · bin one sample per bin at the sampling interval, and k per bin at k intervals;
//   · cut the closed-form number of moving windows (every complete window over the sampled span);
//   · give the same answer when the time origin moves or the times are rounded (periodogram,
//     NPCRA, correlogram).
//
// Generalises 2026-11-09 bugs 6 (rounded sample times on bin edges broke the binned
// periodograms; periodogram.binEdges.test.js pins one grid) and 7 (MovingAnalysis dropped the
// last full window; movinganalysis.test.js pins one case).
import { describe, it, expect } from 'vitest';
import { binData } from '$lib/components/plotbits/helpers/wrangleData.js';
import { binOrigin, runPeriodogramCalculation } from './periodogram.js';
import { computeAutocorrelation } from './correlogram.js';
import { movingWindowStarts } from './movinganalysis.js';
import { computeNPCRA } from './npcra.js';
import { fitCosineCurves } from './cosinor.js';

/** Deterministic noise (mulberry32). */
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

const DTS = [
	['1 min', 1 / 60],
	['5 min', 5 / 60],
	['10 min', 10 / 60],
	['30 min', 0.5],
	['1 h', 1]
];
const OFFSETS = [0, 7.3, 1000.125];
const round = (x, dp) => Math.round(x * 10 ** dp) / 10 ** dp;
/**
 * Decimal places the analyses are designed to absorb: a rounding error (half a unit in the last
 * place) of at most 5% of a step, binOrigin's on-grid tolerance (ON_GRID_TOL). Coarser than
 * that (5-min data written to 2 dp is off by 6% of a step, gaps alternating 0.08 and 0.09 h)
 * the record is not treated as regular, and the binned methods fall back to the bin-size grid.
 */
const dpsFor = (dt) => [2, 3, 4, 5, 6].filter((dp) => 10 ** -dp <= dt / 10);

/** `days` of samples every `dt` h from `start`, times to `dp` decimals; a 24 h rhythm + noise. */
function series(dt, { days = 6, start = 0, dp = null, seed = 1 } = {}) {
	const r = rng(seed);
	const n = Math.round((days * 24) / dt);
	const exact = Array.from({ length: n }, (_, k) => start + k * dt);
	const t = dp == null ? exact : exact.map((x) => round(x, dp));
	// The phase follows the clock (exact time), so a moved origin moves the phase with it.
	const y = exact.map((x) => 10 + 5 * Math.cos((2 * Math.PI * x) / 24) + 2 * (r() - 0.5));
	return { t, y, n, exact };
}

const peakOf = (res) => res.x[res.y.indexOf(Math.max(...res.y.filter(Number.isFinite)))];
/** The binned methods' bin: the interval, but never under 10 min (a 1-min fold grid is slow). */
const binFor = (dt) => Math.max(dt, 1 / 6);

function periodogram(method, t, y, dt) {
	const bin = binFor(dt);
	return runPeriodogramCalculation({
		method,
		xData: t,
		yData: y,
		binSize: bin,
		periodMin: 20,
		periodMax: 28,
		periodSteps: method === 'Lomb-Scargle' ? 0.25 : bin,
		chiSquaredAlpha: 0.05
	});
}

const relClose = (a, b, rel) =>
	a.length === b.length &&
	a.every((v, i) =>
		Number.isFinite(v)
			? Math.abs(v - b[i]) <= rel * Math.max(1, Math.abs(v))
			: !Number.isFinite(b[i])
	);

describe.each(DTS)('sampling every %s', (_, dt) => {
	describe.each(OFFSETS)('starting at %s h', (start) => {
		it.each(dpsFor(dt))(
			'bins one sample per bin, and k per bin of k intervals (times to %i dp)',
			(dp) => {
				const { t, y, n } = series(dt, { start, dp, days: 2 });
				const one = binData(t, y, dt, binOrigin(t, dt), null, 'count').y_out;
				const filled = one.filter((c) => c > 0);
				expect(filled.length).toBe(n);
				expect(new Set(filled)).toEqual(new Set([1]));
				// Bins of 1 h hold 1/dt samples each (for dt dividing an hour), the last perhaps fewer.
				if (dt < 1) {
					const k = Math.round(1 / dt);
					const counts = binData(t, y, 1, binOrigin(t, 1), null, 'count').y_out.filter(
						(c) => c > 0
					);
					expect(
						counts.slice(0, -1).every((c) => c === k),
						`${counts.slice(0, 5)}`
					).toBe(true);
					expect(counts.reduce((a, c) => a + c, 0)).toBe(n);
				}
			}
		);

		it.each(dpsFor(dt))('cuts the closed-form number of moving windows (times to %i dp)', (dp) => {
			const { t, n } = series(dt, { start, dp, days: 6 });
			// The sampled span is n samples of dt each, so a W-hour window stepping by S hours
			// fits floor((n dt - W) / S) + 1 times.
			for (const [W, S] of [
				[24, 24],
				[48, 12],
				[72, 24],
				[24, 1]
			]) {
				const expected = Math.floor((n * dt - W) / S + 1e-9) + 1;
				const starts = movingWindowStarts(t, W, S);
				expect(starts.length, `W ${W} S ${S}`).toBe(expected);
				expect(starts[0]).toBe(Math.min(...t));
			}
		});
	});

	it.each(['Lomb-Scargle', 'Chi-squared', 'Enright'])(
		'%s finds 24 h, unchanged by rounding and by moving the time origin',
		(method) => {
			const base = series(dt, { start: 0 });
			const ref = periodogram(method, base.t, base.y, dt);
			const tol = method === 'Lomb-Scargle' ? 0.25 : binFor(dt) + 1e-9;
			expect(Math.abs(peakOf(ref) - 24), `${method} peak ${peakOf(ref)}`).toBeLessThanOrEqual(tol);
			for (const start of OFFSETS.slice(1)) {
				// The same samples on a later clock: the same spectrum.
				const res = periodogram(
					method,
					base.t.map((x) => x + start),
					base.y,
					dt
				);
				expect(peakOf(res), `${method} from ${start} h`).toBe(peakOf(ref));
				expect(relClose(res.y, ref.y, 1e-6), `${method} power from ${start} h`).toBe(true);
			}
			for (const dp of dpsFor(dt)) {
				const rounded = series(dt, { start: 1000.125, dp });
				const exact = series(dt, { start: 1000.125 });
				const a = periodogram(method, rounded.t, rounded.y, dt);
				const b = periodogram(method, exact.t, exact.y, dt);
				expect(peakOf(a), `${method} to ${dp} dp`).toBe(peakOf(b));
				// The binned methods bin identically; Lomb-Scargle moves only by the rounding.
				const rel = method === 'Lomb-Scargle' ? 10 ** -dp * 50 : 1e-9;
				expect(relClose(a.y, b.y, rel), `${method} power to ${dp} dp`).toBe(true);
			}
		}
	);

	it('the correlogram peaks near 24 h, the same whatever the origin and rounding', () => {
		const base = series(dt, { days: 4 });
		const ref = computeAutocorrelation(base.t, base.y, null, 30, 12);
		// A noisy 4-day record: the peak lag is near, not exactly at, the period.
		expect(Math.abs(ref.peakLag - 24), `${ref.peakLag}`).toBeLessThanOrEqual(0.5);
		for (const start of OFFSETS) {
			for (const dp of [null, ...dpsFor(dt)]) {
				const t = base.exact.map((x) => (dp == null ? x + start : round(x + start, dp)));
				const r = computeAutocorrelation(t, base.y, null, 30, 12);
				expect(r.lags.length, `from ${start} h, ${dp} dp`).toBe(ref.lags.length);
				// The same lag step; its length is measured from the stored times, so off by at
				// most their rounding.
				expect(
					Math.abs(r.peakLag - ref.peakLag),
					`from ${start} h, ${dp} dp: ${r.peakLag}`
				).toBeLessThanOrEqual(dp == null ? 1e-6 : 10 ** -dp);
				expect(relClose(r.correlations, ref.correlations, 1e-6)).toBe(true);
			}
		}
	});

	it('NPCRA gives the same IS, IV, RA and onsets whatever the origin and rounding', () => {
		const epoch = Math.max(dt, 0.5);
		const run = (start, dp) => {
			const { t } = series(dt, { start, dp, days: 7 });
			// A square rest-activity rhythm, active 08:00 to 18:00 of the record's own day (the
			// same samples whatever the clock, so onsets, which are after t0, do not move).
			const y = t.map((_, k) => {
				const h = (k * dt) % 24;
				return h >= 8 && h < 18 ? 100 : 5;
			});
			return computeNPCRA(t, y, { epochHours: epoch, period: 24, mWindow: 10, lWindow: 5 });
		};
		const ref = run(0, null);
		expect(ref.IS).toBeGreaterThan(0.95);
		for (const start of OFFSETS) {
			for (const dp of [null, ...dpsFor(dt)]) {
				const r = run(start, dp);
				for (const k of ['IS', 'IV', 'RA', 'M10', 'L5', 'M10onset', 'L5onset']) {
					expect(r[k], `${k} from ${start} h, ${dp} dp`).toBeCloseTo(ref[k], 9);
				}
			}
		}
	});

	it('a free-period cosinor finds 24 h, unchanged by rounding and origin', () => {
		const base = series(dt, { days: 4 });
		const fit = (t) => fitCosineCurves(t, base.y, 1, { minPeriod: 20, maxPeriod: 28 });
		const period = (f) => (2 * Math.PI) / f.parameters.cosines[0].frequency;
		const ref = fit(base.t);
		expect(Math.abs(period(ref) - 24)).toBeLessThan(0.1);
		for (const start of OFFSETS.slice(1)) {
			for (const dp of [null, dpsFor(dt).at(-1)]) {
				const f = fit(base.exact.map((x) => (dp == null ? x + start : round(x + start, dp))));
				expect(period(f), `from ${start} h, ${dp} dp`).toBeCloseTo(period(ref), 3);
				expect(f.parameters.cosines[0].amplitude).toBeCloseTo(
					ref.parameters.cosines[0].amplitude,
					3
				);
			}
		}
	});
});
