// @ts-nocheck
// Per-column time zone, PHASE 2: the clock-time consumers read each column's own zone
// (plan ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md, sections 3.4 to 3.8 and
// decisions 2 and 5 to 8), on the real core, plots and nodes.
//
// Two kinds of column are tested throughout:
//   - a true-instant column (epoch ms, or text with offsets) with a zone: its clock is that
//     zone, DST included;
//   - a zone-less text column given a zone: since phase 3 its wall clock is resolved in that
//     zone, so it is a true-instant column too and reads exactly as written in its zone
//     (phases 1 and 2 kept its ms as the wall clock read as UTC).
// Legacy sessions are pinned separately (plots/Actogram/clockZone.legacy.svelte.test.js and
// tableProcesses/clockZone.legacy.test.js).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
import { core, appConsts, appState, pushObj } from '$lib/core/core.svelte.js';
import { Column, getColumnById } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { TableProcess } from '$lib/core/TableProcess.svelte';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';
import { applyOp } from '$lib/core/operations.js';
import { buildTableProcessDefaults } from '$lib/core/tpDefaults.js';
import { history } from '$lib/core/opHistory.svelte.js';
import {
	columnClock,
	clockCacheKey,
	clockDstChanges,
	formatClockInput,
	parseClockInput
} from './columnTimeZone.js';
import { rowLabelText } from '$lib/plots/Actogram/rowLabels.js';
import { firstBandStart } from '$lib/utils/aiEdit.js';
import { joindata } from '$lib/tableProcesses/JoinData.svelte';

const NZ = 'Pacific/Auckland';
const H = 3600000;
// Pacific/Auckland left daylight saving at 03:00 NZDT on 7 Apr 2024 (6 Apr 14:00 UTC).
const NZ_DST_END = Date.UTC(2024, 3, 6, 14);
// 8 days hourly from 3 Apr 2024 07:00 UTC (20:00 NZDT), across that change.
const START = Date.UTC(2024, 3, 3, 7);
const MS = Array.from({ length: 8 * 24 }, (_, i) => START + i * H);

function timeCol(values, extra = {}) {
	const c = new Column({ type: 'time', data: -1, ...extra });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return core.data.at(-1);
}

function numCol(values) {
	const c = new Column({ type: 'number', data: -1 });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return core.data.at(-1);
}

function actogram(series) {
	core.plots.push(
		new Plot({
			type: 'actogram',
			name: 'a',
			width: 400,
			height: 300,
			plot: {
				data: series.map((t) => ({
					x: { refId: t.id },
					y: { refId: numCol(t.getData().map((_, i) => i % 24)).id }
				}))
			}
		})
	);
	return core.plots.at(-1).plot;
}

/** Wall clock text, as a logger without a zone writes it. */
const wallText = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

beforeAll(async () => {
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
	history.init();
}, 60000);

beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	core.tableProcesses = [];
	core.orphanProcesses = [];
	appState.displayTimezone = 'utc';
	appState.showTimesIn = 'column';
	history.clear();
});

describe('columnClock', () => {
	it('an instant column reads in its zone; so does zone-less text given one (phase 3)', () => {
		const inst = timeCol(MS, { timeZone: NZ });
		expect(columnClock(inst)).toEqual({ zone: NZ, named: NZ, wall: false, legacy: false });
		const zoned = timeCol(MS.map(wallText), { timeFormat: 'YYYY-MM-DD HH:mm', timeZone: NZ });
		expect(columnClock(zoned)).toEqual({ zone: NZ, named: NZ, wall: false, legacy: false });
		const asWritten = timeCol(MS.map(wallText), { timeFormat: 'YYYY-MM-DD HH:mm' });
		expect(columnClock(asWritten)).toEqual({
			zone: 'utc',
			named: 'utc',
			wall: true,
			legacy: false
		});
		expect(columnClock(null)).toEqual({ zone: 'utc', named: 'utc', wall: true, legacy: false });
	});

	it('a legacy session keeps its one zone for every column', () => {
		appState.displayTimezone = NZ;
		const c = timeCol(MS, { timeZone: '+05:30' });
		expect(columnClock(c)).toEqual({ zone: NZ, named: NZ, wall: false, legacy: true });
	});

	it('"Show times in" never moves it (decision 2, the STAT-18 fix)', () => {
		const c = timeCol(MS, { timeZone: NZ });
		const before = columnClock(c);
		appState.showTimesIn = 'Europe/London';
		expect(columnClock(c)).toEqual(before);
	});
});

