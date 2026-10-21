// @ts-nocheck
// Clock-time phases in the x column's own zone (per-column time zone, phase 2; plan
// ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md, section 3.7 and decision 6).
// Real maths, mocked columns: each mock carries the `timeFrame` a real Column derives.
//
// The record: 8 days hourly from 3 Apr 2024 07:00 UTC, a rhythm peaking at 02:00 UTC every
// day (15:00 NZDT before 7 Apr, 14:00 NZST after). Pacific/Auckland leaves daylight saving on
// 7 Apr 2024 inside the record.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockColumns, rawData, appState } = vi.hoisted(() => ({
	mockColumns: {},
	rawData: new Map(),
	appState: { displayTimezone: 'utc', showTimesIn: 'column' }
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

import { cosinor } from './Cosinor.svelte';
import { movinganalysis } from './MovingAnalysis.svelte';
import { resolveNodePhaseReference, windowClockOffsets } from './phaseReferenceSupport.js';

const NZ = 'Pacific/Auckland';
const H = 3600000;
const START = Date.UTC(2024, 3, 3, 7);
const MS = Array.from({ length: 8 * 24 }, (_, i) => START + i * H);
const utcHour = (v) => (((v / H) % 24) + 24) % 24;
const Y = MS.map(
	(v, i) => 10 + 3 * Math.cos((2 * Math.PI * (utcHour(v) - 2)) / 24) + 0.2 * Math.sin(i)
);

const OUT = {
	cosinorx: 50,
	cosinory_2: 51,
	period: 60,
	mesor: 61,
	amplitude: 62,
	acrophase: 63,
	amplitude_ciLow: 64,
	amplitude_ciHigh: 65,
	acrophase_ciLow: 66,
	acrophase_ciHigh: 67,
	rsquared: 68,
	pvalue: 69,
	perm_pvalue: 70,
	bathyphase: 71,
	phase_angle: 72,
	amplitude_h1: 73,
	acrophase_h1: 74,
	bathyphase_h1: 75
};

/** The x column: `frame` is what Column.timeFrame derives (zone, and wall clock or instant). */
function setTime(ms, frame) {
	rawData.clear();
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	const m = Math.min(...ms);
	mockColumns[1] = {
		type: 'time',
		timeFrame: frame,
		getData: () => ms,
		hoursSinceStart: ms.map((v) => (v - m) / H)
	};
	mockColumns[2] = { name: 'y', getData: () => Y.slice(0, ms.length) };
	for (const id of Object.values(OUT)) mockColumns[id] = { getData: () => rawData.get(id) ?? [] };
}

const cosinorArgs = {
	xIN: 1,
	yIN: [2],
	Ncurves: 1,
	outputX: -1,
	out: { ...OUT },
	useFixedPeriod: true,
	fixedPeriod: 24,
	nHarmonics: 1,
	alpha: 0.05,
	referenceHrs: 0,
	permuteTest: false,
	preProcesses: [],
	phaseReference: 'clock'
};

const movingArgs = {
	xIN: 1,
	yIN: [2],
	analysis: 'cosinor',
	useFixedPeriod: true,
	fixedPeriod: 24,
	Ncurves: 1,
	windowSize: 48,
	stepSize: 24,
	binLabel: 'center',
	out: { movex: -1 },
	phaseReference: 'clock'
};

beforeEach(() => {
	appState.displayTimezone = 'utc';
	appState.showTimesIn = 'column';
});

describe('Cosinor clock phase in the column zone', () => {
	it('a NZ instant column: the first sample offset (NZDT) plus a DST warning', async () => {
		setTime(MS, { zone: NZ, wall: false });
		const [res] = await cosinor(cosinorArgs);
		expect(rawData.get(63)[0]).toBeCloseTo(15, 1);
		expect(res.warnings).toContain(
			"Clock time uses the first sample's offset (UTC+13:00, Pacific/Auckland) for the whole record. Daylight saving ended on 7 Apr 2024, so phases after it read 1 h later than the local clock."
		);
	});

	it('no warning when the record does not cross a change', async () => {
		setTime(MS.slice(0, 72), { zone: NZ, wall: false });
		const [res] = await cosinor(cosinorArgs);
		expect(rawData.get(63)[0]).toBeCloseTo(15, 1);
		expect(res.warnings.some((w) => /Daylight saving/.test(w))).toBe(false);
	});

	it('a UTC column is unchanged (02:00) and has no warning', async () => {
		setTime(MS, { zone: 'utc', wall: true });
		const [res] = await cosinor(cosinorArgs);
		expect(rawData.get(63)[0]).toBeCloseTo(2, 1);
		expect(res.warnings.some((w) => /Daylight saving/.test(w))).toBe(false);
	});

	it('a zone-less column given a zone reads as written, and says elapsed time is off', async () => {
		setTime(MS, { zone: NZ, wall: true });
		const [res] = await cosinor(cosinorArgs);
		// Its stored ms are its wall clock, so the peak reads 02:00 as written.
		expect(rawData.get(63)[0]).toBeCloseTo(2, 1);
		expect(res.warnings.some((w) => /The times are as written/.test(w))).toBe(true);
	});

	it('"Show times in" does not move a clock phase (decision 2)', async () => {
		setTime(MS, { zone: NZ, wall: false });
		await cosinor(cosinorArgs);
		const before = rawData.get(63)[0];
		appState.showTimesIn = 'Europe/London';
		await cosinor(cosinorArgs);
		expect(rawData.get(63)[0]).toBe(before);
	});
});

describe('MovingAnalysis: each window uses its own offset (decision 6)', () => {
	it('windows before the change read NZDT (15:00), after it NZST (14:00)', async () => {
		setTime(MS, { zone: NZ, wall: false });
		const [res] = await movinganalysis(movingArgs);
		const acro = res.y_results[2].H1_acrophase;
		// Window centres: 24, 48, ... h after 3 Apr 07:00 UTC; the change is at 79 h.
		expect(acro.length).toBe(6);
		for (const v of acro.slice(0, 3)) expect(v).toBeCloseTo(15, 1);
		for (const v of acro.slice(3)) expect(v).toBeCloseTo(14, 1);
		expect(res.warnings).toContain(
			"Daylight saving ended on 7 Apr 2024 in Pacific/Auckland; each window's clock time uses the offset in force at its centre."
		);
	});

	it('the offsets themselves', () => {
		setTime(MS, { zone: NZ, wall: false });
		const ref = resolveNodePhaseReference({ phaseReference: 'clock' }, mockColumns[1], {
			perWindow: true
		});
		expect(ref.offsetHours).toBe(20);
		expect(windowClockOffsets(ref, [0, 78.99, 79, 100])).toEqual([20, 20, 19, 19]);
		// Without perWindow (every other node), no per-window zone.
		const one = resolveNodePhaseReference({ phaseReference: 'clock' }, mockColumns[1]);
		expect(windowClockOffsets(one, [0, 100])).toBeNull();
	});

	it('a legacy session keeps one offset for every window', async () => {
		appState.displayTimezone = NZ;
		setTime(MS, { zone: 'utc', wall: true });
		const [res] = await movinganalysis(movingArgs);
		for (const v of res.y_results[2].H1_acrophase) expect(v).toBeCloseTo(15, 1);
	});
});
