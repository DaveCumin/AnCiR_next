// Phase reference (review FIT-9) on every node with phase outputs other than Cosinor
// (Cosinor.phaseReference.test.js): NonparametricRA, AverageProfile, FitFunction and
// MovingAnalysis. Real maths; mocked columns.
//
// The scenario throughout: a recording that starts at 07:00 with activity high from
// 08:00 to 18:00 every day. Hours since the first sample put the M10 onset at 1 h;
// clock time puts it at 08:00.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockColumns, rawData, appState } = vi.hoisted(() => ({
	mockColumns: {},
	rawData: new Map(),
	appState: { displayTimezone: 'utc' }
}));
vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData, tableProcesses: [] },
	appState,
	appConsts: { processMap: new Map() }
}));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/ControlInput.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));

import { nonparametricRA, definition as npcraDef } from './NonparametricRA.svelte';
import { averageProfile, definition as apDef } from './AverageProfile.svelte';
import { fitMetricValue, definition as fitDef } from './FitFunction.svelte';
import { movinganalysis, definition as maDef } from './MovingAnalysis.svelte';
import { computeNPCRA } from '$lib/utils/npcra.js';

const H = 3600000;
const MIDNIGHT = Date.UTC(2026, 2, 2);
const START = MIDNIGHT + 7 * H; // 07:00 UTC

/** `days` of hourly rest-activity from 07:00: 100 from 08:00 to 18:00 clock time, else 10. */
function restActivity(days = 8) {
	const ms = [];
	const y = [];
	for (let i = 0; i < days * 24; i++) {
		const v = START + i * H;
		ms.push(v);
		const clock = ((v - MIDNIGHT) / H) % 24;
		y.push(clock >= 8 && clock < 18 ? 100 : 10);
	}
	return { ms, y };
}

function setTime(ms, y) {
	rawData.clear();
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	const valid = ms.filter((v) => v != null);
	const m = Math.min(...valid);
	mockColumns[1] = {
		type: 'time',
		getData: () => ms,
		hoursSinceStart: ms.map((v) => (v == null ? null : (v - m) / H))
	};
	mockColumns[2] = { name: 'activity', getData: () => y };
}

beforeEach(() => {
	appState.displayTimezone = 'utc';
});

describe('every phase-output node declares phaseReference, default since first sample', () => {
	for (const [name, def] of [
		['NonparametricRA', npcraDef],
		['AverageProfile', apDef],
		['FitFunction', fitDef],
		['MovingAnalysis', maDef]
	]) {
		it(name, () => {
			expect(def.defaults.get('phaseReference')?.val).toBe('start');
		});
	}
});

describe('NonparametricRA', () => {
	const args = (over) => ({
		xIN: 1,
		yIN: [2],
		epochHours: 1,
		period: 24,
		mWindow: 10,
		lWindow: 5,
		out: { npcrax: -1 },
		...over
	});
	beforeEach(() => {
		const { ms, y } = restActivity();
		setTime(ms, y);
	});

	it('since first sample: the 08:00 onset of a 07:00 record reads 1 h (unchanged)', async () => {
		const [res] = await nonparametricRA(args());
		expect(res.perY[2].M10onset).toBe(1);
		expect(res.binCentres[0]).toBe(0.5);
	});

	it('clock time: the M10 onset reads 8 h and the profile is relabelled, not re-binned', async () => {
		const [start] = await nonparametricRA(args());
		const [clock] = await nonparametricRA(args({ phaseReference: 'clock' }));
		expect(clock.perY[2].M10onset).toBe(8);
		// L5: the least active 5 h start at the first low hour in the series order.
		expect(clock.perY[2].L5onset).toBe((start.perY[2].L5onset + 7) % 24);
		// Same statistics.
		for (const k of ['IS', 'IV', 'RA', 'M10', 'L5']) {
			expect(clock.perY[2][k]).toBe(start.perY[2][k]);
		}
		// Bin times ascend in clock time and carry the same values, rotated.
		expect(clock.binCentres[0]).toBe(0.5);
		expect(clock.binCentres.at(-1)).toBe(23.5);
		const profAt = (r, c) => r.perY[2].profile[r.binCentres.indexOf(c)];
		expect(profAt(clock, 8.5)).toBe(100);
		expect(profAt(clock, 7.5)).toBe(10);
		expect(profAt(clock, 8.5)).toBe(profAt(start, 1.5));
	});
});