describe('actogram day start, row labels and x labels', () => {
	it('a NZ column starts at NZ midnight, a UTC column at UTC midnight', () => {
		const nz = actogram([timeCol(MS, { timeZone: NZ })]);
		// First sample 3 Apr 20:00 NZDT: its day starts 3 Apr 00:00 NZDT = 2 Apr 11:00 UTC.
		expect(nz.startTime).toBe(Date.UTC(2024, 3, 2, 11));
		expect(nz.clockZone).toBe(NZ);
		const utc = actogram([timeCol(MS)]);
		expect(utc.startTime).toBe(Date.UTC(2024, 3, 3));
	});

	it('a half-hour fixed offset (+05:30) starts at its own midnight', () => {
		const p = actogram([timeCol(MS, { timeZone: '+05:30' })]);
		// 3 Apr 07:00 UTC = 12:30 +05:30, so the day starts 2 Apr 18:30 UTC.
		expect(p.startTime).toBe(Date.UTC(2024, 3, 2, 18, 30));
		expect(
			rowLabelText(0, {
				mode: 'date',
				startTime: p.startTime,
				dateFormat: 'DD MMM HH:mm',
				zone: p.clockZone
			})
		).toBe('03 Apr 00:00');
	});

	it('a zone-less column given a zone starts at its written midnight, in its zone', () => {
		const p = actogram([
			timeCol(MS.map(wallText), { timeFormat: 'YYYY-MM-DD HH:mm', timeZone: NZ })
		]);
		// Written 3 Apr 07:00 in Auckland (NZDT): the day starts 3 Apr 00:00 NZDT.
		expect(p.startTime).toBe(Date.UTC(2024, 3, 2, 11));
		expect(p.clockZone).toBe(NZ);
		expect(
			rowLabelText(0, {
				mode: 'date',
				startTime: p.startTime,
				dateFormat: 'DD MMM HH:mm',
				zone: p.clockZone
			})
		).toBe('03 Apr 00:00');
	});

	it('row labels follow the zone; after the DST change rows start at 23:00 NZST', () => {
		const p = actogram([timeCol(MS, { timeZone: NZ })]);
		const labels = Array.from({ length: 6 }, (_, d) =>
			rowLabelText(d, {
				mode: 'date',
				startTime: p.startTime,
				periodHrs: 24,
				dateFormat: 'DD MMM HH:mm',
				zone: p.clockZone
			})
		);
		expect(labels).toEqual([
			'03 Apr 00:00',
			'04 Apr 00:00',
			'05 Apr 00:00',
			'06 Apr 00:00',
			'07 Apr 00:00',
			'07 Apr 23:00'
		]);
	});

	it('"Show times in" does not move the day start (STAT-18)', () => {
		const p = actogram([timeCol(MS, { timeZone: NZ })]);
		const before = p.startTime;
		appState.showTimesIn = 'Europe/London';
		flushSync();
		expect(p.startTime).toBe(before);
		appState.showTimesIn = 'utc';
		flushSync();
		expect(p.startTime).toBe(before);
	});
});

describe('actogram notes', () => {
	it('a DST change inside the record is said, with the local row start after it', () => {
		const p = actogram([timeCol(MS, { timeZone: NZ })]);
		expect(p.dstNote).toBe(
			'Daylight saving ended on 7 Apr 2024 in Pacific/Auckland. Rows are 24 h of elapsed time, so rows after it start at 23:00 local time.'
		);
	});

	it('no note without a change in the record, and none for UTC or a fixed offset', () => {
		const may = Array.from({ length: 5 * 24 }, (_, i) => Date.UTC(2024, 4, 1) + i * H);
		expect(actogram([timeCol(may, { timeZone: NZ })]).dstNote).toBeNull();
		expect(actogram([timeCol(MS)]).dstNote).toBeNull();
		expect(actogram([timeCol(MS, { timeZone: '+13:00' })]).dstNote).toBeNull();
	});

	it('a zone-less column in a DST zone reads like an instant column (phase 3)', () => {
		const p = actogram([
			timeCol(MS.map(wallText), { timeFormat: 'YYYY-MM-DD HH:mm', timeZone: NZ })
		]);
		expect(p.dstNote).toBe(
			'Daylight saving ended on 7 Apr 2024 in Pacific/Auckland. Rows are 24 h of elapsed time, so rows after it start at 23:00 local time.'
		);
	});

	it('mixed zones: the first series decides and the panel says so (decision 7)', () => {
		const p = actogram([timeCol(MS, { timeZone: NZ }), timeCol(MS)]);
		expect(p.clock.named).toBe(NZ);
		expect(p.clockZonesDiffer).toBe(true);
		expect(p.startTime).toBe(Date.UTC(2024, 3, 2, 11));
		const same = actogram([timeCol(MS, { timeZone: NZ }), timeCol(MS, { timeZone: NZ })]);
		expect(same.clockZonesDiffer).toBe(false);
	});
});

