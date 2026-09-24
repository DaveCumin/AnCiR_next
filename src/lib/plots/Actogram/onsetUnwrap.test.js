import { describe, it, expect } from 'vitest';
import { linearRegression } from '$lib/components/plotbits/helpers/wrangleData';
import {
	matchTemplateMarkers,
	markerAbsoluteTimes,
	unwrapOnsets,
	markerDisplayPosition,
	lineCopyOffsets,
	wrapPhaseToRow,
	assessOnsetFit
} from './onsetUnwrap.js';

// Small deterministic PRNG (mulberry32) so the noisy cases are reproducible.
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
function gauss(r) {
	return Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
}

/**
 * A simulated activity record: active for `activeFrac` of each cycle from each
 * onset, onsets at firstOnset + k * tau (plus optional jitter). Returned split into
 * rows exactly as Actogram.dataByDays does (row r holds x in [r*P, (r+1)*P)).
 */
function simulate({ tau, P, days, firstOnset, binSize = 0.25, noisy = false, seed = 1 }) {
	const r = rng(seed);
	const activeFrac = 0.4;
	const total = days * P;
	const nCycles = Math.ceil(total / tau) + 2;
	const onsets = [];
	for (let k = -1; k < nCycles; k++) {
		onsets.push(firstOnset + k * tau + (noisy ? 0.25 * gauss(r) : 0));
	}
	const xByPeriod = {};
	const yByPeriod = {};
	for (let t = 0; t < total; t += binSize) {
		// Most recent onset at or before t.
		let active = false;
		for (const o of onsets) {
			if (o <= t && t - o < activeFrac * tau) {
				active = true;
				break;
			}
		}
		let y = active ? 10 : 1;
		if (noisy) y = active ? Math.max(0, 10 + 4 * gauss(r)) : Math.max(0, 1 + gauss(r));
		const p = Math.floor(t / P);
		(xByPeriod[p] ||= []).push(t);
		(yByPeriod[p] ||= []).push(y);
	}
	return { xByPeriod, yByPeriod, binSize };
}

function estimateTau(sim, P, type = 'onset') {
	const { hours, times } = matchTemplateMarkers(sim.xByPeriod, sim.yByPeriod, {
		periodHrs: P,
		binSize: sim.binSize,
		hrsBefore: 3,
		hrsAfter: 3,
		centile: 50,
		type
	});
	const u = unwrapOnsets(markerAbsoluteTimes(hours, P, times), { periodHrs: P });
	const reg = linearRegression(u.xs, u.ys);
	return { tau: reg.slope, reg, u, hours, times };
}

/** The old estimator: regress hour-in-row + (row+1)*P on row+1, no unwrapping. */
function oldTau(hours, P) {
	const xs = [];
	const ys = [];
	hours.forEach((h, i) => {
		if (Number.isFinite(h)) {
			xs.push(i + 1);
			ys.push(h + (i + 1) * P);
		}
	});
	return linearRegression(xs, ys).slope;
}

