// @ts-nocheck
// Per-column time zone, PHASE 3 on the real Column: zone-less text given a zone is read as
// the instants its wall clock names in that zone (utils/time/zones.js resolveWallClocks), with
// the repeated and skipped hours of a daylight-saving change counted on the column. 'utc'
// (and no zone) reads exactly as before: pinned in timeZone.phase3.pin.svelte.test.js.
//
// Pacific/Auckland 2024: NZDT (+13:00) ended at 03:00 on 7 Apr (02:00 to 02:59 happened
// twice); NZDT began at 02:00 on 29 Sep (02:00 to 02:59 never happened).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
import { core, appConsts, appState, pushObj, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { Column, getColumnById } from '$lib/core/Column.svelte';
import { TableProcess } from '$lib/core/TableProcess.svelte';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { applyOp } from '$lib/core/operations.js';
import { buildTableProcessDefaults } from '$lib/core/tpDefaults.js';
import { history } from '$lib/core/opHistory.svelte.js';
import { columnWarnings } from './columnWarnings.js';
import { zoneShiftNote, wallClockCountsOf, columnClock } from './columnTimeZone.js';
import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils.js';
import { joindata } from '$lib/tableProcesses/JoinData.svelte';
import { binneddata, binnedDataHash } from '$lib/tableProcesses/BinnedData.svelte';
import { CircularPhaseClass } from '$lib/plots/CircularPhase/CircularPhase.svelte';

const NZ = 'Pacific/Auckland';
const FMT = 'YYYY-MM-DD HH:mm';
const MIN = 60000;
const H = 3600000;

/** Wall clock text from a UTC-ms "wall" (the clock as a logger writes it). */
const text = (wallMs) => new Date(wallMs).toISOString().slice(0, 16).replace('T', ' ');
const W = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

/** A logger that FOLLOWS daylight saving, every 10 min, 01:00 to 04:00 on 7 Apr 2024. */
function followsDstAutumn() {
	const out = [];
	for (let w = W(2024, 4, 7, 1); w < W(2024, 4, 7, 3); w += 10 * MIN) out.push(text(w));
	// Clocks went back at 03:00 NZDT: 02:00 .. 02:50 again, then on.
	for (let w = W(2024, 4, 7, 2); w <= W(2024, 4, 7, 4); w += 10 * MIN) out.push(text(w));
	return out;
}

function timeCol(values, extra = {}) {
	const c = new Column({ type: 'time', timeFormat: FMT, ...extra });
	c.name = `t${c.id}`;
	core.rawData.set(c.id, values);
	c.data = c.id;
	pushObj(c);
	return getColumnById(c.id);
}
function numCol(values) {
	const c = new Column({ type: 'number' });
	c.name = `n${c.id}`;
	core.rawData.set(c.id, values);
	c.data = c.id;
	pushObj(c);
	return getColumnById(c.id);
}

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

describe('a NZ logger that follows daylight saving, across the repeated hour', () => {
	it('as written (utc): the repeated hour reads twice, so times repeat', () => {
		const c = timeCol(followsDstAutumn());
		const d = c.getData();
		expect(d[6]).toBe(W(2024, 4, 7, 2)); // first 02:00
		expect(d[12]).toBe(W(2024, 4, 7, 2)); // second 02:00, the same ms
		expect(wallClockCountsOf(d)).toBeNull();
		expect(columnWarnings(c).join(' ')).toMatch(/more than once/);
	});

	it('in Pacific/Auckland: one instant every 10 min, the second pass as NZST, and it says so', () => {
		const c = timeCol(followsDstAutumn(), { timeZone: NZ });
		const d = Array.from(c.getData());
		const first = Date.UTC(2024, 3, 6, 12); // 01:00 NZDT
		expect(d).toEqual(d.map((_, i) => first + i * 10 * MIN));
		expect(wallClockCountsOf(c.getData())).toEqual({
			zone: NZ,
			repeated: 12,
			secondPass: 6,
			unordered: 0,
			skipped: 0
		});
		// Elapsed time is exact: 25 values span 4 h, not 3 h with a repeat.
		expect(c.hoursSinceStart.at(-1)).toBeCloseTo((d.length - 1) / 6, 9);
		// Read in order is what should happen: said beside the zone, not warned.
		expect(columnWarnings(c)).toEqual([]);
		expect(zoneShiftNote(c)).toMatch(
			/ The hour repeated when daylight saving ended is read in order: its first pass as daylight-saving time, its second \(6 times\) as standard time\.$/
		);
		// Shown in its own zone, every time reads as written.
		expect(d.map((ms) => formatTimeFromUNIX(ms, c).slice(0, 17))).toEqual(
			followsDstAutumn().map((t) =>
				formatTimeFromUNIX(Date.parse(t.replace(' ', 'T') + 'Z')).slice(0, 17)
			)
		);
	});

	it('sorted by the written time (each repeated time twice in a row): the earlier instant, warned', () => {
		const sorted = [...followsDstAutumn()].sort();
		const c = timeCol(sorted, { timeZone: NZ });
		const w = columnWarnings(c);
		expect(w[0]).toMatch(
			/^12 times fall in the hour repeated .* do not step back through it in order, so each is read as the earlier \(daylight-saving\) time\. This logger may not follow daylight saving: try a fixed offset\.$/
		);
		expect(w[1]).toMatch(/more than once/);
	});
});

describe('the spring gap', () => {
	// A logger on NZST all year: 01:00 to 04:00 every 10 min on 29 Sep, straight through.
	const STANDARD = Array.from({ length: 19 }, (_, i) => text(W(2024, 9, 29, 1) + i * 10 * MIN));

	it('read as Pacific/Auckland: the six values in the gap move forward, with a count and advice', () => {
		const c = timeCol(STANDARD, { timeZone: NZ });
		expect(wallClockCountsOf(c.getData()).skipped).toBe(6);
		const w = columnWarnings(c);
		expect(w[0]).toBe(
			'6 times fall in the hour skipped when daylight saving began in Pacific/Auckland, so they do not exist there; they are moved forward by the change (02:30 reads 03:30 after a 1 h change). This logger may not follow daylight saving: try a fixed offset.'
		);
		// Moved forward, they land on the logger's own 03:00 to 03:50: those times now repeat.
		expect(w[1]).toMatch(/^6 times appear more than once/);
	});

	it('read as the fixed offset +12:00: every value 12 h earlier, no warning', () => {
		const c = timeCol(STANDARD, { timeZone: '+12:00' });
		expect(Array.from(c.getData())).toEqual(
			STANDARD.map((t) => Date.parse(t.replace(' ', 'T') + 'Z') - 12 * H)
		);
		expect(columnWarnings(c)).toEqual([]);
	});
});

describe('which columns a zone moves', () => {
	it('text with offsets and epoch ms keep their instants; the zone is for clock readings', () => {
		const vals = ['2024-03-10T08:00:00+13:00', '2024-04-07T02:30:00+12:00'];
		const plain = timeCol(vals, { timeFormat: 'YYYY-MM-DD[T]HH:mm:ssZ' });
		const zoned = timeCol(vals, { timeFormat: 'YYYY-MM-DD[T]HH:mm:ssZ', timeZone: NZ });
		expect(Array.from(zoned.getData())).toEqual(Array.from(plain.getData()));
		const ms = [Date.UTC(2024, 3, 6, 13), Date.UTC(2024, 3, 6, 14)];
		expect(Array.from(timeCol(ms, { timeFormat: '', timeZone: NZ }).getData())).toEqual(ms);
	});

	it('an AWD column: the header start is resolved in the zone, the samples follow it', () => {
		const c = new Column({ type: 'time', compression: 'awd', timeZone: NZ });
		core.rawData.set(c.id, { start: W(2024, 4, 6, 12), step: H, length: 30 });
		c.data = c.id;
		pushObj(c);
		const d = getColumnById(c.id).getData();
		expect(d[0]).toBe(Date.UTC(2024, 3, 5, 23)); // 12:00 NZDT
		expect(d[29] - d[0]).toBe(29 * H);
		expect(columnClock(getColumnById(c.id)).zone).toBe(NZ);
	});

	it('a zone this browser does not know: read as written, and said', () => {
		const c = timeCol(['2024-01-01 00:00'], { timeZone: 'Mars/Olympus_Mons' });
		expect(c.getData()[0]).toBe(W(2024, 1, 1, 0));
		expect(columnWarnings(c)).toEqual([
			'The time zone "Mars/Olympus_Mons" is not known to this browser, so these times are read as written (UTC).'
		]);
	});
});

describe('changing the zone moves the instants downstream, in one undo step', () => {
	it('a reference follows; undo restores', () => {
		const t = timeCol(['2024-01-10 08:00', '2024-07-10 08:00']);
		const ref = new Column({ refId: t.id });
		pushObj(ref);
		const before = Array.from(getColumnById(ref.id).getData());
		applyOp({ kind: 'setColumnTimeZone', id: t.id, zone: NZ });
		flushSync();
		expect(Array.from(getColumnById(ref.id).getData())).toEqual([
			before[0] - 13 * H,
			before[1] - 12 * H
		]);
		history.undo();
		flushSync();
		expect(Array.from(getColumnById(ref.id).getData())).toEqual(before);
	});

	it('a real Bin Data node: its compute key changes and it bins the resolved times', () => {
		const t = timeCol(followsDstAutumn());
		const y = numCol(followsDstAutumn().map(() => 1));
		const args = buildTableProcessDefaults(appConsts.tableProcessMap.get('BinnedData'));
		Object.assign(args, { xIN: t.id, yIN: [y.id], binSize: 1, binStart: 0, aggFunction: 'count' });
		const tp = new TableProcess({ name: 'BinnedData', args }, null);
		pushObj(tp);
		flushSync();
		const xOutId = Object.values(tp.args.out).find((id) => getColumnById(id)?.type === 'time');
		const countId = Object.values(tp.args.out).find((id) => id !== xOutId && Number.isInteger(id));
		// Written as UTC the 02:00 hour holds 12 values (two passes); in Auckland each hour 6.
		const countsUtc = Array.from(getColumnById(countId).getData());
		expect(Math.max(...countsUtc)).toBe(12);
		const hash = binnedDataHash(tp.args);
		applyOp({ kind: 'setColumnTimeZone', id: t.id, zone: NZ });
		flushSync();
		// The node's compute key changes with the zone (its x data hash), so it recomputes;
		// the mounted panel or the compute host does that in the app (E2E), here by hand.
		expect(binnedDataHash(tp.args)).not.toBe(hash);
		binneddata(tp.args);
		const countsNz = Array.from(getColumnById(countId).getData()).filter((v) => v != null);
		expect(Math.max(...countsNz)).toBe(6);
	});
});

describe('the control says what the zone does', () => {
	it('Auckland across April: 12 to 13 h, and daylight saving', () => {
		const c = timeCol(followsDstAutumn(), { timeZone: NZ });
		expect(zoneShiftNote(c)).toMatch(
			/^Times stay as written\. Read as Pacific\/Auckland time, they are 12 to 13 h earlier than the same times in a UTC column\. Elapsed time across its daylight-saving changes is exact\./
		);
	});
	it('fixed offsets east and west; nothing for utc or an offset column', () => {
		expect(zoneShiftNote(timeCol(['2024-01-01 00:00'], { timeZone: '+05:30' }))).toBe(
			'Times stay as written. Read as UTC+05:30 time, they are 5.5 h earlier than the same times in a UTC column.'
		);
		expect(zoneShiftNote(timeCol(['2024-01-01 00:00'], { timeZone: '-04:00' }))).toMatch(
			/they are 4 h later than/
		);
		expect(zoneShiftNote(timeCol(['2024-01-01 00:00']))).toBeNull();
		expect(
			zoneShiftNote(
				timeCol(['2024-03-10T08:00:00+13:00'], {
					timeFormat: 'YYYY-MM-DD[T]HH:mm:ssZ',
					timeZone: NZ
				})
			)
		).toBeNull();
	});
});

describe('Join Data across zones needs no shift (plan 3.8)', () => {
	it('an Auckland wall clock and a UTC weather file line up across the change', () => {
		// The hive writes Auckland wall clock hourly; the weather file writes the SAME moments in UTC.
		const instants = Array.from({ length: 6 }, (_, i) => Date.UTC(2024, 3, 6, 11) + i * H); // spans 14:00 UTC
		const hiveText = [
			'2024-04-07 00:00',
			'2024-04-07 01:00',
			'2024-04-07 02:00',
			'2024-04-07 02:00',
			'2024-04-07 03:00',
			'2024-04-07 04:00'
		];
		const hive = timeCol(hiveText, { timeZone: NZ });
		const weather = timeCol(instants.map((ms) => text(ms)));
		expect(Array.from(hive.getData())).toEqual(instants);
		// The two time columns hold the same instants, so every hive row joins its weather row.
		expect(Array.from(weather.getData())).toEqual(instants);
		const av = numCol(instants.map((_, i) => i));
		const bv = numCol(instants.map((_, i) => 100 + i));
		const tp = new TableProcess(
			{
				name: 'JoinData',
				args: {
					pairing: {},
					shiftB: 0,
					sourceColumn: false,
					aTimeIN: hive.id,
					aValuesIN: [av.id],
					bTimeIN: weather.id,
					bValuesIN: [bv.id],
					out: { jointime: -1, [`joined_${av.id}`]: -1, [`joined_${bv.id}`]: -1 }
				}
			},
			null
		);
		pushObj(tp);
		const [res] = joindata(tp.args);
		expect(res.error).toBeNull();
		expect(res.summary).toContain("Joined times are in A's zone (Pacific/Auckland).");
		expect(res.zoneWarning).toBe(
			"B's times have no zone, so they are read as UTC. If they were recorded in Pacific/Auckland time, set B's zone (in its column's Properties) and the two line up."
		);
	});
});

describe('a session saved at v82.54/v82.55 with a zone on zone-less text (the upgrade)', () => {
	it('loads with the same display and clock, and exact elapsed time across the change', async () => {
		const c = timeCol(followsDstAutumn(), { timeZone: NZ });
		const saved = JSON.parse(outputCoreAsJson());
		expect(saved.data.find((d) => d.id === c.id).timeZone).toBe(NZ);
		core.data = [];
		await importJson(saved);
		const col = getColumnById(c.id);
		// Display: as written. Clock zone: Auckland (v82.55 read these ms in UTC, as the same clock).
		expect(formatTimeFromUNIX(col.getData()[0], col)).toBe('07 Apr 2024 01:00:00');
		expect(columnClock(col)).toEqual({ zone: NZ, named: NZ, wall: false, legacy: false });
		// Elapsed time: 4 h (v82.55 read 3 h with the repeated hour counted twice).
		expect(col.hoursSinceStart.at(-1)).toBeCloseTo(4, 9);
	});
});

describe('Circular phase plot reads the column clock (David, 2026-10-22)', () => {
	function hours(timeCol) {
		const y = numCol([1, 1]);
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
	const OFFSETS = ['2024-04-06T06:00:00+13:00', '2024-04-08T06:00:00+12:00'];
	const OFMT = 'YYYY-MM-DD[T]HH:mm:ssZ';

	it('an offset column in Auckland: local clock hours, each with its own offset', () => {
		expect(hours(timeCol(OFFSETS, { timeFormat: OFMT, timeZone: NZ }))).toEqual([6, 6]);
	});
	it('the same column with no zone: UTC hours, as before', () => {
		expect(hours(timeCol(OFFSETS, { timeFormat: OFMT }))).toEqual([17, 18]);
	});
	it('a legacy session keeps UTC hours, as its circular plots always read', () => {
		appState.displayTimezone = NZ;
		expect(hours(timeCol(OFFSETS, { timeFormat: OFMT, timeZone: NZ }))).toEqual([17, 18]);
	});
});