describe('light bands in the column zone', () => {
	it("the actogram's light band sits on rows that start at the column's midnight", () => {
		const p = actogram([timeCol(MS, { timeZone: '+05:30' })]);
		p.lightBands.bands = [
			{ pc: 25, col: '#000000' },
			{ pc: 75, col: '#ffffff' }
		];
		// The bar is a share of each row, so its dark quarter is 00:00 to 06:00 at +05:30.
		const rowStart = p.startTime;
		expect(new Date(rowStart).toISOString()).toBe('2024-04-02T18:30:00.000Z');
		expect(rowStart + 0.25 * 24 * H).toBe(Date.UTC(2024, 3, 3, 0, 30));
	});

	it("a scatterplot band from an AI edit starts at 18:00 in the x column's zone", () => {
		const t = timeCol(MS, { timeZone: '+05:30' });
		core.plots.push(
			new Plot({
				type: 'scatterplot',
				name: 's',
				width: 400,
				height: 300,
				plot: { data: [{ x: { refId: t.id }, y: { refId: numCol(MS.map(() => 1)).id } }] }
			})
		);
		const inner = core.plots.at(-1).plot;
		const ctx = inner.overlayContext();
		expect(ctx.xClockZone).toBe('+05:30');
		const start = firstBandStart(
			{ anyXdataTime: true, xlims: [START, MS.at(-1)] },
			18,
			ctx.xClockZone
		);
		// 18:00 at +05:30 is 12:30 UTC, on the first day (07:00 UTC is 12:30 local).
		expect(start).toBe(Date.UTC(2024, 3, 3, 12, 30));
	});
});

describe('Bin Data start field', () => {
	it('round trips in a +05:30 column: shown and typed in its own clock', () => {
		const t = timeCol(MS, { timeZone: '+05:30' });
		expect(formatClockInput(START, t)).toBe('2024-04-03T12:30:00');
		const ms = parseClockInput('2024-04-04T00:00:00', t);
		expect(ms).toBe(Date.UTC(2024, 3, 3, 18, 30));
		expect(formatClockInput(ms, t)).toBe('2024-04-04T00:00:00');
		// "Show times in" does not move it.
		appState.showTimesIn = NZ;
		expect(formatClockInput(START, t)).toBe('2024-04-03T12:30:00');
	});

	it('a zone-less column reads and writes as written', () => {
		const t = timeCol(MS.map(wallText), { timeFormat: 'YYYY-MM-DD HH:mm', timeZone: NZ });
		const first = t.getData()[0];
		expect(formatClockInput(first, t)).toBe('2024-04-03T07:00:00');
		expect(parseClockInput('2024-04-03T07:00:00', t)).toBe(first);
	});

	it('a real Bin Data node starts its bins at the typed local midnight', () => {
		const t = timeCol(MS, { timeZone: '+05:30' });
		const y = numCol(MS.map(() => 1));
		const args = buildTableProcessDefaults(appConsts.tableProcessMap.get('BinnedData'));
		Object.assign(args, { xIN: t.id, yIN: [y.id], binSize: 24 });
		const ms = parseClockInput('2024-04-04T00:00:00', t);
		args.binStart = (ms - START) / H;
		const tp = new TableProcess({ name: 'BinnedData', args }, null);
		pushObj(tp);
		flushSync();
		const xOut = getColumnById(
			Object.values(tp.args.out).find((id) => getColumnById(id)?.type === 'time')
		);
		expect(xOut).toBeTruthy();
		// The binned time is each bin's start: the first is local midnight 4 Apr (+05:30).
		expect(xOut.getData()[0]).toBe(Date.UTC(2024, 3, 3, 18, 30));
		expect(formatClockInput(xOut.getData()[1], t)).toBe('2024-04-05T00:00:00');
	});
});