describe('automatic onset tau with row-boundary crossings', () => {
	const cases = [
		// tau, row length, first onset chosen so the onsets cross the row boundary
		{ tau: 22.25, P: 24, firstOnset: 6 },
		{ tau: 24.5, P: 24, firstOnset: 18 },
		{ tau: 25.5, P: 24, firstOnset: 16 },
		{ tau: 12.42, P: 12, firstOnset: 8 }
	];
	for (const { tau, P, firstOnset } of cases) {
		for (const noisy of [false, true]) {
			it(`recovers tau = ${tau} h on ${P} h rows (${noisy ? 'noisy' : 'noise-free'}, 16 days)`, () => {
				const sim = simulate({ tau, P, days: 16, firstOnset, noisy, seed: Math.round(tau * 100) });
				const res = estimateTau(sim, P);
				// The onsets really do wrap: the per-row hours are not monotone.
				const h = res.hours.filter(Number.isFinite);
				const jumps = h.slice(1).filter((v, i) => Math.abs(v - h[i]) > P / 2);
				expect(jumps.length).toBeGreaterThan(0);
				expect(res.tau).toBeGreaterThan(tau - 0.1);
				expect(res.tau).toBeLessThan(tau + 0.1);
			});
		}
	}

	it('the old per-row regression was wrong on the same data (regression guard for the bug)', () => {
		const sim = simulate({ tau: 22.25, P: 24, days: 16, firstOnset: 6 });
		const res = estimateTau(sim, 24);
		expect(Math.abs(oldTau(res.hours, 24) - 22.25)).toBeGreaterThan(0.5);
	});

	it('offsets are unwrapped the same way', () => {
		const sim = simulate({ tau: 22.25, P: 24, days: 16, firstOnset: 6 });
		const res = estimateTau(sim, 24, 'offset');
		expect(res.tau).toBeGreaterThan(22.15);
		expect(res.tau).toBeLessThan(22.35);
	});

	it('leaves a rhythm that never crosses the boundary exactly as the plain regression', () => {
		const sim = simulate({ tau: 24.2, P: 24, days: 14, firstOnset: 4 });
		const res = estimateTau(sim, 24);
		expect(res.u.nMerged).toBe(0);
		expect(res.tau).toBeCloseTo(oldTau(res.hours, 24), 9);
	});
});

describe('unwrapOnsets', () => {
	const P = 24;
	const line = (tau, t0, rows) => rows.map((r) => t0 + r * tau);

	it('unwraps manual markers (clicked onsets, stored by row) across midnight', () => {
		// tau = 22.25 from 7 h: the first onset in each row is 7, 5.25, 3.5, 1.75, 0,
		// 20.5, ... (row 4 holds two onsets, 0 and 22.25; the user clicked the first).
		const tau = 22.25;
		const onsets = Array.from({ length: 20 }, (_, k) => 7 + k * tau);
		const hours = Array.from({ length: 15 }, (_, r) => {
			const t = onsets.find((o) => o >= r * P && o < (r + 1) * P);
			return t - r * P;
		});
		const u = unwrapOnsets(markerAbsoluteTimes(hours, P), { periodHrs: P });
		expect(linearRegression(u.xs, u.ys).slope).toBeCloseTo(tau, 9);
	});

	it('handles missing days and deselected rows', () => {
		const tau = 25.5;
		const times = line(
			tau,
			20,
			Array.from({ length: 16 }, (_, i) => i)
		);
		times[3] = NaN;
		times[4] = NaN;
		times[9] = NaN;
		const selected = times.map((_, i) => i !== 12);
		const u = unwrapOnsets(times, { periodHrs: P, selected });
		expect(u.n).toBe(12);
		expect(linearRegression(u.xs, u.ys).slope).toBeCloseTo(tau, 9);
	});

	it('merges the same onset found from two neighbouring rows', () => {
		const tau = 25.5;
		const times = line(tau, 1, [0, 1, 2, 3, 4, 5, 6, 7]);
		// Row 3 also reported row 4's onset (its search spans two rows).
		const withDup = [...times.slice(0, 4), times[4], times[4] + 0.25, ...times.slice(5)];
		const u = unwrapOnsets(withDup, { periodHrs: P });
		expect(u.nMerged).toBe(1);
		expect(linearRegression(u.xs, u.ys).slope).toBeCloseTo(tau, 1);
	});

	it('counts a skipped cycle when a row holds two onsets (tau well below P)', () => {
		const tau = 20;
		// Every onset, but only the first found in each row: one per row, so cycles skip.
		const all = line(
			tau,
			2,
			Array.from({ length: 20 }, (_, i) => i)
		);
		const perRow = [];
		for (let r = 0; r < 16; r++) perRow.push(all.find((t) => t >= r * P && t < (r + 1) * P));
		const u = unwrapOnsets(perRow, { periodHrs: P });
		expect(linearRegression(u.xs, u.ys).slope).toBeCloseTo(tau, 9);
	});

	it('returns no points when nothing is selected', () => {
		const u = unwrapOnsets([1, 25, 49], { periodHrs: P, selected: [false, false, false] });
		expect(u.xs).toEqual([]);
	});

	it('anchors the first onset in the row it fell in', () => {
		const u = unwrapOnsets([30, 54.5, 79], { periodHrs: P });
		// First onset at 30 h is row 1 (0-indexed) = x 2, 6 h into the row.
		expect(u.xs[0]).toBe(2);
		expect(u.ys[0] - u.xs[0] * P).toBeCloseTo(6, 9);
	});
});

