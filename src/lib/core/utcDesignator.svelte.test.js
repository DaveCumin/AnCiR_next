// @ts-nocheck
// A trailing Z ("2024-04-06T12:00:00Z") is ISO 8601's UTC designator: the text names an
// instant, exactly as "+00:00" does (plan ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md,
// section 5f). The import guesser (and Sequence Column, Simulate Data, the demos, the MCP render)
// write it as a literal "[Z]", and before 5f the app read such a column as a zone-less wall
// clock, so setting its zone MOVED every time by the zone's offset. Now setting the zone changes
// only the clock it is read on; with no zone nothing changes (UTC either way).
import { describe, it, expect, beforeEach } from 'vitest';
import { core, appState, pushObj, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { Column, getColumnById } from '$lib/core/Column.svelte';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import {
	guessDateofArray,
	formatHasOffset,
	valueOffsetMinutes,
	formatTimeFromUNIX
} from '$lib/utils/time/TimeUtils.js';
import { formatReadsOffset, utcDesignatorAsOffset } from '$lib/utils/time/offsetFormat.js';
import { columnClock, readsWallClockText, parseZoneOf, zoneShiftNote } from './columnTimeZone.js';
import { clockHourOfDay } from '$lib/utils/phaseReference.js';

const NZ = 'Pacific/Auckland';
const H = 3600000;
// 6 Apr 2024 12:00 UTC (01:00 NZDT on 7 Apr), hourly across the end of NZ daylight saving.
const T0 = Date.UTC(2024, 3, 6, 12);
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const VALUES = Array.from({ length: 6 }, (_, i) => iso(T0 + i * H));

function timeCol(values, extra) {
	const c = new Column({ type: 'time', ...extra });
	c.name = `t${c.id}`;
	core.rawData.set(c.id, values);
	c.data = c.id;
	pushObj(c);
	return getColumnById(c.id);
}

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
	core.tableProcesses = [];
	core.plots = [];
	appState.displayTimezone = 'utc';
	appState.showTimesIn = 'column';
});

describe('the UTC designator in a format', () => {
	it('the guesser writes a literal [Z], which reads as an offset', () => {
		const fmt = guessDateofArray(VALUES);
		expect(fmt).toMatch(/ss\[Z]$/);
		expect(formatHasOffset(fmt)).toBe(true);
		expect(valueOffsetMinutes(VALUES[0], fmt)).toBe(0);
	});

	it('only directly after a time of day', () => {
		expect(utcDesignatorAsOffset('YYYY-MM-DD[T]HH:mm:ss.SSS[Z]')).toBe(
			'YYYY-MM-DD[T]HH:mm:ss.SSSZ'
		);
		expect(formatReadsOffset('YYYY-MM-DD[T]HH:mm[Z]')).toBe(true);
		expect(formatReadsOffset('h:mm A[Z]')).toBe(true);
		expect(formatReadsOffset('[Z]YYYY-MM-DD HH:mm')).toBe(false);
		expect(formatReadsOffset('YYYY-MM-DD[Z]')).toBe(false);
		expect(formatReadsOffset('YYYY-MM-DD HH:mm [Z]')).toBe(false);
		expect(formatReadsOffset('YYYY-MM-DD[T]HH:mm:ss[ZZ]')).toBe(false);
		expect(formatReadsOffset('YYYY-MM-DD HH:mm')).toBe(false);
		expect(formatReadsOffset('YYYY-MM-DD[T]HH:mm:ssZ')).toBe(true);
		// A legacy Luxon format with a quoted Z ('Z') is normalised to [Z] first.
		expect(formatHasOffset("yyyy-LL-dd'T'HH:mm:ss.S'Z'")).toBe(true);
	});
});

describe('a column of Z text', () => {
	it('with no zone: the same UTC instants as before', () => {
		const c = timeCol(VALUES, { timeFormat: 'YYYY-MM-DD[T]HH:mm:ss[Z]' });
		expect(Array.from(c.getData())).toEqual(VALUES.map((_, i) => T0 + i * H));
		expect(readsWallClockText(c)).toBe(false);
		expect(c.timeFrame).toEqual({ zone: 'utc', wall: false });
		expect(formatTimeFromUNIX(T0, c)).toBe('06 Apr 2024 12:00:00');
	});

	it('with a zone: the instants stay, the clock is read in the zone', () => {
		const c = timeCol(VALUES, { timeFormat: 'YYYY-MM-DD[T]HH:mm:ss[Z]', timeZone: NZ });
		expect(Array.from(c.getData())).toEqual(VALUES.map((_, i) => T0 + i * H));
		expect(parseZoneOf(c)).toBeNull();
		expect(zoneShiftNote(c)).toBeNull();
		expect(columnClock(c)).toMatchObject({ zone: NZ, named: NZ, wall: false, legacy: false });
		expect(formatTimeFromUNIX(T0, c)).toBe('07 Apr 2024 01:00:00');
		expect(clockHourOfDay(T0 + H, columnClock(c).zone)).toBe(2); // 13:00 UTC = 02:00 NZDT
		expect(clockHourOfDay(T0 + 2 * H, columnClock(c).zone)).toBe(2); // 14:00 UTC = 02:00 NZST
	});

	it('the same text without the Z is a wall clock, which the zone does move', () => {
		const walls = VALUES.map((v) => v.replace('Z', ''));
		const c = timeCol(walls, { timeFormat: 'YYYY-MM-DD[T]HH:mm:ss', timeZone: NZ });
		expect(readsWallClockText(c)).toBe(true);
		expect(c.getData()[0]).toBe(T0 - 13 * H);
	});

	it('a saved session with a Z column and no zone loads and re-saves byte for byte', async () => {
		// As Sequence Column and Simulate Data write them (toISOString).
		const isoMs = VALUES.map((_, i) => new Date(T0 + i * H).toISOString());
		timeCol(isoMs, { timeFormat: 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]' });
		const saved = outputCoreAsJson();
		expect(saved.includes('"timeZone"')).toBe(false);
		core.data = [];
		core.rawData = new Map();
		await importJson(JSON.parse(saved));
		// The columns and their raw data (the rest is view state, not times).
		const part = (json) => {
			const o = JSON.parse(json);
			return JSON.stringify({ data: o.data, rawData: o.rawData });
		};
		expect(part(outputCoreAsJson())).toBe(part(saved));
		expect(Array.from(core.data[0].getData())).toEqual(VALUES.map((_, i) => T0 + i * H));
	});
});