describe('AverageProfile', () => {
	const args = (over) => ({
		xIN: 1,
		yIN: [2],
		period: 24,
		nBins: 24,
		out: { avgprofx: -1 },
		...over
	});
	beforeEach(() => {
		const { ms, y } = restActivity();
		setTime(ms, y);
	});

	it('since first sample: bin 0 is the hour starting at the first sample', () => {
		const [res] = averageProfile(args());
		expect(res.binCentres[0]).toBe(0.5);
		expect(res.perY[2].profile[0]).toBe(10); // 07:00 to 08:00
		expect(res.perY[2].profile[1]).toBe(100); // 08:00 to 09:00
	});

	it('clock time: bins are labelled by clock hour', () => {
		const [res] = averageProfile(args({ phaseReference: 'clock' }));
		const at = (c) => res.perY[2].profile[res.binCentres.indexOf(c)];
		expect(res.binCentres[0]).toBe(0.5);
		expect(at(7.5)).toBe(10);
		expect(at(8.5)).toBe(100);
		expect(at(17.5)).toBe(100);
		expect(at(18.5)).toBe(10);
		// SEM and counts follow their bins.
		expect(res.perY[2].n[res.binCentres.indexOf(8.5)]).toBe(8);
	});

	it('clock time stays on the clock when the first values are missing', () => {
		// Blank the first 3 hours (07:00 to 10:00): the fold then starts at 10:00, and
		// clock time must still label the 08:00 bin as 8.5.
		const { ms, y } = restActivity();
		setTime(
			ms,
			y.map((v, i) => (i < 3 ? null : v))
		);
		const [res] = averageProfile(args({ phaseReference: 'clock' }));
		const at = (c) => res.perY[2].profile[res.binCentres.indexOf(c)];
		expect(at(7.5)).toBe(10);
		expect(at(8.5)).toBe(100);
		expect(at(18.5)).toBe(10);
	});
});

describe('FitFunction phase ports', () => {
	const ref = { clock: true, offsetHours: 7 };
	it('cosinor acrophase: untouched since first sample, shifted and wrapped in clock time', () => {
		const fr = {
			mode: 'fixed',
			parameters: { period: 24 },
			fixedStats: {
				M: 1,
				harmonics: [{ k: 1, amplitude: 2, acrophase_hrs: 20, beta: 0, gamma: 0 }]
			}
		};
		expect(fitMetricValue('acrophase', 'cosinor', fr)).toBe(20);
		expect(fitMetricValue('acrophase', 'cosinor', fr, { clock: false, offsetHours: 0 })).toBe(20);
		expect(fitMetricValue('acrophase', 'cosinor', fr, ref)).toBe(3);
		expect(fitMetricValue('acrophase_h1', 'cosinor', fr, ref)).toBe(3);
		// Non-phase keys never move.
		expect(fitMetricValue('amplitude', 'cosinor', fr, ref)).toBe(2);
	});
	it('double logistic onset/offset wrap to the fitted period (24 h when non-periodic)', () => {
		const periodic = { onsetPhase: 23, offsetPhase: 5, parameters: { T: 24, t1: 23, t2: 29 } };
		expect(fitMetricValue('onset', 'doublelogistic', periodic, ref)).toBe(6);
		expect(fitMetricValue('offset', 'doublelogistic', periodic, ref)).toBe(12);
		const single = { onsetPhase: null, parameters: { t1: 30.5, t2: 40, T: null } };
		expect(fitMetricValue('onset', 'doublelogistic', single)).toBe(30.5);
		expect(fitMetricValue('onset', 'doublelogistic', single, ref)).toBe(13.5);
	});
	it('rectangular acrophase wraps to the fitted period', () => {
		const fr = { acrophase: 22, period: 24, parameters: {} };
		expect(fitMetricValue('acrophase', 'rectangular', fr, ref)).toBe(5);
	});
	it('multi-harmonic cosinor: amplitude/acrophase are the overall waveform, *_h1 harmonic 1', () => {
		const w = (2 * Math.PI) / 24;
		const h = (k, A, peak) => ({
			k,
			amplitude: A,
			acrophase_hrs: peak,
			beta: A * Math.cos(k * w * peak),
			gamma: A * Math.sin(k * w * peak)
		});
		const fr = {
			mode: 'fixed',
			parameters: { period: 24 },
			fixedStats: { M: 5, harmonics: [h(1, 2, 14), h(2, 1.5, 5)] }
		};
		expect(fitMetricValue('amplitude_h1', 'cosinor', fr)).toBe(2);
		expect(fitMetricValue('acrophase_h1', 'cosinor', fr)).toBe(14);
		expect(fitMetricValue('amplitude', 'cosinor', fr)).toBeCloseTo(3.049, 3);
		expect(fitMetricValue('acrophase', 'cosinor', fr)).toBeCloseTo(16.27, 2);
	});
});

