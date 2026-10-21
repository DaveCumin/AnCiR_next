// @ts-nocheck
// Pins written BEFORE per-column time zone phase 3 (DST-aware parsing) changed any parse, and
// kept unchanged after it. Phase 3 may move stored instants only for a column whose text has no
// offset AND that carries a non-UTC zone. Everything else must read exactly as before:
//
//   1. a session with no `timeZone` anywhere loads with byte-identical instants, and saves
//      byte-identically (text formats, padded/meridiem/array formats, text with offsets, epoch
//      ms, an AWD column, blanks and unreadable cells);
//   2. an explicit 'utc' zone is the same as none;
//   3. the Circular phase plot's clock hours do not move for a zone-less column (legacy session
//      or not), nor for a zone-less column given a zone at v82.54/v82.55 (its hours were its
//      wall clock then, and are its wall clock in its zone now).
//
// Plan: ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md, section 5c.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { core, appConsts, appState, pushObj, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { Column, getColumnById } from '$lib/core/Column.svelte';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { CircularPhaseClass } from '$lib/plots/CircularPhase/CircularPhase.svelte';

const at = (iso) => Date.parse(iso);

// [values, format, expected ms]. Expected values are written out, not computed by the parser.
const CASES = [
	[
		['2017-12-20 09:05:00', '2017-12-21 00:00:00', '', null, 'garbage'],
		'YYYY-MM-DD HH:mm:ss',
		[at('2017-12-20T09:05:00Z'), at('2017-12-21T00:00:00Z'), null, null, NaN]
	],
	[['2017-12-20 9:05:7'], 'YYYY-MM-DD H:mm:s', [at('2017-12-20T09:05:07Z')]],
	[
		['2020-01-01 07:30 pm', '2020-01-01 7:30 p.m.'],
		'YYYY-MM-DD h:mm a',
		[at('2020-01-01T19:30:00Z'), at('2020-01-01T19:30:00Z')]
	],
	[['2020-3-05 09:5:07'], 'YYYY-M-D H:m:s', [at('2020-03-05T09:05:07Z')]],
	[['13/05/2020'], 'D/M/YYYY', [at('2020-05-13T00:00:00Z')]],
	// Pacific/Auckland's repeated hour (7 Apr 2024) and skipped hour (29 Sep 2024), as text:
	// with no zone they are read as UTC, so a repeat stays a repeat and the gap stays a gap.
	[
		['2024-04-07 02:30:00', '2024-04-07 02:30:00', '2024-09-29 02:30:00'],
		'YYYY-MM-DD HH:mm:ss',
		[at('2024-04-07T02:30:00Z'), at('2024-04-07T02:30:00Z'), at('2024-09-29T02:30:00Z')]
	],
	[
		['2024-03-10T08:00:00+13:00', '2024-04-07T02:30:00Z'],
		'YYYY-MM-DD[T]HH:mm:ssZ',
		[at('2024-03-09T19:00:00Z'), at('2024-04-07T02:30:00Z')]
	],
	[
		['2024-01-02 03:04', '02/01/2024 03:04'],
		['YYYY-MM-DD HH:mm', 'DD/MM/YYYY HH:mm'],
		[at('2024-01-02T03:04:00Z'), at('2024-01-02T03:04:00Z')]
	],
	[
		[Date.UTC(2024, 3, 6, 13, 30), Date.UTC(2024, 3, 6, 14, 30)],
		'',
		[Date.UTC(2024, 3, 6, 13, 30), Date.UTC(2024, 3, 6, 14, 30)]
	]
];

const AWD_START = Date.UTC(2024, 3, 6, 12, 0);
const AWD_STEP = 3600000;

function textColumn(values, fmt, extra = {}) {
	const c = new Column({ type: 'time', timeFormat: fmt, ...extra });
	c.name = `t${c.id}`;
	core.rawData.set(c.id, values);
	c.data = c.id;
	pushObj(c);
	return c;
}

function awdColumn(extra = {}) {
	const c = new Column({ type: 'time', compression: 'awd', ...extra });
	c.name = 'DateTime';
	core.rawData.set(c.id, { start: AWD_START, step: AWD_STEP, length: 30 });
	c.data = c.id;
	pushObj(c);
	return c;
}

const same = (got, want) => {
	expect(got.length).toBe(want.length);
	got.forEach((v, i) => {
		if (want[i] === null) expect(v).toBeNull();
		else if (Number.isNaN(want[i])) expect(Number.isNaN(v)).toBe(true);
		else expect(v).toBe(want[i]);
	});
};