describe('placement on the actogram', () => {
	it('draws a marker in the row its onset fell in', () => {
		expect(markerDisplayPosition(24 * 5 + 0.5, 24)).toEqual({ row: 5, hour: 0.5 });
	});

	it('includes the copy that re-enters after the line leaves the left edge', () => {
		// tau 22.25 drifting left from 7 h: by row 15 the k = 0 line is at -19 h.
		const offs = lineCopyOffsets({
			slope: 22.25,
			intercept: 7,
			periodHrs: 24,
			span: 48,
			lo: 1,
			hi: 15
		});
		expect(offs).toContain(0);
		expect(offs).toContain(22.25);
		expect(offs).toContain(44.5);
		expect(offs).not.toContain(-22.25);
	});

	it('a line that stays in the first period gets only its double-plotted copy', () => {
		const offs = lineCopyOffsets({
			slope: 24.5,
			intercept: 0.5,
			periodHrs: 24,
			span: 48,
			lo: 1,
			hi: 14
		});
		expect(offs).toEqual([0, 24.5]);
	});

	it('reports the phase in the row on the clock, wrapping by tau', () => {
		expect(wrapPhaseToRow(7, 22.25, 24)).toBeCloseTo(7, 9);
		expect(wrapPhaseToRow(-3.3, 22.25, 24)).toBeCloseTo(18.95, 9);
		expect(wrapPhaseToRow(31.5, 22.25, 24)).toBeCloseTo(9.25, 9);
		// tau > P: a row with no onset reports the next one on the next day's clock.
		expect(wrapPhaseToRow(24.8, 25.5, 24)).toBeCloseTo(0.8, 9);
	});
});

describe('assessOnsetFit', () => {
	const reg = (slope, rmse = 0.2) => ({ slope, rmse });
	const unwrap = (n, nAmbiguous = 0) => ({ n, nAmbiguous });

	it('is quiet for a good fit', () => {
		expect(assessOnsetFit({ unwrap: unwrap(14), reg: reg(22.25), periodHrs: 24 })).toEqual([]);
	});

	it('flags too few onsets', () => {
		const w = assessOnsetFit({ unwrap: unwrap(3), reg: reg(22.25), periodHrs: 24 });
		expect(w.join(' ')).toMatch(/Only 3 onsets/);
	});

	it('flags large residuals', () => {
		const w = assessOnsetFit({ unwrap: unwrap(14), reg: reg(22.25, 3), periodHrs: 24 });
		expect(w.join(' ')).toMatch(/scatter/);
	});

	it('flags inconsistent cycle gaps', () => {
		const w = assessOnsetFit({ unwrap: unwrap(11, 4), reg: reg(22.25), periodHrs: 24 });
		expect(w.join(' ')).toMatch(/whole number of cycles/);
	});

	it('flags a tau on the row length only when the periodogram disagrees', () => {
		const disagree = assessOnsetFit({
			unwrap: unwrap(14),
			reg: reg(23.95),
			periodHrs: 24,
			periodogramPeak: () => 24.84
		});
		expect(disagree.join(' ')).toMatch(/locked to the rows/);
		const agree = assessOnsetFit({
			unwrap: unwrap(14),
			reg: reg(24.02),
			periodHrs: 24,
			periodogramPeak: () => 24.05
		});
		expect(agree).toEqual([]);
		let called = false;
		assessOnsetFit({
			unwrap: unwrap(14),
			reg: reg(22.25),
			periodHrs: 24,
			periodogramPeak: () => ((called = true), 24)
		});
		expect(called).toBe(false);
	});
});
