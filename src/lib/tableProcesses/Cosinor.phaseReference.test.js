// Cosinor: phase reference (FIT-9), multi-harmonic overall waveform (FIT-13) and
// the output time origin (STAT-19). Real maths, mocked columns.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockColumns, rawData, appState } = vi.hoisted(() => ({
	mockColumns: {},
	rawData: new Map(),
	appState: { displayTimezone: 'utc' }
}));
vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData },
	appState,
	appConsts: { processMap: new Map() }
}));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));

import { cosinor, cosinorStatsTable, definition } from './Cosinor.svelte';
import { multiComponentWaveform } from '$lib/utils/cosinorAddons.js';

const H = 3600000;
const START = Date.UTC(2026, 2, 2, 7, 0, 0); // 07:00 UTC

const OUT_IDS = {
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

const args = (over) => ({
	xIN: 1,
	yIN: [2],
	Ncurves: 1,
	outputX: -1,
	out: { ...OUT_IDS },
	useFixedPeriod: true,
	fixedPeriod: 24,
	nHarmonics: 1,
	alpha: 0.05,
	referenceHrs: 0,
	permuteTest: false,
	preProcesses: [],
	...over
});

/** A time column of epoch ms (any order, nulls allowed), hours measured from the minimum. */
function setTimeData(ms, y) {
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
	for (const id of Object.values(OUT_IDS)) {
		mockColumns[id] = { getData: () => rawData.get(id) ?? [] };
	}
}

const port = (key) => rawData.get(OUT_IDS[key])?.[0];

// 6 days at 30 min from 07:00, peaking at 14:00 clock time (7 h after the start).
const ms6 = Array.from({ length: 288 }, (_, i) => START + i * 0.5 * H);
const clockOf = (v) => ((((v - Date.UTC(2026, 2, 2)) / H) % 24) + 24) % 24;
const y14 = ms6.map(
	(v) => 10 + 3 * Math.cos((2 * Math.PI * (clockOf(v) - 14)) / 24) + 0.3 * Math.sin(v / 1e6)
);

describe('FIT-9: phase reference', () => {
	beforeEach(() => {
		appState.displayTimezone = 'utc';
		setTimeData(ms6, y14);
	});

	it('declares phaseReference, defaulting to since first sample', () => {
		expect(definition.defaults.get('phaseReference').val).toBe('start');
	});

	it('since first sample: a 14:00 peak in a record starting 07:00 reads 7 h', async () => {
		await cosinor(args());
		expect(port('acrophase')).toBeCloseTo(7, 1);
		expect(port('bathyphase')).toBeCloseTo(19, 1);
	});

	it('a saved session without the arg reports exactly what "start" does', async () => {
		await cosinor(args());
		const before = Object.fromEntries(Object.keys(OUT_IDS).map((k) => [k, port(k)]));
		await cosinor(args({ phaseReference: 'start' }));
		for (const k of Object.keys(OUT_IDS)) {
			if (k === 'cosinorx' || k === 'cosinory_2') continue;
			expect(Object.is(port(k), before[k]), k).toBe(true);
		}
	});

	it('clock time: the same peak reads 14 h; bathyphase, CIs and phase angle follow', async () => {
		await cosinor(args({ phaseReference: 'clock', referenceHrs: 8 }));
		expect(port('acrophase')).toBeCloseTo(14, 1);
		expect(port('acrophase_h1')).toBeCloseTo(14, 1);
		expect(port('bathyphase')).toBeCloseTo(2, 1);
		expect(port('acrophase_ciLow')).toBeLessThan(port('acrophase'));
		expect(port('acrophase_ciHigh')).toBeGreaterThan(port('acrophase'));
		// Phase angle against a reference of 08:00 clock time: 6 h.
		expect(port('phase_angle')).toBeCloseTo(6, 1);
	});

	it('clock time honours the display timezone', async () => {
		appState.displayTimezone = 'Pacific/Auckland'; // UTC+13 in March (daylight time)
		await cosinor(args({ phaseReference: 'clock' }));
		expect(port('acrophase')).toBeCloseTo((14 + 13) % 24, 1);
	});

	it('the stats table prints the referenced acrophase', async () => {
		const a = args({ phaseReference: 'clock' });
		const [data] = await cosinor(a);
		const table = cosinorStatsTable(data, a);
		const c = table.headers.indexOf('H1_acrophase_clock_h');
		expect(c).toBeGreaterThan(-1);
		expect(table.rows[0][c]).toBeCloseTo(port('acrophase'), 12);
	});

	it('clock time on a numeric x falls back to since first sample, with a warning', async () => {
		const t = ms6.map((_, i) => i * 0.5);
		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		const [data] = await cosinor(args({ phaseReference: 'clock' }));
		expect(port('acrophase')).toBeCloseTo(7, 1);
		expect(data.warnings.join(' ')).toMatch(/needs a time column/);
	});
});

describe('FIT-13: multi-harmonic cosinor reports the overall waveform', () => {
	// Asymmetric two-harmonic rhythm: harmonic 1 peaks at 14 h, the curve at about 16.27 h.
	const t = Array.from({ length: 288 }, (_, i) => i * 0.5);
	const w = (2 * Math.PI) / 24;
	const y = t.map(
		(ti) =>
			5 +
			2 * Math.cos(w * (ti - 14)) +
			1.5 * Math.cos(2 * w * (ti - 17)) +
			0.05 * Math.sin(ti * 1.7)
	);
	beforeEach(() => {
		setTimeData(
			t.map((h) => Date.UTC(2026, 2, 2) + h * H),
			y
		);
	});

	it('amplitude/acrophase/bathyphase describe the fitted curve; *_h1 keep harmonic 1', async () => {
		const [data] = await cosinor(args({ nHarmonics: 2 }));
		const s = data.y_results[2].fixedStats;
		const overall = multiComponentWaveform(s.M, s.harmonics, 24);
		expect(port('amplitude')).toBeCloseTo(overall.amplitude, 12);
		expect(port('acrophase')).toBeCloseTo(overall.orthophase, 12);
		expect(port('bathyphase')).toBeCloseTo(overall.bathyphase, 12);
		expect(port('acrophase')).toBeCloseTo(16.27, 1);
		expect(port('amplitude')).toBeCloseTo(3.05, 1);
		// Harmonic 1 stays available under its own ports.
		expect(port('amplitude_h1')).toBeCloseTo(2, 1);
		expect(port('acrophase_h1')).toBeCloseTo(14, 1);
		expect(port('bathyphase_h1')).toBeCloseTo(2, 1);
		// The phase angle follows the reported (overall) acrophase.
		expect(port('phase_angle')).toBeCloseTo(-(24 - port('acrophase')), 6);
	});

	it('one harmonic: the ports are unchanged, and *_h1 equal them', async () => {
		await cosinor(args({ nHarmonics: 1 }));
		expect(port('amplitude_h1')).toBe(port('amplitude'));
		expect(port('acrophase_h1')).toBe(port('acrophase'));
		expect(port('bathyphase_h1')).toBe(port('bathyphase'));
		// Still the harmonic-1 closed form (acrophase + P/2), not the dense evaluation.
		expect(port('bathyphase')).toBe((port('acrophase') + 12) % 24);
	});
});

describe('STAT-19: the fitted-curve x axis uses the minimum valid time as origin', () => {
	it('unsorted input with a missing first value maps every fitted point back to its own time', async () => {
		// Shuffle 2 days at 1 h and blank the first row; hours are measured from the minimum.
		const base = Array.from({ length: 48 }, (_, i) => START + i * H);
		const order = base.map((_, i) => (i * 17) % 48);
		const ms = [null, ...order.map((i) => base[i])];
		const y = ms.map((v) =>
			v == null ? null : 10 + 3 * Math.cos((2 * Math.PI * ((v - START) / H - 7)) / 24)
		);
		setTimeData(ms, y);
		await cosinor(args());
		const xOut = rawData.get(OUT_IDS.cosinorx);
		// The fitted x is the input's valid times in input order, as timestamps.
		expect(xOut).toEqual(ms.filter((v) => v != null));
	});

	it('a time output grid starting later than the input is evaluated in the input frame', async () => {
		setTimeData(ms6, y14);
		// Output grid: 4 points starting 10 h after the input starts.
		const grid = [0, 1, 2, 3].map((i) => START + (10 + i) * H);
		mockColumns[9] = {
			type: 'time',
			getData: () => grid,
			hoursSinceStart: [0, 1, 2, 3]
		};
		const [data] = await cosinor(args({ outputX: 9 }));
		expect(rawData.get(OUT_IDS.cosinorx)).toEqual(grid);
		const s = data.y_results[2].fixedStats;
		const omega = (2 * Math.PI) / 24;
		const at = (h) =>
			s.M + s.harmonics[0].beta * Math.cos(omega * h) + s.harmonics[0].gamma * Math.sin(omega * h);
		expect(rawData.get(OUT_IDS.cosinory_2)[0]).toBeCloseTo(at(10), 10);
	});
});