beforeAll(async () => {
	appConsts.tableProcessMap = await loadTableProcesses();
	history.init();
}, 60000);

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
	core.tableProcesses = [];
	core.orphanProcesses = [];
	core.plots = [];
	appState.displayTimezone = 'utc';
	appState.showTimesIn = 'column';
	history.clear();
});

describe('a session with no time zone reads and saves exactly as before', () => {
	it('every column: the same instants, before and after a save and load', async () => {
		const cols = CASES.map(([values, fmt]) => textColumn(values, fmt));
		const awd = awdColumn();
		const check = () => {
			CASES.forEach(([, , want], k) => same(Array.from(getColumnById(cols[k].id).getData()), want));
			const a = getColumnById(awd.id).getData();
			expect(a.length).toBe(30);
			expect(a[0]).toBe(AWD_START);
			expect(a[29]).toBe(AWD_START + 29 * AWD_STEP);
			expect(Array.from(getColumnById(awd.id).hoursSinceStart).slice(0, 3)).toEqual([0, 1, 2]);
		};
		check();
		const saved = outputCoreAsJson();
		expect(saved.includes('"timeZone"')).toBe(false);
		await importJson(JSON.parse(saved));
		check();
		// The columns and their raw data save again byte for byte (the rest of the session, view
		// counters and the like, is not about times).
		const part = (json) => {
			const o = JSON.parse(json);
			return JSON.stringify({ data: o.data, rawData: o.rawData });
		};
		expect(part(outputCoreAsJson())).toBe(part(saved));
	});

	it('a legacy session (Timezone = Pacific/Auckland) keeps its instants too', async () => {
		CASES.forEach(([values, fmt]) => textColumn(values, fmt));
		awdColumn();
		const s = JSON.parse(outputCoreAsJson());
		s.appState.displayTimezone = 'Pacific/Auckland';
		delete s.appState.showTimesIn;
		await importJson(s);
		expect(appState.displayTimezone).toBe('Pacific/Auckland');
		CASES.forEach(([, , want], k) => same(Array.from(core.data[k].getData()), want));
		expect(core.data[CASES.length].getData()[0]).toBe(AWD_START);
	});

	it("an explicit 'utc' zone reads the same as none", () => {
		CASES.forEach(([values, fmt, want]) => {
			const c = textColumn(values, fmt, { timeZone: 'utc' });
			same(Array.from(c.getData()), want);
		});
		expect(awdColumn({ timeZone: 'utc' }).getData()[0]).toBe(AWD_START);
	});
});

describe('Circular phase plot clock hours', () => {
	// Events at 06:00, 07:30 and 23:15 on the clock, the second across the 7 Apr change.
	const WALL = ['2024-04-06 06:00', '2024-04-07 07:30', '2024-04-08 23:15'];
	const WALL_HOURS = [6, 7.5, 23.25];

	function plotHours(timeCol) {
		const y = new Column({ type: 'number' });
		core.rawData.set(y.id, [1, 1, 1]);
		y.data = y.id;
		pushObj(y);
		const wrapper = {
			id: 1,
			type: 'circularphase',
			name: 'c',
			width: 400,
			height: 400,
			plot: null
		};
		const p = new CircularPhaseClass(wrapper, null);
		wrapper.plot = p;
		p.addData({ x: { refId: timeCol.id }, y: { refId: y.id } });
		p.period = 24;
		return p.data[0].angles.map((h) => Math.round((((h % 24) + 24) % 24) * 1e6) / 1e6);
	}

	it('a zone-less column: its written clock', () => {
		expect(plotHours(textColumn(WALL, 'YYYY-MM-DD HH:mm'))).toEqual(WALL_HOURS);
	});

	it('a zone-less column in a legacy Pacific/Auckland session: still the written clock', () => {
		appState.displayTimezone = 'Pacific/Auckland';
		expect(plotHours(textColumn(WALL, 'YYYY-MM-DD HH:mm'))).toEqual(WALL_HOURS);
	});

	it('a zone-less column given Pacific/Auckland (as saved at v82.55): its written clock', () => {
		expect(
			plotHours(textColumn(WALL, 'YYYY-MM-DD HH:mm', { timeZone: 'Pacific/Auckland' }))
		).toEqual(WALL_HOURS);
	});
});