describe('Join Data', () => {
	function join(a, b, shiftB = 0) {
		const av = numCol(a.getData().map(() => 1));
		const bv = numCol(b.getData().map(() => 2));
		const tp = new TableProcess(
			{
				name: 'JoinData',
				args: {
					pairing: {},
					shiftB,
					sourceColumn: false,
					aTimeIN: a.id,
					aValuesIN: [av.id],
					bTimeIN: b.id,
					bValuesIN: [bv.id],
					out: { jointime: -1, [`joined_${av.id}`]: -1, [`joined_${bv.id}`]: -1 }
				}
			},
			null
		);
		pushObj(tp);
		return joindata(tp.args)[0];
	}

	it("says the output is in A's zone; two instant columns in different zones line up", () => {
		const res = join(timeCol(MS.slice(0, 4), { timeZone: NZ }), timeCol(MS.slice(0, 4)));
		expect(res.summary).toContain("Joined times are in A's zone (Pacific/Auckland).");
		expect(res.zoneWarning).toBeNull();
	});

	it('warns that a non-zero shift between two instant columns double corrects', () => {
		const res = join(timeCol(MS.slice(0, 4), { timeZone: NZ }), timeCol(MS.slice(0, 4)), 13);
		expect(res.zoneWarning).toBe(
			"A's times are in Pacific/Auckland and B's in UTC; each is read in its own zone, so they already line up and the zones account for the difference: check the 13 h shift."
		);
	});

	it('a zone-less side given a zone is an instant column: no warning (phase 3)', () => {
		const a = timeCol(MS.slice(0, 4).map(wallText), {
			timeFormat: 'YYYY-MM-DD HH:mm',
			timeZone: NZ
		});
		const res = join(a, timeCol(MS.slice(0, 4)));
		expect(res.zoneWarning).toBeNull();
		expect(res.summary).toContain("A's zone (Pacific/Auckland)");
	});

	it('names a zone-less side left as UTC, in case its clock was in the other zone', () => {
		const a = timeCol(MS.slice(0, 4), { timeZone: NZ });
		const b = timeCol(MS.slice(0, 4).map(wallText), { timeFormat: 'YYYY-MM-DD HH:mm' });
		expect(join(a, b).zoneWarning).toBe(
			"B's times have no zone, so they are read as UTC. If they were recorded in Pacific/Auckland time, set B's zone (in its column's Properties) and the two line up."
		);
	});

	it('says nothing for two UTC columns (the default)', () => {
		const res = join(timeCol(MS.slice(0, 4)), timeCol(MS.slice(0, 4)));
		expect(res.summary).not.toContain('zone');
		expect(res.zoneWarning).toBeNull();
	});
});

describe('cache keys and undo', () => {
	it("a node's clock cache key changes with the column's zone, and undo puts it back", () => {
		const t = timeCol(MS);
		expect(clockCacheKey(t)).toBe('utc');
		const p = actogram([t]);
		const startUtc = p.startTime;
		applyOp({ kind: 'setColumnTimeZone', id: t.id, zone: NZ });
		flushSync();
		expect(clockCacheKey(t)).toBe(NZ);
		expect(p.startTime).toBe(Date.UTC(2024, 3, 2, 11));
		history.undo();
		flushSync();
		expect(clockCacheKey(t)).toBe('utc');
		expect(p.startTime).toBe(startUtc);
		history.redo();
		flushSync();
		expect(clockCacheKey(t)).toBe(NZ);
	});

	it('a zone-less column keys by its zone, and its data change with it (phase 3)', () => {
		const t = timeCol(MS.map(wallText), { timeFormat: 'YYYY-MM-DD HH:mm' });
		expect(clockCacheKey(t)).toBe('utc');
		const hash = t.getDataHash;
		const before = t.getData()[0];
		t.timeZone = NZ;
		flushSync();
		expect(clockCacheKey(t)).toBe(NZ);
		expect(t.getDataHash).not.toBe(hash);
		expect(t.getData()[0]).toBe(before - 13 * H);
	});

	it('a legacy session keeps its old key (the legacy zone)', () => {
		appState.displayTimezone = NZ;
		expect(clockCacheKey(timeCol(MS, { timeZone: '+05:30' }))).toBe(NZ);
	});
});

describe('clockDstChanges', () => {
	it('finds the NZ change at its instant, in both kinds of column', () => {
		const inst = clockDstChanges(columnClock(timeCol(MS, { timeZone: NZ })), MS[0], MS.at(-1));
		expect(inst).toEqual([{ at: NZ_DST_END, before: 780, after: 720 }]);
		const wall = timeCol(MS.map(wallText), { timeFormat: 'YYYY-MM-DD HH:mm', timeZone: NZ });
		const w = clockDstChanges(columnClock(wall), wall.getData()[0], wall.getData().at(-1));
		expect(w).toEqual([{ at: NZ_DST_END, before: 780, after: 720 }]);
	});
});
