// @ts-nocheck
// Join Data, the node (JoinData.svelte's func) on real columns and real nodes: output columns,
// names, refusals, the Source column, Column Set inputs, Bin Data afterwards, the orphan sweep
// and a save/load round trip. Synthetic data only.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { core, appConsts, pushObj, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { Column, getColumnById, removeColumn } from '$lib/core/Column.svelte';
import { TableProcess, syncTPSets } from '$lib/core/TableProcess.svelte';
import { columnNamer } from '$lib/core/columnLabels.js';
import { columnWarnings } from '$lib/core/columnWarnings.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { joindata, joinSourceLabels } from './JoinData.svelte';
import { groupcomparison } from './GroupComparison.svelte';
import { NUMERIC_NOTE, BIN_HINT, ONE_TIME_ERROR } from '$lib/utils/joinData.js';
import { joinOutKeys } from '$lib/utils/joinPairing.js';

const H = 3600000;
const T0 = Date.UTC(2024, 5, 1);

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
}, 120000);

beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.groups = [];
	core.orphanProcesses = [];
	core.rawData = new Map();
});

function mkCol(type, values, name, timeFormat) {
	const c = new Column({ type, data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	if (timeFormat) c.timeFormat = timeFormat;
	core.data.push(c);
	return c.id;
}

/** A Join Data node with the given args; `outKeys` are minted as output columns. */
function joinNode(args, outKeys = [], { time = true } = {}) {
	const out = time ? { jointime: -1 } : {};
	for (const k of outKeys) out[k] = -1;
	const tp = new TableProcess(
		{ name: 'JoinData', args: { pairing: {}, shiftB: 0, sourceColumn: false, ...args, out } },
		null
	);
	pushObj(tp);
	return tp;
}

const data = (id) => getColumnById(id)?.getData();
const shown = (id) => columnNamer()(getColumnById(id));

/** Hourly ambient (A) and 15 min hive (B, starting 7 min past) over `hours`. */
function ambientAndHive(hours = 6) {
	const tA = mkCol(
		'time',
		Array.from({ length: hours }, (_, i) => T0 + i * H),
		'time'
	);
	const ambient = mkCol(
		'number',
		Array.from({ length: hours }, (_, i) => 10 + i),
		'temperature'
	);
	const n = hours * 4;
	const tB = mkCol(
		'time',
		Array.from({ length: n }, (_, i) => T0 + 7 * 60000 + i * 15 * 60000),
		'time'
	);
	const hive = mkCol(
		'number',
		Array.from({ length: n }, (_, i) => 30 + i / 4),
		'Temperature '
	);
	const rh = mkCol(
		'number',
		Array.from({ length: n }, (_, i) => 50 + i),
		'humidity'
	);
	return { tA, ambient, tB, hive, rh, n };
}

describe('Join Data node', () => {
	it('joins two datasets onto one time column, pairing same-named columns', () => {
		const { tA, ambient, tB, hive, rh, n } = ambientAndHive();
		const tp = joinNode({ aTimeIN: tA, aValuesIN: [ambient], bTimeIN: tB, bValuesIN: [hive, rh] }, [
			`joined_${ambient}`,
			`joined_${rh}`
		]);
		const [res, valid] = joindata(tp.args);
		expect(valid).toBe(true);
		expect(res.counts).toMatchObject({ rows: 6 + n, fromA: 6, fromB: n, sharedTimes: 0 });
		const out = tp.args.out;
		const time = data(out.jointime);
		expect(getColumnById(out.jointime).type).toBe('time');
		expect(time.length).toBe(6 + n);
		expect(time).toEqual([...time].sort((a, b) => a - b));
		// The paired column: ambient on A rows, hive on B rows, never blank.
		const temp = data(out[`joined_${ambient}`]);
		expect(temp.filter((v) => v == null)).toEqual([]);
		expect(temp.slice(0, 6)).toEqual([10, 30, 30.25, 30.5, 30.75, 11]);
		// humidity exists on B rows only.
		const hum = data(out[`joined_${rh}`]);
		expect(hum[0]).toBeNull();
		expect(hum[1]).toBe(50);
		// The B temperature has no output of its own: it shares A's.
		expect(out[`joined_${hive}`]).toBeUndefined();
		expect(tp.args._resolvedPairs).toEqual({ [hive]: ambient });
		// Labels: the A name for the pair, the source name otherwise.
		expect(shown(out[`joined_${ambient}`])).toBe('temperature');
		expect(shown(out[`joined_${rh}`])).toBe('humidity');
		expect(shown(out.jointime)).toBe('Time');
	});

	it('the summary line and the Bin Data hint for series that never share a time', () => {
		const { tA, ambient, tB, hive } = ambientAndHive(2);
		const tp = joinNode({ aTimeIN: tA, aValuesIN: [ambient], bTimeIN: tB, bValuesIN: [hive] }, [
			`joined_${ambient}`
		]);
		const [res] = joindata(tp.args);
		expect(res.summary).toBe('10 rows: 2 from A, 8 from B; 0 times appear in both.');
		expect(res.rareShared).toBe(true);
		expect(BIN_HINT).toBe(
			'A and B rarely share a time. To compare them row by row, add Bin Data after this node.'
		);
	});

	it('an override keeps a same-named B column separate, labelled by side', () => {
		const { tA, ambient, tB, hive } = ambientAndHive(2);
		const tp = joinNode(
			{
				aTimeIN: tA,
				aValuesIN: [ambient],
				bTimeIN: tB,
				bValuesIN: [hive],
				pairing: { [hive]: -1 }
			},
			[`joined_${ambient}`, `joined_${hive}`]
		);
		joindata(tp.args);
		expect(shown(tp.args.out[`joined_${ambient}`])).toBe('temperature (A)');
		expect(shown(tp.args.out[`joined_${hive}`])).toBe('Temperature (B)');
		expect(data(tp.args.out[`joined_${hive}`]).slice(0, 2)).toEqual([null, 30]);
	});

	it('an override pairs differently-named columns', () => {
		const tA = mkCol('number', [0, 1], 'x');
		const a = mkCol('number', [1, 2], 'ambient');
		const tB = mkCol('number', [0.5], 'x');
		const b = mkCol('number', [9], 'outside air');
		const tp = joinNode(
			{ aTimeIN: tA, aValuesIN: [a], bTimeIN: tB, bValuesIN: [b], pairing: { [b]: a } },
			[`joined_${a}`]
		);
		const [res] = joindata(tp.args);
		expect(data(tp.args.out[`joined_${a}`])).toEqual([1, 9, 2]);
		expect(res.notes).toContain(NUMERIC_NOTE);
	});

	it('refuses mixed real time and numbers, and clears an earlier result', () => {
		const tA = mkCol('time', [T0, T0 + H], 'time');
		const a = mkCol('number', [1, 2], 'v');
		const tB = mkCol('number', [0, 1], 'hours');
		const tp = joinNode({ aTimeIN: tA, aValuesIN: [a], bTimeIN: tA, bValuesIN: [] }, [
			`joined_${a}`
		]);
		expect(joindata(tp.args)[1]).toBe(true);
		expect(data(tp.args.out.jointime).length).toBe(4);
		tp.args.bTimeIN = tB;
		const [res, valid] = joindata(tp.args);
		expect(valid).toBe(false);
		expect(res.error).toMatch(/Time A is a time column and time B is a number column/);
		expect(data(tp.args.out.jointime)).toEqual([]);
		expect(data(tp.args.out[`joined_${a}`])).toEqual([]);
	});

	it('refuses a column wired into both sides', () => {
		const t = mkCol('number', [0, 1], 'x');
		const v = mkCol('number', [1, 2], 'v');
		const tp = joinNode({ aTimeIN: t, aValuesIN: [v], bTimeIN: t, bValuesIN: [v] });
		const [res, valid] = joindata(tp.args);
		expect(valid).toBe(false);
		expect(res.error).toBe('v is wired into both A and B. Wire each column into one side only.');
	});

	it('a fresh node (nothing wired) is not valid and says nothing alarming', () => {
		const tp = joinNode({ aTimeIN: -1, aValuesIN: [], bTimeIN: -1, bValuesIN: [] });
		const [res, valid] = joindata(tp.args);
		expect(valid).toBe(false);
		expect(res.error).toBeNull();
		expect(res.summary).toBeUndefined();
		expect(tp.args._resolvedPairs).toBeUndefined();
	});

	it('Source column: the datasets (groups) names when both have one, else A and B', () => {
		const { tA, ambient, tB, hive } = ambientAndHive(1);
		const tp = joinNode(
			{ aTimeIN: tA, aValuesIN: [ambient], bTimeIN: tB, bValuesIN: [hive], sourceColumn: true },
			[`joined_${ambient}`, 'source']
		);
		joindata(tp.args);
		expect(data(tp.args.out.source)).toEqual(['A', 'B', 'B', 'B', 'B']);
		expect(getColumnById(tp.args.out.source).type).toBe('category');
		core.groups = [
			{ id: 1, name: 'weather', sourceColumnIds: [tA, ambient] },
			{ id: 2, name: 'hive2039', sourceColumnIds: [tB, hive] }
		];
		expect(joinSourceLabels(tA, tB)).toEqual(['weather', 'hive2039']);
		joindata(tp.args);
		expect(data(tp.args.out.source).slice(0, 2)).toEqual(['weather', 'hive2039']);
		expect(tp.args._sourceLabels).toEqual(['weather', 'hive2039']);
		// Same name on both sides says nothing: back to A and B.
		core.groups[1].name = ' Weather ';
		expect(joinSourceLabels(tA, tB)).toEqual(['A', 'B']);
	});

	it('zone-less text times parse as UTC: no daylight-saving jump inside the join', () => {
		// Europe springs forward at 01:00 UTC on 2024-03-31; the wall clock text is read as UTC.
		const fmt = 'YYYY-MM-DD HH:mm';
		const tA = mkCol(
			'time',
			['2024-03-31 00:00', '2024-03-31 01:00', '2024-03-31 02:00', '2024-03-31 03:00'],
			'time',
			fmt
		);
		const a = mkCol('number', [1, 2, 3, 4], 'v');
		const tB = mkCol(
			'time',
			['2024-03-31 00:30', '2024-03-31 01:30', '2024-03-31 02:30'],
			'time',
			fmt
		);
		const b = mkCol('number', [5, 6, 7], 'v');
		const tp = joinNode({ aTimeIN: tA, aValuesIN: [a], bTimeIN: tB, bValuesIN: [b] }, [
			`joined_${a}`
		]);
		joindata(tp.args);
		const t = data(tp.args.out.jointime);
		expect(t[0]).toBe(Date.UTC(2024, 2, 31, 0, 0));
		expect(t.slice(1).map((v, i) => v - t[i])).toEqual(Array(6).fill(H / 2));
		// The output stores ms, not text: no format to re-parse.
		expect(getColumnById(tp.args.out.jointime).timeFormat).toBeNull();
		expect(data(tp.args.out[`joined_${a}`])).toEqual([1, 5, 2, 6, 3, 7, 4]);
	});

	it('shifts B by fractional and negative hours', () => {
		const tA = mkCol('time', [T0, T0 + H], 'time');
		const tB = mkCol('time', [T0 + 0.5 * H, T0 + 1.5 * H], 'time');
		const tp = joinNode({ aTimeIN: tA, aValuesIN: [], bTimeIN: tB, bValuesIN: [], shiftB: -0.5 });
		const [res] = joindata(tp.args);
		expect(data(tp.args.out.jointime)).toEqual([T0, T0, T0 + H, T0 + H]);
		expect(res.counts.sharedTimes).toBe(2);
		tp.args.shiftB = 2.25;
		joindata(tp.args);
		expect(data(tp.args.out.jointime)).toEqual([T0, T0 + H, T0 + 2.75 * H, T0 + 3.75 * H]);
	});

	it('shared times show the repeated-times warning on the output time column', () => {
		const tA = mkCol('time', [T0, T0 + H], 'time');
		const tB = mkCol('time', [T0, T0 + H], 'time');
		const tp = joinNode({ aTimeIN: tA, aValuesIN: [], bTimeIN: tB, bValuesIN: [] });
		joindata(tp.args);
		expect(columnWarnings(getColumnById(tp.args.out.jointime))[0]).toMatch(
			/^2 times appear more than once/
		);
	});

	it('takes its value columns from a Column Set', () => {
		const { tA, ambient, tB, hive, rh } = ambientAndHive(1);
		const set = new TableProcess(
			{
				name: 'ColumnSet',
				args: { colsIN: [hive, rh], pattern: 'temp', matchField: 'name', out: {} }
			},
			null
		);
		pushObj(set);
		const tp = joinNode(
			{
				aTimeIN: tA,
				aValuesIN: [ambient],
				bTimeIN: tB,
				bValuesIN: [],
				setRefs: { bValuesIN: [set.id] }
			},
			[`joined_${ambient}`]
		);
		syncTPSets(tp);
		expect(tp.args.bValuesIN).toEqual([hive]);
		joindata(tp.args);
		expect(data(tp.args.out[`joined_${ambient}`])).toEqual([10, 30, 30.25, 30.5, 30.75]);
	});

	it('Bin Data after the join gives the hourly side-by-side table', () => {
		const { tA, ambient, tB, hive, rh } = ambientAndHive(3);
		const tp = joinNode({ aTimeIN: tA, aValuesIN: [ambient], bTimeIN: tB, bValuesIN: [hive, rh] }, [
			`joined_${ambient}`,
			`joined_${rh}`
		]);
		joindata(tp.args);
		const temp = tp.args.out[`joined_${ambient}`];
		const hum = tp.args.out[`joined_${rh}`];
		const bin = new TableProcess(
			{
				name: 'BinnedData',
				args: {
					xIN: tp.args.out.jointime,
					yIN: [temp, hum],
					binMode: 'uniform',
					binSize: 1,
					binStart: 0,
					stepSize: 1,
					aggFunction: 'mean',
					out: { binnedx: -1 }
				}
			},
			null
		);
		pushObj(bin);
		const binnedTemp = data(bin.args.out[`binnedy_${temp}`]);
		const binnedHum = data(bin.args.out[`binnedy_${hum}`]);
		// Hours 0, 1 and 2 (Bin Data also emits an empty bin starting at 3 h, its existing
		// behaviour whenever the last time is not on a bin start).
		expect(binnedTemp.slice(0, 3).every((v) => Number.isFinite(v))).toBe(true);
		// Hour 0: ambient 10 and hive 30, 30.25, 30.5, 30.75 -> mean of all five rows.
		expect(binnedTemp[0]).toBeCloseTo((10 + 30 + 30.25 + 30.5 + 30.75) / 5, 10);
		// Humidity is B only, so blanks on A rows are skipped: 50..53.
		expect(binnedHum[0]).toBeCloseTo(51.5, 10);
		expect(binnedHum[2]).toBeCloseTo(59.5, 10);
	});

	it('Bin Data after a partial-overlap join keeps every bin of both series', () => {
		// A covers hours 0-3, B hours 2-9: A's column is blank after hour 3, so its bins end
		// early. Bin Data must still give B's later hours an x (the shared x is the longest y's).
		const tA = mkCol('number', [0, 1, 2, 3], 'h');
		const a = mkCol('number', [1, 1, 1, 1], 'ambient');
		const tB = mkCol('number', [2, 3, 4, 5, 6, 7, 8, 9], 'h');
		const b = mkCol('number', [2, 2, 2, 2, 2, 2, 2, 9], 'hive');
		const tp = joinNode({ aTimeIN: tA, aValuesIN: [a], bTimeIN: tB, bValuesIN: [b] }, [
			`joined_${a}`,
			`joined_${b}`
		]);
		joindata(tp.args);
		const ja = tp.args.out[`joined_${a}`];
		const jb = tp.args.out[`joined_${b}`];
		const bin = new TableProcess(
			{
				name: 'BinnedData',
				args: {
					xIN: tp.args.out.jointime,
					yIN: [ja, jb],
					binMode: 'uniform',
					binSize: 1,
					binStart: 0,
					stepSize: 1,
					aggFunction: 'mean',
					out: { binnedx: -1 }
				}
			},
			null
		);
		pushObj(bin);
		const x = data(bin.args.out.binnedx);
		const ya = data(bin.args.out[`binnedy_${ja}`]);
		const yb = data(bin.args.out[`binnedy_${jb}`]);
		expect(x.length).toBe(yb.length);
		expect(ya.length).toBe(x.length);
		// The bin starting at hour 9 holds B's last value, with its x.
		expect(yb[9]).toBe(9);
		expect(x[9]).toBe(9.5); // a 'bin' column reads back bin centres
		expect(ya.slice(0, 4)).toEqual([1, 1, 1, 1]);
		expect(ya.slice(4).every((v) => v == null || Number.isNaN(v))).toBe(true);
	});

	it('removing an A value column removes its output (the orphan sweep knows joined_)', () => {
		const { tA, ambient, tB, hive, rh } = ambientAndHive(1);
		const tp = joinNode({ aTimeIN: tA, aValuesIN: [ambient], bTimeIN: tB, bValuesIN: [hive, rh] }, [
			`joined_${ambient}`,
			`joined_${rh}`
		]);
		joindata(tp.args);
		const outId = tp.args.out[`joined_${rh}`];
		removeColumn(rh);
		expect(tp.args.bValuesIN).toEqual([hive]);
		expect(tp.args.out[`joined_${rh}`]).toBeUndefined();
		expect(getColumnById(outId)).toBeFalsy();
	});

	it('survives a save and load with the same outputs', async () => {
		const { tA, ambient, tB, hive, rh } = ambientAndHive(2);
		const tp = joinNode(
			{
				aTimeIN: tA,
				aValuesIN: [ambient],
				bTimeIN: tB,
				bValuesIN: [hive, rh],
				shiftB: 0.25,
				sourceColumn: true,
				pairing: { [rh]: -1 }
			},
			[`joined_${ambient}`, `joined_${rh}`, 'source']
		);
		joindata(tp.args);
		const before = {
			args: JSON.parse(JSON.stringify(tp.args)),
			time: [...data(tp.args.out.jointime)],
			temp: [...data(tp.args.out[`joined_${ambient}`])],
			source: [...data(tp.args.out.source)]
		};
		await importJson(JSON.parse(outputCoreAsJson()));
		const loaded = core.tableProcesses.find((t) => t.name === 'JoinData');
		expect(JSON.parse(JSON.stringify(loaded.args))).toEqual(before.args);
		joindata(loaded.args);
		expect(data(loaded.args.out.jointime)).toEqual(before.time);
		expect(data(loaded.args.out[`joined_${ambient}`])).toEqual(before.temp);
		expect(data(loaded.args.out.source)).toEqual(before.source);
	});
});

/**
 * A stacking node (no times): `sourceColumn` left at the new-node default (null) unless given.
 * Out columns are minted for exactly the keys the node wants (joinOutKeys).
 */
function stackNode(args) {
	const full = { aTimeIN: -1, bTimeIN: -1, pairing: {}, shiftB: 0, sourceColumn: null, ...args };
	const out = {};
	for (const k of joinOutKeys(full, (id) => columnNamer()(getColumnById(id)))) out[k] = -1;
	const tp = new TableProcess({ name: 'JoinData', args: { ...full, out } }, null);
	pushObj(tp);
	return tp;
}

/** Cosinor-like per-animal results for two groups (synthetic). */
function twoGroupsOfResults() {
	const amp1 = mkCol('number', [3.1, 2.7, 3.4, 2.9, 3.3], 'amplitude');
	const acro1 = mkCol('number', [13.5, 14.1, 12.8, 13.9, 14.4], 'acrophase');
	const amp2 = mkCol('number', [1.2, 1.9, 1.5, 1.1, 1.7, 1.4], 'amplitude');
	const acro2 = mkCol('number', [16.2, 15.8, 17.1, 16.6, 15.9, 16.4], 'acrophase');
	return { amp1, acro1, amp2, acro2 };
}

describe('Join Data node: stack mode (no times)', () => {
	it("A's rows in input order, then B's; pairing by name; no time output; Source on by default", () => {
		const a = mkCol('number', [5, 1, 3], 'amp');
		const a2 = mkCol('number', [20, 10, 30], 'phase');
		const b = mkCol('number', [0.5, 9], ' AMP ');
		const b2 = mkCol('number', [7, 8], 'n');
		const tp = stackNode({ aValuesIN: [a, a2], bValuesIN: [b, b2] });
		expect(Object.keys(tp.args.out).sort()).toEqual(
			[`joined_${a}`, `joined_${a2}`, `joined_${b2}`, 'source'].sort()
		);
		const [res, valid] = joindata(tp.args);
		expect(valid).toBe(true);
		expect(res.error).toBeNull();
		expect(res.summary).toBe('5 rows: 3 from A, 2 from B.');
		expect(res.rareShared).toBe(false);
		const out = tp.args.out;
		expect(out.jointime).toBeUndefined();
		expect(data(out[`joined_${a}`])).toEqual([5, 1, 3, 0.5, 9]);
		expect(data(out[`joined_${a2}`])).toEqual([20, 10, 30, null, null]);
		expect(data(out[`joined_${b2}`])).toEqual([null, null, null, 7, 8]);
		expect(data(out.source)).toEqual(['A', 'A', 'A', 'B', 'B']);
		expect(tp.args._resolvedPairs).toEqual({ [b]: a });
		expect(shown(out[`joined_${a}`])).toBe('amp');
		expect(shown(out.source)).toBe('Source');
	});

	it('the override keeps a same-named B column apart, or pairs differently named ones', () => {
		const a = mkCol('number', [1, 2], 'temp');
		const a2 = mkCol('number', [3, 4], 'ambient');
		const b = mkCol('number', [5], 'temp');
		const b2 = mkCol('number', [6], 'outside');
		const tp = stackNode({
			aValuesIN: [a, a2],
			bValuesIN: [b, b2],
			pairing: { [b]: -1, [b2]: a2 },
			sourceColumn: false
		});
		joindata(tp.args);
		const out = tp.args.out;
		expect(data(out[`joined_${a}`])).toEqual([1, 2, null]);
		expect(data(out[`joined_${b}`])).toEqual([null, null, 5]);
		expect(data(out[`joined_${a2}`])).toEqual([3, 4, 6]);
		expect(shown(out[`joined_${a}`])).toBe('temp (A)');
		expect(shown(out[`joined_${b}`])).toBe('temp (B)');
		expect(out.source).toBeUndefined();
	});

	it('different lengths, an empty A, an empty B, single rows', () => {
		const long = mkCol('number', [1, 2, 3], 'v');
		const short = mkCol('number', [9], 'w');
		const b = mkCol('number', [4], 'v');
		let tp = stackNode({ aValuesIN: [long, short], bValuesIN: [b] });
		joindata(tp.args);
		expect(data(tp.args.out[`joined_${short}`])).toEqual([9, null, null, null]);
		expect(data(tp.args.out[`joined_${long}`])).toEqual([1, 2, 3, 4]);

		tp = stackNode({ aValuesIN: [], bValuesIN: [b] });
		const [r1, v1] = joindata(tp.args);
		expect(v1).toBe(true);
		expect(r1.summary).toBe('1 row: 0 from A, 1 from B.');
		expect(data(tp.args.out[`joined_${b}`])).toEqual([4]);
		expect(data(tp.args.out.source)).toEqual(['B']);

		const emptyB = mkCol('number', [], 'v');
		tp = stackNode({ aValuesIN: [short], bValuesIN: [emptyB] });
		const [r2] = joindata(tp.args);
		expect(r2.summary).toBe('1 row: 1 from A, 0 from B.');
		expect(data(tp.args.out[`joined_${short}`])).toEqual([9]);
	});

	it('takes its value columns from a Column Set', () => {
		const a = mkCol('number', [1, 2], 'temp');
		const b1 = mkCol('number', [3], 'temp');
		const b2 = mkCol('number', [4], 'light');
		const set = new TableProcess(
			{
				name: 'ColumnSet',
				args: { colsIN: [b1, b2], pattern: 'temp', matchField: 'name', out: {} }
			},
			null
		);
		pushObj(set);
		const tp = stackNode({ aValuesIN: [a], bValuesIN: [], setRefs: { bValuesIN: [set.id] } });
		syncTPSets(tp);
		expect(tp.args.bValuesIN).toEqual([b1]);
		joindata(tp.args);
		expect(data(tp.args.out[`joined_${a}`])).toEqual([1, 2, 3]);
	});

	it('Source labels are the datasets (groups) of the first value columns when they differ', () => {
		const { amp1, amp2 } = twoGroupsOfResults();
		core.groups = [
			{ name: 'Control', sourceColumnIds: [amp1], allColumnIds: [amp1] },
			{ name: 'Treated', sourceColumnIds: [amp2], allColumnIds: [amp2] }
		];
		const tp = stackNode({ aValuesIN: [amp1], bValuesIN: [amp2] });
		joindata(tp.args);
		expect(data(tp.args.out.source)).toEqual([
			...Array(5).fill('Control'),
			...Array(6).fill('Treated')
		]);
		expect(tp.args._sourceLabels).toEqual(['Control', 'Treated']);
	});

	it('one time wired alone is refused and clears an earlier result', () => {
		const t = mkCol('number', [0, 1], 'x');
		const v = mkCol('number', [1, 2], 'v');
		const vb = mkCol('number', [3, 4], 'v');
		const tp = stackNode({ aValuesIN: [v], bValuesIN: [vb] });
		joindata(tp.args);
		const outId = tp.args.out[`joined_${v}`];
		expect(data(outId)).toEqual([1, 2, 3, 4]);
		tp.args.aTimeIN = t;
		const [res, valid] = joindata(tp.args);
		expect(valid).toBe(false);
		expect(res.error).toBe(ONE_TIME_ERROR);
		expect(data(outId)).toEqual([]);
		expect(data(tp.args.out.source)).toEqual([]);
		// The same with B's time alone.
		tp.args.aTimeIN = -1;
		tp.args.bTimeIN = t;
		expect(joindata(tp.args)[0].error).toBe(ONE_TIME_ERROR);
	});

	it('Source: on by default stacked, off by default with times; an explicit choice is kept across modes', () => {
		const tA = mkCol('number', [0, 1], 'x');
		const tB = mkCol('number', [0.5], 'x');
		const a = mkCol('number', [1, 2], 'v');
		const b = mkCol('number', [3], 'v');
		const tp = stackNode({ aValuesIN: [a], bValuesIN: [b] });
		const keys = () => joinOutKeys(tp.args, (id) => String(id));
		expect(keys()).toContain('source');
		Object.assign(tp.args, { aTimeIN: tA, bTimeIN: tB });
		expect(keys()).not.toContain('source');
		expect(tp.args.sourceColumn).toBeNull();
		// The user ticks it in time mode: kept when the times are unwired, and back again.
		tp.args.sourceColumn = true;
		Object.assign(tp.args, { aTimeIN: -1, bTimeIN: -1 });
		expect(keys()).toContain('source');
		Object.assign(tp.args, { aTimeIN: tA, bTimeIN: tB });
		expect(keys()).toContain('source');
		// Unticked while stacking: stays off in both modes.
		tp.args.sourceColumn = false;
		Object.assign(tp.args, { aTimeIN: -1, bTimeIN: -1 });
		expect(keys()).not.toContain('source');
		expect(tp.args.sourceColumn).toBe(false);
	});

	it('survives a save and load: null Source stays null, the stacked outputs the same', async () => {
		const { amp1, acro1, amp2, acro2 } = twoGroupsOfResults();
		const tp = stackNode({ aValuesIN: [amp1, acro1], bValuesIN: [amp2, acro2] });
		joindata(tp.args);
		const before = {
			args: JSON.parse(JSON.stringify(tp.args)),
			amp: [...data(tp.args.out[`joined_${amp1}`])],
			source: [...data(tp.args.out.source)]
		};
		expect(before.args.sourceColumn).toBeNull();
		await importJson(JSON.parse(outputCoreAsJson()));
		const loaded = core.tableProcesses.find((t) => t.name === 'JoinData');
		expect(JSON.parse(JSON.stringify(loaded.args))).toEqual(before.args);
		joindata(loaded.args);
		expect(loaded.args.out.jointime).toBeUndefined();
		expect(data(loaded.args.out[`joined_${amp1}`])).toEqual(before.amp);
		expect(data(loaded.args.out.source)).toEqual(before.source);
	});

	it('a v82.31 time join (sourceColumn false) loads exactly as before: no Source', async () => {
		const { tA, ambient, tB, hive } = ambientAndHive(1);
		const tp = joinNode({ aTimeIN: tA, aValuesIN: [ambient], bTimeIN: tB, bValuesIN: [hive] }, [
			`joined_${ambient}`
		]);
		expect(tp.args.sourceColumn).toBe(false);
		await importJson(JSON.parse(outputCoreAsJson()));
		const loaded = core.tableProcesses.find((t) => t.name === 'JoinData');
		expect(loaded.args.sourceColumn).toBe(false);
		expect(joinOutKeys(loaded.args, (id) => String(id))).not.toContain('source');
		const [res] = joindata(loaded.args);
		expect(res.summary).toBe('5 rows: 1 from A, 4 from B; 0 times appear in both.');
	});

	it('stacked Cosinor-like results feed Group Comparison, grouped by Source', () => {
		const { amp1, acro1, amp2, acro2 } = twoGroupsOfResults();
		const tp = stackNode({ aValuesIN: [amp1, acro1], bValuesIN: [amp2, acro2] });
		joindata(tp.args);
		const ampOut = tp.args.out[`joined_${amp1}`];
		const gc = new TableProcess(
			{
				name: 'GroupComparison',
				args: { xIN: tp.args.out.source, yIN: [ampOut], method: 'ttest', alpha: 0.05, out: {} }
			},
			null
		);
		pushObj(gc);
		const [result, valid] = groupcomparison(gc.args);
		expect(valid).toBe(true);
		const comp = result.comparisons[ampOut];
		expect(comp.groups.map((g) => [g.name, g.n])).toEqual([
			['A', 5],
			['B', 6]
		]);
		expect(comp.groups[0].values).toEqual([3.1, 2.7, 3.4, 2.9, 3.3]);
		expect(comp.groups[1].values).toEqual([1.2, 1.9, 1.5, 1.1, 1.7, 1.4]);
		expect(comp.test).toBe('Welch t-test');
		// Named as shown (the output's label), not its stored name joined_<id>_<node>.
		expect(comp.columnName).toBe('amplitude');
		expect(comp.pValue).toBeLessThan(0.001);
	});
});