describe('MovingAnalysis: rolling phases share one origin and match the whole record', () => {
	const base = (over) => ({
		xIN: 1,
		yIN: [2],
		windowSize: 72,
		stepSize: 12,
		binLabel: 'center',
		out: { movex: -1 },
		...over
	});

	it('npcra M10onset no longer jumps with each window start (was [1, 13, 1, 19, ...])', async () => {
		const { ms, y } = restActivity(10);
		setTime(ms, y);
		const a = base({ analysis: 'npcra', windowSize: 72, stepSize: 6 });
		const [res] = await movinganalysis(a);
		const onsets = res.y_results[2].M10onset;
		expect(onsets.length).toBeGreaterThan(4);
		// Every window agrees with the whole-record NPCRA (onset 1 h after the first sample).
		const t = mockColumns[1].hoursSinceStart;
		const whole = computeNPCRA(t, y, { epochHours: 1, period: 24 }).M10onset;
		expect(whole).toBe(1);
		for (const v of onsets) expect(v).toBe(whole);
		// Clock time: 08:00 in every window.
		const [clock] = await movinganalysis({ ...a, phaseReference: 'clock' });
		for (const v of clock.y_results[2].M10onset) expect(v).toBe(8);
	});

	it('free-period cosinor: C1_acrophase reads the window peak, not an extrapolation', async () => {
		// A fixed 14:00 peak for 20 days; the free fit's period wobbles per window.
		const ms = [];
		const y = [];
		for (let i = 0; i < 20 * 24 * 2; i++) {
			const v = START + i * 0.5 * H;
			ms.push(v);
			const clock = ((v - MIDNIGHT) / H) % 24;
			y.push(10 + 3 * Math.cos((2 * Math.PI * (clock - 14)) / 24) + 0.8 * Math.sin(i * 1.3));
		}
		setTime(ms, y);
		const a = base({
			analysis: 'cosinor',
			useFixedPeriod: false,
			Ncurves: 1,
			windowSize: 96,
			stepSize: 48
		});
		const [res] = await movinganalysis(a);
		const acro = res.y_results[2].C1_acrophase;
		expect(acro.filter(Number.isFinite).length).toBeGreaterThan(5);
		// 14:00 clock time is 7 h after the 07:00 start.
		for (const v of acro) expect(Math.abs(v - 7)).toBeLessThan(0.3);
		const [clock] = await movinganalysis({ ...a, phaseReference: 'clock' });
		for (const v of clock.y_results[2].C1_acrophase) expect(Math.abs(v - 14)).toBeLessThan(0.3);
	});

	it('free-period cosinor on a free-running rhythm: C1_acrophase drifts by tau - 24 per day', async () => {
		// tau = 24.5 h, first peak 7 h after the start. Each window must report the peak it
		// actually contains, on the 24 h frame, so successive windows (48 h apart) step by
		// +1 h: that drift is how a free-running period is read off a rolling phase plot.
		const tau = 24.5;
		const ms = [];
		const y = [];
		for (let i = 0; i < 16 * 24 * 2; i++) {
			const h = i * 0.5;
			ms.push(START + h * H);
			y.push(10 + 3 * Math.cos((2 * Math.PI * (h - 7)) / tau) + 0.3 * Math.sin(i * 1.3));
		}
		setTime(ms, y);
		const a = base({
			analysis: 'cosinor',
			useFixedPeriod: false,
			Ncurves: 1,
			windowSize: 96,
			stepSize: 48
		});
		const [res] = await movinganalysis(a);
		const acro = res.y_results[2].C1_acrophase;
		const centres = res.bins;
		for (let w = 0; w < acro.length; w++) {
			// The true peak nearest the window centre, folded onto 24 h.
			const k = Math.round((centres[w] - 7) / tau);
			const truth = (((7 + k * tau) % 24) + 24) % 24;
			const d = Math.abs(acro[w] - truth);
			expect(Math.min(d, 24 - d)).toBeLessThan(0.3);
		}
	});

	it('double logistic: onset is folded, not the absolute hour of the window (was 7.9, 55.8, ...)', async () => {
		const { ms, y } = restActivity(10);
		setTime(ms, y);
		const a = base({
			analysis: 'doublelogistic',
			dlPeriodic: true,
			useFixedPeriod: true,
			fixedPeriod: 24,
			windowSize: 72,
			stepSize: 48
		});
		const [res] = await movinganalysis(a);
		const onsets = res.y_results[2].onset.filter(Number.isFinite);
		expect(onsets.length).toBeGreaterThan(2);
		// Activity steps up between the 07:00 and 08:00 samples (0 to 1 h after the start),
		// in every window, so every window reports the same onset in that hour.
		expect(onsets[0]).toBeGreaterThan(0);
		expect(onsets[0]).toBeLessThan(1.5);
		for (const v of onsets) expect(Math.abs(v - onsets[0])).toBeLessThan(0.05);
		// Clock time: the same instants, 7 h later on the clock.
		const [clock] = await movinganalysis({ ...a, phaseReference: 'clock' });
		const clk = clock.y_results[2].onset.filter(Number.isFinite);
		for (let i = 0; i < clk.length; i++) expect(clk[i]).toBeCloseTo(onsets[i] + 7, 9);
	});

	it('fixed-period cosinor: H1_acrophase follows the reference (since start unchanged)', async () => {
		const { ms } = restActivity(6);
		const y = ms.map(
			(v) => 10 + 3 * Math.cos((2 * Math.PI * ((((v - MIDNIGHT) / H) % 24) - 14)) / 24)
		);
		setTime(ms, y);
		const a = base({ analysis: 'cosinor', useFixedPeriod: true, fixedPeriod: 24, nHarmonics: 1 });
		const [res] = await movinganalysis(a);
		for (const v of res.y_results[2].H1_acrophase) expect(v).toBeCloseTo(7, 6);
		const [clock] = await movinganalysis({ ...a, phaseReference: 'clock' });
		for (const v of clock.y_results[2].H1_acrophase) expect(v).toBeCloseTo(14, 6);
	});
});
