// @ts-nocheck
// A column's time zone (STAT-18, phase 1): saved and loaded, inherited by every column
// derived from it, changed in one undo step, and a legacy session converted in one undo step.
// Since phase 3 a zone on zone-less text decides the instants it names (the wall clock stays
// as written); see wallClock.svelte.test.js for the parse itself.
//
// The three ways a column derives from another reach their source through different code
// (a reference, a free process output, an analysis node output), so each is tested, with
// a real Bin Data node and a real Join Data node for the analysis path.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
import { core, appConsts, appState, pushObj, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { Column, getColumnById } from '$lib/core/Column.svelte';
import { TableProcess } from '$lib/core/TableProcess.svelte';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';
import { buildTableProcessDefaults } from '$lib/core/tpDefaults.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { applyOp } from '$lib/core/operations.js';
import { history } from '$lib/core/opHistory.svelte.js';
import { ownsTimeZone, timeZoneSource, clockZoneOf } from './columnTimeZone.js';
import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils.js';
import { getLegacyZone, getClockZone, getShowTimesIn } from '$lib/utils/time/displayTime.js';
import dayjs from '$lib/utils/time/dayjsSetup.js';

const NZ = 'Pacific/Auckland';
const TIMES = ['2024-04-06 23:00', '2024-04-07 00:00', '2024-04-07 01:00', '2024-04-07 02:00'];

function source(name, values, extra = {}) {
	const c = new Column({ type: 'time', timeFormat: 'YYYY-MM-DD HH:mm', ...extra });
	c.name = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	pushObj(c);
	return c;
}

function numbers(name, values) {
	const c = new Column({ type: 'number' });
	c.name = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	pushObj(c);
	return c;
}

const save = () => JSON.parse(outputCoreAsJson());

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

describe('save and load', () => {
	it('a set zone round-trips; an unset one is not written and loads as utc', async () => {
		const t = source('time', TIMES, { timeZone: NZ });
		const u = source('time2', TIMES);
		const saved = save();
		expect(saved.data.find((c) => c.id === t.id).timeZone).toBe(NZ);
		expect('timeZone' in saved.data.find((c) => c.id === u.id)).toBe(false);

		await importJson(saved);
		expect(getColumnById(t.id).timeZone).toBe(NZ);
		expect(getColumnById(t.id).timeFrame).toEqual({ zone: NZ, wall: false });
		expect(getColumnById(u.id).timeZone).toBeNull();
		expect(getColumnById(u.id).timeFrame).toEqual({ zone: 'utc', wall: true });
		// Phase 3: the same text names instants 13 h earlier in Auckland (NZDT) than in UTC.
		expect(Array.from(getColumnById(t.id).getData())).toEqual(
			Array.from(getColumnById(u.id).getData()).map((ms) => ms - 13 * 3600000)
		);
	});

	it('a column saved before per-column zones (no field) loads as utc', async () => {
		source('time', TIMES);
		const saved = save();
		for (const c of saved.data) delete c.timeZone;
		await importJson(saved);
		expect(core.data[0].timeZone).toBeNull();
		expect(core.data[0].timeFrame.zone).toBe('utc');
	});

	it('text with offsets is a true-instant column; epoch ms too', () => {
		const t = source('t', ['2024-03-10T08:00:00+13:00'], { timeFormat: 'YYYY-MM-DDTHH:mm:ssZ' });
		expect(t.timeFrame).toEqual({ zone: 'utc', wall: false });
		const e = source('e', [Date.UTC(2024, 0, 1)], { timeFormat: '' });
		expect(e.timeFrame.wall).toBe(false);
	});
});

describe('inheritance', () => {
	it('a reference reads its target, and follows a change of it', () => {
		const t = source('time', TIMES, { timeZone: NZ });
		const ref = new Column({ refId: t.id });
		pushObj(ref);
		expect(ref.timeFrame).toEqual({ zone: NZ, wall: false });
		expect(ownsTimeZone(ref)).toBe(false);
		expect(timeZoneSource(ref)).toBe(t);
		t.timeZone = '+05:30';
		flushSync();
		expect(ref.timeFrame.zone).toBe('+05:30');
	});

	it('a free process output reads the input its port names', () => {
		const t = source('time', TIMES, { timeZone: 'Asia/Kolkata' });
		core.orphanProcesses = [{ id: 7, args: { inIN: [t.id] }, doProcess: (x) => x }];
		const out = new Column({ producerNodeId: 'process_7', producerPort: `out_${t.id}` });
		pushObj(out);
		expect(out.timeFrame.zone).toBe('Asia/Kolkata');
		expect(ownsTimeZone(out)).toBe(false);
	});

	it('a real Bin Data node: its binned time output takes the x column zone', () => {
		const t = source('time', TIMES, { timeZone: NZ });
		const y = numbers('activity', [1, 2, 3, 4]);
		const args = buildTableProcessDefaults(appConsts.tableProcessMap.get('BinnedData'));
		Object.assign(args, { xIN: t.id, yIN: [y.id] });
		const tp = new TableProcess({ name: 'BinnedData', args }, null);
		pushObj(tp);
		flushSync();
		const outIds = Object.values(tp.args.out ?? {}).filter((v) => Number.isInteger(v));
		expect(outIds.length).toBeGreaterThan(0);
		for (const id of outIds) {
			const c = getColumnById(id);
			expect(c.timeFrame.zone).toBe(NZ);
			expect(ownsTimeZone(c)).toBe(false);
		}
	});

	it("a real Join Data node: output time takes A's zone (decision 8)", () => {
		const a = source('a time', TIMES, { timeZone: NZ });
		const b = source('b time', TIMES, { timeZone: 'Europe/London' });
		const av = numbers('a', [1, 2, 3, 4]);
		const bv = numbers('b', [5, 6, 7, 8]);
		// Join Data makes its outputs when its panel mounts; one stands in for the joined time.
		const joined = new Column({ type: 'time' });
		pushObj(joined);
		const args = buildTableProcessDefaults(appConsts.tableProcessMap.get('JoinData'));
		Object.assign(args, {
			aTimeIN: a.id,
			aValuesIN: [av.id],
			bTimeIN: b.id,
			bValuesIN: [bv.id],
			out: { time: joined.id }
		});
		const tp = new TableProcess({ name: 'JoinData', args }, null);
		pushObj(tp);
		flushSync();
		const outIds = Object.values(tp.args.out ?? {}).filter((v) => Number.isInteger(v));
		expect(outIds.length).toBeGreaterThan(0);
		for (const id of outIds) expect(getColumnById(id).timeFrame.zone).toBe(NZ);
	});

	it('a cyclic or broken chain falls back to utc instead of hanging', () => {
		const a = new Column({ refId: 999 });
		pushObj(a);
		expect(a.timeFrame).toEqual({ zone: 'utc', wall: true });
		const b = new Column({ refId: -1 });
		pushObj(b);
		expect(b.timeFrame.zone).toBe('utc');
	});

	it('phase 2 hook: a wall-clock column is read in utc, an instant column in its zone', () => {
		expect(clockZoneOf(source('w', TIMES))).toBe('utc');
		// Since phase 3 zone-less text given a zone is an instant column.
		expect(clockZoneOf(source('z', TIMES, { timeZone: NZ }))).toBe(NZ);
		const i = source('i', ['2024-03-10T08:00:00+13:00'], {
			timeFormat: 'YYYY-MM-DDTHH:mm:ssZ',
			timeZone: NZ
		});
		expect(clockZoneOf(i)).toBe(NZ);
	});
});

describe('changing a zone', () => {
	it('is one undo step: the text is read again in the zone, and undo reads it as before', () => {
		const t = source('time', TIMES);
		const before = Array.from(t.getData());
		const n0 = history.undoCount;
		applyOp({ kind: 'setColumnTimeZone', id: t.id, zone: NZ });
		expect(t.timeZone).toBe(NZ);
		expect(history.undoCount).toBe(n0 + 1);
		// 6 Apr 23:00 to 7 Apr 01:00 are NZDT (-13 h); 02:00 is in the repeated hour, read
		// once, so the earlier (NZDT) instant.
		expect(Array.from(t.getData())).toEqual(before.map((ms) => ms - 13 * 3600000));
		// Shown in its own zone, every time still reads as written.
		expect(t.getData().map((ms) => formatTimeFromUNIX(ms, t))).toEqual([
			'06 Apr 2024 23:00:00',
			'07 Apr 2024 00:00:00',
			'07 Apr 2024 01:00:00',
			'07 Apr 2024 02:00:00'
		]);
		history.undo();
		expect(getColumnById(t.id).timeZone).toBeNull();
		expect(Array.from(getColumnById(t.id).getData())).toEqual(before);
		history.redo();
		expect(getColumnById(t.id).timeZone).toBe(NZ);
		// Setting the same zone again is not a step.
		applyOp({ kind: 'setColumnTimeZone', id: t.id, zone: NZ });
		expect(history.undoCount).toBe(n0 + 1);
	});
});

describe('a legacy session (saved with Timezone = Pacific/Auckland)', () => {
	function legacySession() {
		source('time', ['2024-03-10T08:00:00+13:00', '2024-03-10T09:00:00+13:00'], {
			timeFormat: 'YYYY-MM-DDTHH:mm:ssZ'
		});
		source('local', TIMES);
		const s = save();
		s.appState.displayTimezone = NZ;
		delete s.appState.showTimesIn; // saved before the setting existed
		for (const c of s.data) delete c.timeZone;
		return s;
	}

	it('loads with the old behaviour: every time in its zone, and clock analysis in it too', async () => {
		appState.showTimesIn = 'Asia/Kolkata'; // left over from a previous session
		await importJson(legacySession());
		expect(getLegacyZone()).toBe(NZ);
		expect(getClockZone()).toBe(NZ);
		expect(getShowTimesIn()).toBe('column');
		for (const col of core.data) {
			for (const ms of col.getData()) {
				const old = dayjs(ms).tz(NZ).format('DD MMM YYYY HH:mm:ss');
				expect(formatTimeFromUNIX(ms, col)).toBe(old);
			}
		}
	});

	it('converts in one undo step; the zone-less column is then read in the old zone', async () => {
		await importJson(legacySession());
		const [offsets, local] = core.data;
		const dataBefore = core.data.map((c) => Array.from(c.getData()));
		const shownBefore = formatTimeFromUNIX(offsets.getData()[0], offsets);
		const n0 = history.undoCount;

		applyOp({
			kind: 'batch',
			ops: [
				{ kind: 'setTimeSettings', displayTimezone: 'utc', showTimesIn: 'column' },
				{ kind: 'setColumnTimeZone', id: offsets.id, zone: NZ },
				{ kind: 'setColumnTimeZone', id: local.id, zone: NZ }
			]
		});
		expect(history.undoCount).toBe(n0 + 1);
		expect(getLegacyZone()).toBeNull();
		expect(getClockZone()).toBe('utc');
		// The offset column's instants do not move; the zone-less one's are now read in
		// Auckland (phase 3): 13 h earlier, as NZDT.
		expect(Array.from(offsets.getData())).toEqual(dataBefore[0]);
		expect(Array.from(local.getData())).toEqual(dataBefore[1].map((ms) => ms - 13 * 3600000));
		// The offset column reads exactly as before (its zone is now the old one); the zone-less
		// one now reads as written instead of relabelled (the STAT-18 fix).
		expect(formatTimeFromUNIX(offsets.getData()[0], offsets)).toBe(shownBefore);
		expect(formatTimeFromUNIX(local.getData()[0], local)).toBe('06 Apr 2024 23:00:00');

		history.undo();
		expect(getLegacyZone()).toBe(NZ);
		expect(getColumnById(offsets.id).timeZone).toBeNull();
		expect(getColumnById(local.id).timeZone).toBeNull();
		expect(core.data.map((c) => Array.from(c.getData()))).toEqual(dataBefore);
	});

	it('a new-format session saves the setting and is not legacy on reload', async () => {
		appState.showTimesIn = 'Europe/London';
		source('time', TIMES);
		const s = save();
		expect(s.appState.showTimesIn).toBe('Europe/London');
		expect(s.appState.displayTimezone).toBe('utc');
		appState.showTimesIn = 'column';
		await importJson(s);
		expect(getShowTimesIn()).toBe('Europe/London');
		expect(getLegacyZone()).toBeNull();
	});
});
