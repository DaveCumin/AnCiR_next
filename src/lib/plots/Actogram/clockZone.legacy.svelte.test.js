// @ts-nocheck
// A LEGACY session (saved before per-column zones with a non-UTC "Timezone" setting) keeps
// every clock-time reading of the actogram, the hour-of-day colour and the Bin Data start
// field EXACTLY as before phase 2 of the per-column time zone (plan
// ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md, section 3.11).
//
// The inline snapshots were written by running this file against the code BEFORE phase 2
// (commit 111192b6), where these consumers read the one display zone (getDisplayZone,
// formatDateTimeLocalInput); they now read the clock of their column (core/columnTimeZone.js
// `columnClock`), which is the legacy zone here.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { loadPlots } from '$test/plotRegistry.js';
import { rowLabelText } from './rowLabels.js';
import { encodingValues } from '$lib/components/plotbits/encodings.js';
import { colourBarTitle } from '$lib/components/plotbits/encodingHost.js';
import { columnClock, formatClockInput, parseClockInput } from '$lib/core/columnTimeZone.js';

const PLOTS = await loadPlots();
const H = 3600000;
// 8 days hourly from 3 Apr 2024 07:00 UTC, across the end of NZ daylight saving (7 Apr).
const START = Date.UTC(2024, 3, 3, 7);
const MS = Array.from({ length: 8 * 24 }, (_, i) => START + i * H);

beforeAll(() => {
	appConsts.plotMap = PLOTS;
});
beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	appState.displayTimezone = 'Pacific/Auckland';
	appState.showTimesIn = 'column';
});

function actogram() {
	const t = new Column({ type: 'time', data: -1 });
	core.rawData.set(t.id, MS);
	t.data = t.id;
	core.data.push(t);
	const v = new Column({ type: 'number', data: -1 });
	core.rawData.set(
		v.id,
		MS.map((_, i) => i % 24)
	);
	v.data = v.id;
	core.data.push(v);
	core.plots.push(
		new Plot({
			type: 'actogram',
			name: 'a',
			width: 400,
			height: 300,
			plot: { data: [{ x: { refId: t.id }, y: { refId: v.id } }] }
		})
	);
	return { plot: core.plots.at(-1), t };
}

describe('legacy session (Pacific/Auckland): clock readings are unchanged', () => {
	it('actogram day start and date row labels', () => {
		const { plot } = actogram();
		const zone = plot.plot.clockZone;
		const labels = Array.from({ length: 8 }, (_, d) =>
			rowLabelText(d, {
				mode: 'date',
				startTime: plot.plot.startTime,
				periodHrs: 24,
				dateFormat: 'DD MMM HH:mm',
				zone
			})
		);
		expect({ startTime: plot.plot.startTime, labels }).toMatchInlineSnapshot(`
			{
			  "labels": [
			    "03 Apr 00:00",
			    "04 Apr 00:00",
			    "05 Apr 00:00",
			    "06 Apr 00:00",
			    "07 Apr 00:00",
			    "07 Apr 23:00",
			    "08 Apr 23:00",
			    "09 Apr 23:00",
			  ],
			  "startTime": 1712055600000,
			}
		`);
	});

	it('hour-of-day colour values and the colour bar title', () => {
		const { t } = actogram();
		const clock = columnClock(t);
		const zone = clock.zone;
		const { values } = encodingValues('hourOfDay', MS.slice(70, 76), { type: 'time', zone });
		expect({ values, title: colourBarTitle('hourOfDay', { zone: clock.named }) })
			.toMatchInlineSnapshot(`
			{
			  "title": "Hour of day (Pacific/Auckland)",
			  "values": [
			    18,
			    19,
			    20,
			    21,
			    22,
			    23,
			  ],
			}
		`);
	});

	it('the Bin Data start field reads and writes in the legacy zone', () => {
		const { t } = actogram();
		const shown = formatClockInput(START + 1.5 * H, t);
		expect({ shown, back: parseClockInput(shown, t) }).toMatchInlineSnapshot(`
			{
			  "back": 1712133000000,
			  "shown": "2024-04-03T21:30:00",
			}
		`);
	});
});
