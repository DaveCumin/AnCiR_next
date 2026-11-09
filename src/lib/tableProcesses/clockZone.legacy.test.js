// @ts-nocheck
// A LEGACY session (saved before per-column zones with a non-UTC "Timezone" setting) must
// compute every clock-time phase EXACTLY as it did before phase 2 of the per-column time
// zone (plan ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md, section 3.11).
//
// The inline snapshots below were written by running this file against the code BEFORE
// phase 2 (commit 111192b6), so they pin the old numbers, DST crossing included: a legacy
// session reads every time in its one zone with the first sample's offset, and MovingAnalysis
// keeps that one offset for every window (the per-window offsets are for new sessions only).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockColumns, rawData, appState } = vi.hoisted(() => ({
	mockColumns: {},
	rawData: new Map(),
	appState: { displayTimezone: 'Pacific/Auckland' }
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
import { averageProfile } from './AverageProfile.svelte';
import { nonparametricRA } from './NonparametricRA.svelte';

const H = 3600000;
// 8 days hourly from 3 Apr 2024 07:00 UTC; Pacific/Auckland leaves daylight saving on
// 7 Apr 2024 03:00 NZDT (6 Apr 14:00 UTC), inside the record.
const START = Date.UTC(2024, 3, 3, 7);
const MS = Array.from({ length: 8 * 24 }, (_, i) => START + i * H);
const utcHour = (v) => (((v / H) % 24) + 24) % 24;
const Y = MS.map(
	(v, i) => 10 + 3 * Math.cos((2 * Math.PI * (utcHour(v) - 2)) / 24) + 0.2 * Math.sin(i)
);
const ACT = MS.map((v) => (utcHour(v) >= 20 || utcHour(v) < 6 ? 100 : 10));

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

function setTime(y) {
	rawData.clear();
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	mockColumns[1] = {
		type: 'time',
		getData: () => MS,
		hoursSinceStart: MS.map((v) => (v - START) / H)
	};
	mockColumns[2] = { name: 'y', getData: () => y };
	for (const id of Object.values(OUT)) mockColumns[id] = { getData: () => rawData.get(id) ?? [] };
}

const round = (v) => (Number.isFinite(v) ? Math.round(v * 1e9) / 1e9 : v);

beforeEach(() => {
	appState.displayTimezone = 'Pacific/Auckland';
});

describe('legacy session (display zone Pacific/Auckland): clock phases are unchanged', () => {
	it('Cosinor clock acrophase and bathyphase', async () => {
		setTime(Y);
		await cosinor({
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
		});
		expect([round(rawData.get(63)?.[0]), round(rawData.get(71)?.[0])]).toMatchInlineSnapshot(`
			[
			  15.005278888,
			  3.005278888,
			]
		`);
	});

	it('MovingAnalysis keeps ONE offset for every window', async () => {
		setTime(Y);
		const [res] = await movinganalysis({
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
		});
		expect(res.y_results[2].H1_acrophase.map(round)).toMatchInlineSnapshot(`
			[
			  15.019870547,
			  15.009126913,
			  14.987799117,
			  14.980518443,
			  14.995675876,
			  15.015738336,
			  15.017693398,
			]
		`);
	});

	it('AverageProfile and NPCRA clock times', async () => {
		setTime(ACT);
		const [ap] = averageProfile({
			xIN: 1,
			yIN: [2],
			period: 24,
			nBins: 24,
			out: { avgprofx: -1 },
			phaseReference: 'clock'
		});
		const [np] = await nonparametricRA({
			xIN: 1,
			yIN: [2],
			epochHours: 1,
			period: 24,
			mWindow: 10,
			lWindow: 5,
			out: { npcrax: -1 },
			phaseReference: 'clock'
		});
		expect({
			firstBins: ap.binCentres.slice(0, 3).map(round),
			firstProfile: ap.perY[2].profile.slice(0, 3).map(round),
			M10onset: round(np.perY[2].M10onset),
			L5onset: round(np.perY[2].L5onset)
		}).toMatchInlineSnapshot(`
			{
			  "L5onset": 20,
			  "M10onset": 9,
			  "firstBins": [
			    0.5,
			    1.5,
			    2.5,
			  ],
			  "firstProfile": [
			    10,
			    10,
			    10,
			  ],
			}
		`);
	});
});
