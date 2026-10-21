// Time columns from a session DRAFT (the Worker normalizer, src/emit/timeColumns.js), pinned
// against the app itself: the session is loaded with the app's own importJson and read with
// its own Column, columnClock and plot classes (per-column time zone, phase 4; plan
// ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md, section 5e).
//
// - ISO text in a draft's time column is READ by the app (before phase 4 the normalizer gave it
//   no format and the app showed every text time as a blank).
// - `time_zone` is stored as the app stores it, and text with no offset is read in that zone.
// - The Worker's reading of a session file (which zone each column is on, as written or not)
//   agrees with the app's columnClock for every kind of column, so check_draft's mixed-zone
//   warnings are the app's own.
//
// Pacific/Auckland 2024: NZDT (+13:00) until 03:00 on 7 Apr, then NZST (+12:00).
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureRegistry } from '../src/engine/session.js';
import { normalizeSession } from '../src/emit/normalizer.js';
import {
	sessionColumnClock,
	describeColumnZone,
	mixedZoneWarnings,
	sessionTimeTyper,
	daylightSavingWarnings,
	wallClockCounts
} from '../src/emit/timeColumns.js';
// The modules the Worker imports, by the relative path its bundle (and plain `node --test`)
// resolves; the app reaches the same files through zones.js and columnWarnings.js.
import * as workerResolver from '../../src/lib/utils/time/zoneResolver.js';
import { dstCountWarnings as workerDstWords } from '../../src/lib/utils/time/dstCountWarnings.js';
import { SCHEMA } from '../src/emit/schema.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { core, appConsts, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { columnClock, timeZoneSource, readsWallClockText } from '$lib/core/columnTimeZone.js';
import { columnWarnings, dstCountWarnings } from '$lib/core/columnWarnings.js';
import * as zones from '$lib/utils/time/zones.js';

const { resolveWallClocks } = zones;

beforeAll(async () => {
	await ensureRegistry();
}, 60000);

const NZ = 'Pacific/Auckland';
const appCol = (name) => core.data.find((c) => c.name === name);

async function load(draft) {
	const built = normalizeSession(draft);
	expect(built.errors).toEqual([]);
	await importJson(JSON.parse(JSON.stringify(built.session)));
	// Headless, nothing mounts the nodes, so run each analysis as its node would: that types
	// its outputs (Join Data's jointime and Cosinor's cosinorx become time columns).
	for (const tp of core.tableProcesses) await appConsts.tableProcessMap.get(tp.name).func(tp.args);
	return built;
}

describe('ISO text in a draft time column is read by the app', () => {
	const CASES = [
		['2024-04-01', Date.UTC(2024, 3, 1)],
		['2024-04-01T12:30', Date.UTC(2024, 3, 1, 12, 30)],
		['2024-04-01 12:30:15', Date.UTC(2024, 3, 1, 12, 30, 15)],
		['2024-04-01T12:30:15.125', Date.UTC(2024, 3, 1, 12, 30, 15, 125)],
		['2024-04-01T12:30:15Z', Date.UTC(2024, 3, 1, 12, 30, 15)],
		['2024-04-01T12:30:15.125Z', Date.UTC(2024, 3, 1, 12, 30, 15, 125)],
		['2024-04-01T12:30:15+13:00', Date.UTC(2024, 2, 31, 23, 30, 15)],
		['2024-04-01T12:30-0400', Date.UTC(2024, 3, 1, 16, 30)]
	];
	for (const [text, ms] of CASES) {
		it(text, async () => {
			await load({
				columns: [
					{ name: 't', type: 'time', values: [text, null] },
					{ name: 'v', values: [1, 2] }
				]
			});
			expect(appCol('t').getData()).toEqual([ms, null]);
		});
	}

	it('epoch ms (numbers or numeric text) still need no format', async () => {
		const ms = Date.UTC(2024, 3, 1);
		const { session } = await load({
			columns: [{ name: 't', type: 'time', values: [ms, String(ms + 3600000)] }]
		});
		expect(session.data[0]).not.toHaveProperty('timeFormat');
		expect(appCol('t').getData()).toEqual([ms, ms + 3600000]);
	});
});

describe('time_zone on a draft column', () => {
	it('is saved as the app saves it, and the app reads the text in that zone', async () => {
		const { session } = await load({
			columns: [
				{
					name: 'nz',
					type: 'time',
					values: ['2024-04-07 01:30', '2024-04-07 02:30', '2024-04-07 02:30', '2024-04-07 03:30'],
					time_zone: NZ
				},
				{ name: 'asw', type: 'time', values: ['2024-04-07 01:30'], time_zone: 'UTC' },
				{ name: 'fix', type: 'time', values: ['2024-04-07 01:30'], time_zone: '+1200' }
			]
		});
		// What the normalizer emits is what the app saves back after loading it.
		const resaved = JSON.parse(outputCoreAsJson()).data;
		for (const name of ['nz', 'asw', 'fix']) {
			const emitted = session.data.find((c) => c.name === name);
			const back = resaved.find((c) => c.name === name);
			expect(back.timeZone, name).toBe(emitted.timeZone);
			expect(back.timeFormat, name).toEqual(emitted.timeFormat);
		}
		expect(session.data.find((c) => c.name === 'nz').timeZone).toBe(NZ);
		expect(session.data.find((c) => c.name === 'asw')).not.toHaveProperty('timeZone');
		expect(session.data.find((c) => c.name === 'fix').timeZone).toBe('+12:00');
		// The repeated hour, in order: 02:30 NZDT then 02:30 NZST, an hour apart.
		expect(appCol('nz').getData()).toEqual([
			Date.UTC(2024, 3, 6, 12, 30),
			Date.UTC(2024, 3, 6, 13, 30),
			Date.UTC(2024, 3, 6, 14, 30),
			Date.UTC(2024, 3, 6, 15, 30)
		]);
		expect(appCol('asw').getData()).toEqual([Date.UTC(2024, 3, 7, 1, 30)]);
		expect(appCol('fix').getData()).toEqual([Date.UTC(2024, 3, 6, 13, 30)]);
	});
});

describe("the Worker's reading of a session agrees with the app", () => {
	const t = (h) => `2024-04-01T${String(h).padStart(2, '0')}:00:00`;
	const hours = Array.from({ length: 30 }, (_, i) => i % 24);
	const DRAFT = {
		columns: [
			{ name: 'hive_t', type: 'time', values: hours.map(t), time_zone: NZ },
			{ name: 'hive', values: hours.map((h) => 30 + Math.sin(h)) },
			{ name: 'air_t', type: 'time', values: hours.map(t) },
			{ name: 'air', values: hours.map((h) => 10 + h) },
			{
				name: 'epoch_t',
				type: 'time',
				values: hours.map((h) => Date.UTC(2024, 3, 1, h)),
				time_zone: '+05:30'
			},
			{ name: 'z_t', type: 'time', values: hours.map((h) => `${t(h)}Z`), time_zone: NZ }
		],
		analyses: [
			{
				name: 'JoinData',
				args: { aTimeIN: 'hive_t', bTimeIN: 'air_t', aValuesIN: ['hive'], bValuesIN: ['air'] }
			},
			{
				name: 'JoinData',
				args: {
					aTimeIN: 'air_t',
					bTimeIN: 'hive_t',
					aValuesIN: ['air'],
					bValuesIN: ['hive'],
					shiftB: 13
				}
			},
			{
				name: 'Cosinor',
				args: { xIN: 'epoch_t', yIN: ['hive'], useFixedPeriod: true, fixedPeriod: 24 }
			},
			{ name: 'SimulatedData', args: {} }
		],
		plots: [
			{
				type: 'actogram',
				name: 'Two zones',
				series: [
					{ time: 'hive_t', values: 'hive' },
					{ time: 'air_t', values: 'air' }
				]
			},
			{
				type: 'scatterplot',
				name: 'Axis',
				series: [
					{ x: 'epoch_t', y: 'hive' },
					{ x: 'hive_t', y: 'hive' }
				]
			},
			{ type: 'actogram', name: 'One zone', series: [{ time: 'z_t', values: 'hive' }] }
		]
	};

	it('every column: the zone, as written or not, and where it comes from', async () => {
		const { session } = await load(DRAFT);
		const kinds = new Set();
		for (const c of session.data) {
			const app = appCol(c.name);
			expect(app, c.name).toBeTruthy();
			const mine = sessionColumnClock(session, c.id);
			const theirs = columnClock(app);
			expect({ named: mine.named, wall: mine.wall }, c.name).toEqual({
				named: theirs.named,
				wall: theirs.wall
			});
			// An analysis output is typed when the app computes it (the draft pre-allocates it as
			// a number column), so the app's type says which are time columns.
			if (app.type !== 'time') continue;
			const src = timeZoneSource(app);
			const z = describeColumnZone(session, c);
			const times = theirs.wall
				? 'as written'
				: src && readsWallClockText(src)
					? 'wall clock'
					: 'instants';
			expect(z.times, c.name).toBe(times);
			expect(z.from ?? null, c.name).toBe(src && src !== app ? src.name : null);
			kinds.add(`${z.times}|${z.from ? 'inherited' : 'own'}`);
		}
		// The draft covers every case: own and inherited, as written, wall clock and instants.
		expect([...kinds].sort()).toEqual(
			[
				'as written|inherited',
				'as written|own',
				'instants|inherited',
				'instants|own',
				'wall clock|inherited',
				'wall clock|own'
			].sort()
		);
	});

	it("a literal [Z] after the time (the app import guesser's spelling) is UTC instants in both", async () => {
		// The draft writes the Z token; a session saved by the app's import, Sequence Column or
		// Simulate Data spells it as a literal "[Z]" (plan 5f): the same instants, a zone on it
		// only names the clock.
		const built = normalizeSession(DRAFT);
		const session = JSON.parse(JSON.stringify(built.session));
		const z = session.data.find((c) => c.name === 'z_t');
		z.timeFormat = 'YYYY-MM-DD[T]HH:mm:ss[Z]';
		await importJson(JSON.parse(JSON.stringify(session)));
		const app = appCol('z_t');
		expect(app.getData()[0]).toBe(Date.UTC(2024, 3, 1, 0));
		expect(readsWallClockText(app)).toBe(false);
		expect(describeColumnZone(session, z).times).toBe('instants');
		const mine = sessionColumnClock(session, z.id);
		expect({ named: mine.named, wall: mine.wall }).toEqual({ named: NZ, wall: false });
		expect(columnClock(app)).toMatchObject({ named: NZ, wall: false });
	});

	it("check_draft's mixed-zone warnings are the app's own words", async () => {
		const { session } = await load(DRAFT);
		const warnings = mixedZoneWarnings(session);

		// Join Data: the node's own warning, read from the loaded node.
		const join = appConsts.tableProcessMap.get('JoinData').func;
		const appJoin = core.tableProcesses
			.filter((tp) => tp.name === 'JoinData')
			.map((tp) => join(tp.args)[0].zoneWarning)
			.filter(Boolean)
			.map((w) => `Join Data: ${w}`);
		expect(appJoin).toHaveLength(2);
		expect(warnings.filter((w) => w.startsWith('Join Data:'))).toEqual(appJoin);

		// Plots: the app says "different zones" on exactly the plots the draft check names.
		const named = (p) => warnings.some((w) => w.startsWith(`Plot "${p.name}"`));
		for (const p of core.plots) {
			const differ = p.type === 'actogram' ? p.plot.clockZonesDiffer : p.plot.xTimeZonesDiffer;
			expect(named(p), p.name).toBe(!!differ);
		}
		expect(warnings).toContain(
			`Plot "Two zones": The series' times are in different zones; the rows follow ${NZ}, the first series' zone.`
		);
		expect(warnings).toContain(
			`Plot "Axis": The series' times are in different zones; the x axis shows UTC+05:30 (fixed), the first series' zone.`
		);
	});
});

// ─── Outputs that become time columns when computed (plan 5e, Open) ─────────────────────────
// A draft pre-allocates every analysis output as a number column; the app types some of them
// 'time' when it computes them (Bin Data's binnedx, Cosinor's cosinorx, Join Data's jointime,
// Sort's copy of a time column, ...). check_draft's zone checks read them through
// sessionTimeTyper, so its answer is pinned here against every node in the registry.

describe('outputs typed time when computed: the Worker agrees with the app', () => {
	const N = 96;
	const iso = (i) => new Date(Date.UTC(2024, 3, 1, i)).toISOString().slice(0, 19);
	const COLUMNS = [
		{ name: 't', type: 'time', values: Array.from({ length: N }, (_, i) => iso(i)), time_zone: NZ },
		{ name: 't2', type: 'time', values: Array.from({ length: N }, (_, i) => iso(i)) },
		{ name: 'n', values: Array.from({ length: N }, (_, i) => i) },
		{
			name: 'v',
			values: Array.from(
				{ length: N },
				(_, i) => 10 + 5 * Math.sin((2 * Math.PI * i) / 24) + (i % 7) / 10
			)
		},
		{
			name: 'w',
			values: Array.from(
				{ length: N },
				(_, i) => 3 + Math.cos((2 * Math.PI * i) / 24) + (i % 5) / 10
			)
		},
		{ name: 'cat', values: Array.from({ length: N }, (_, i) => i % 2) }
	];

	/** Args wiring every input of `name`: x/time inputs to `x`, value inputs to `ys`. */
	function argsFor(name, x, ys) {
		const s = SCHEMA[name];
		const a = {};
		for (const f of s.inputs.scalar) {
			if (f === 'bTimeIN') a[f] = x === 't' ? 't2' : x;
			else if (f === 'categoryIN') a[f] = 'cat';
			else if (/time|^x/i.test(f)) a[f] = x;
			else a[f] = ys[0];
		}
		for (const f of s.inputs.array) a[f] = f === 'outColIds' ? [] : ys;
		if (name === 'Split') a.splitTimes = [48];
		if (name === 'Sort') a.sortOnId = 'n';
		if (name === 'CollectColumns') a.colIds = [x, ...ys];
		if (name === 'FormulaColumn') a.tokens = [{ type: 'col', id: ys[0] }];
		if (name === 'Crossing') {
			const target = COLUMNS.findIndex((c) => c.name === ys[0]);
			a.groups = [[{ target, isOperator: '>', source: -1, value: 10 }]];
		}
		if (name === 'JoinData') {
			a.aValuesIN = [ys[0]];
			a.bValuesIN = ys.slice(1);
		}
		return a;
	}

	/** Column names typed time by the app after computing, and by the Worker's typer. */
	async function both(draft) {
		const { session } = await load(draft);
		const isTime = sessionTimeTyper(session);
		const worker = session.data.filter((c) => isTime(c.id)).map((c) => c.name);
		const app = session.data
			.filter((c) => {
				const a = appCol(c.name);
				return a && (a.type === 'time' || a.originTime_ms != null);
			})
			.map((c) => c.name);
		return { worker, app, session };
	}

	const CASES = [
		['time x, number values', 't', ['v', 'w']],
		['number x, number values', 'n', ['v', 'w']],
		['time x, a time column among the values', 't', ['v', 't2']],
		['number x, a time column among the values', 'n', ['t2', 'v']]
	];
	const kinds = new Set();
	for (const [label, x, ys] of CASES) {
		it(`every node, ${label}`, async () => {
			for (const name of Object.keys(SCHEMA)) {
				const draft = { columns: COLUMNS, analyses: [{ name, args: argsFor(name, x, ys) }] };
				const { worker, app } = await both(draft);
				expect(worker.sort(), `${name} (${label})`).toEqual(app.sort());
				for (const n of app) if (!COLUMNS.some((c) => c.name === n)) kinds.add(name);
			}
		}, 120000);
	}

	it('the cases above exercise every rule (a node that stops typing time fails here)', () => {
		expect([...kinds].sort()).toEqual(
			[
				'BinnedData',
				'CollectColumns',
				'Cosinor',
				'Crossing',
				'DoubleLogistic',
				'FitFunction',
				'Interpolate',
				'JoinData',
				'LongToWide',
				'MovingAnalysis',
				'RectangularWave',
				'SimulatedData',
				'SmoothedData',
				'Sort',
				'Split',
				'TrendFit',
				'WideToLong'
			].sort()
		);
	});

	it('a fit on a number x with a time output x (column mode) and a chain of outputs', async () => {
		const { worker, app } = await both({
			columns: COLUMNS,
			analyses: [
				// outputX is a column id, not a name (the draft resolves names on inputs only).
				{ name: 'Cosinor', args: { xIN: 'n', yIN: ['v'], outputX: 1, outputXMode: 'column' } },
				{ name: 'BinnedData', args: { xIN: 't', yIN: ['v'], binSize: 2 } },
				{ name: 'TrendFit', args: { xIN: 'binnedx', yIN: ['binnedy_v'] } },
				{ name: 'Sort', args: { sortOnId: 'n', yIN: ['trendx'] } }
			]
		});
		expect(worker.sort()).toEqual(app.sort());
		expect(app).toEqual(expect.arrayContaining(['cosinorx', 'binnedx', 'trendx']));
	});

	it('check_draft warns of mixed zones through computed time columns, as the app does', async () => {
		const draft = {
			columns: COLUMNS,
			analyses: [
				{ name: 'BinnedData', args: { xIN: 't', yIN: ['v'], binSize: 1 } },
				{ name: 'BinnedData', args: { xIN: 't2', yIN: ['w'], binSize: 1 } },
				{
					name: 'JoinData',
					args: {
						aTimeIN: 'binnedx',
						bTimeIN: 'binnedx_1',
						aValuesIN: ['binnedy_v'],
						bValuesIN: ['binnedy_w']
					}
				}
			],
			plots: [
				{
					type: 'actogram',
					name: 'Binned',
					series: [
						{ time: 'binnedx', values: 'binnedy_v' },
						{ time: 'binnedx_1', values: 'binnedy_w' }
					]
				},
				{
					type: 'scatterplot',
					name: 'Joined',
					series: [
						{ x: 'jointime', y: 'v' },
						{ x: 't2', y: 'w' }
					]
				},
				{ type: 'actogram', name: 'One', series: [{ time: 'binnedx', values: 'binnedy_v' }] }
			]
		};
		const built = normalizeSession(draft);
		expect(built.errors).toEqual([]);
		// Before the typer, a draft saw no time column here at all.
		const before = built.session.data.filter((c) => c.type === 'time').map((c) => c.name);
		expect(before.sort()).toEqual(['t', 't2']);

		const { session } = await load(draft);
		const warnings = mixedZoneWarnings(session);
		const join = appConsts.tableProcessMap.get('JoinData').func;
		const appJoin = core.tableProcesses
			.filter((tp) => tp.name === 'JoinData')
			.map((tp) => join(tp.args)[0].zoneWarning)
			.filter(Boolean)
			.map((w) => `Join Data: ${w}`);
		expect(appJoin).toHaveLength(1);
		expect(warnings.filter((w) => w.startsWith('Join Data:'))).toEqual(appJoin);
		const named = (p) => warnings.some((w) => w.startsWith(`Plot "${p.name}"`));
		for (const p of core.plots) {
			const differ = p.type === 'actogram' ? p.plot.clockZonesDiffer : p.plot.xTimeZonesDiffer;
			expect(named(p), p.name).toBe(!!differ);
		}
		expect(named({ name: 'Binned' })).toBe(true);
		expect(named({ name: 'Joined' })).toBe(true);
		expect(named({ name: 'One' })).toBe(false);
		// Each computed column's zone and frame are the app's.
		for (const c of session.data) {
			const mine = sessionColumnClock(session, c.id);
			const theirs = columnClock(appCol(c.name));
			expect({ named: mine.named, wall: mine.wall }, c.name).toEqual({
				named: theirs.named,
				wall: theirs.wall
			});
		}
	});

	it('a free process output inherits its input column zone, as in the app', async () => {
		const built = normalizeSession({ columns: COLUMNS.slice(0, 3) });
		const session = JSON.parse(JSON.stringify(built.session));
		const t = session.data.find((c) => c.name === 't');
		const id = Math.max(...session.data.map((c) => c.id)) + 1;
		session.orphanProcesses = [{ id: 7, name: 'Add', args: { inIN: [t.id], value: 1 } }];
		session.data.push({
			...session.data.find((c) => c.name === 'n'),
			id,
			name: 'shifted',
			type: 'time',
			data: id,
			producerNodeId: 'process_7',
			producerPort: `out_${t.id}`
		});
		session.rawData[id] = [];
		await importJson(JSON.parse(JSON.stringify(session)));
		const app = core.data.find((c) => c.id === id);
		expect(app?.producerNodeId).toBe('process_7');
		expect(core.orphanProcesses.map((p) => p.id)).toEqual([7]);
		const mine = sessionColumnClock(session, id);
		expect({ named: mine.named, wall: mine.wall }).toEqual({
			named: columnClock(app).named,
			wall: columnClock(app).wall
		});
		expect(mine).toMatchObject({ named: NZ, from: 't' });
	});
});

// ─── Daylight-saving counts (plan 5e, Open) ─────────────────────────────────────────────────
describe("check_draft's daylight-saving warnings are the app's", () => {
	const ZONES = [
		'Pacific/Auckland',
		'America/New_York',
		'Europe/London',
		'Australia/Lord_Howe',
		'America/Santiago',
		'Asia/Kolkata',
		'+12:00',
		'utc'
	];
	const H = 3600000;
	// A wall clock series across both 2024 changes of every zone above, at several steps.
	function walls(stepMin, from, hours) {
		const out = [];
		for (let t = from; t < from + hours * H; t += stepMin * 60000) out.push(t);
		return out;
	}
	function shuffled(xs, seed) {
		const a = xs.slice();
		let s = seed;
		for (let i = a.length - 1; i > 0; i--) {
			s = (s * 16807) % 2147483647;
			const j = s % (i + 1);
			[a[i], a[j]] = [a[j], a[i]];
		}
		return a;
	}

	it('counts equal resolveWallClocks for in-order, sorted, shuffled and gappy columns', () => {
		const windows = [
			Date.UTC(2024, 3, 6, 12), // NZ ends 7 Apr, Lord Howe and Santiago too
			Date.UTC(2024, 8, 28, 12), // NZ begins 29 Sep
			Date.UTC(2024, 2, 9, 12), // US begins 10 Mar
			Date.UTC(2024, 9, 26, 12), // UK ends 27 Oct
			Date.UTC(2024, 10, 2, 12), // US ends 3 Nov
			Date.UTC(2024, 8, 6, 12) // Santiago begins 8 Sep (skipped midnight)
		];
		let compared = 0;
		const seen = { secondPass: 0, unordered: 0, skipped: 0 };
		for (const zone of ZONES) {
			for (const from of windows) {
				for (const step of [10, 15, 30, 60]) {
					const base = walls(step, from, 36);
					// A logger that follows daylight saving writes the repeated hour twice, in order.
					const repeated = base.filter((w) => resolveWallClocks([w], zone).repeated > 0);
					const first = repeated[0] ?? Infinity;
					const logger = [
						...base.filter((w) => w < first),
						...repeated,
						...base.filter((w) => w >= first)
					];
					const columns = [
						base,
						logger,
						shuffled(base, 7 + step),
						base.map((w, i) => (i % 5 === 0 ? null : w)),
						[...base].reverse()
					];
					for (const col of columns) {
						// eslint-disable-next-line no-unused-vars
						const { instants, ...app } = resolveWallClocks(col, zone);
						const mine = wallClockCounts(col, zone);
						expect(mine, `${zone} from ${new Date(from).toISOString()} step ${step}`).toEqual(app);
						for (const k of Object.keys(seen)) seen[k] += app[k];
						compared++;
					}
				}
			}
		}
		expect(compared).toBe(ZONES.length * 6 * 4 * 5);
		// Repeated hours a year apart, back to back, are two runs, not one (the run window).
		const w = (y, d, h, m) => Date.UTC(y, 3, d, h, m);
		const twoYears = [w(2024, 7, 2, 0), w(2024, 7, 2, 30), w(2024, 7, 2, 0), w(2025, 6, 2, 30)];
		// eslint-disable-next-line no-unused-vars
		const { instants, ...appTwo } = resolveWallClocks(twoYears, NZ);
		expect(appTwo).toMatchObject({ secondPass: 1, unordered: 1 });
		expect(wallClockCounts(twoYears, NZ)).toEqual(appTwo);
		// The columns above hit every kind of count.
		expect(seen.secondPass).toBeGreaterThan(0);
		expect(seen.unordered).toBeGreaterThan(0);
		expect(seen.skipped).toBeGreaterThan(0);
	});

	it('the words are dstCountWarnings', () => {
		for (const zone of ['Pacific/Auckland', 'Europe/London']) {
			for (const [skipped, unordered] of [
				[0, 0],
				[1, 0],
				[0, 1],
				[3, 1200],
				[1, 1]
			]) {
				const counts = { zone, skipped, unordered, repeated: unordered, secondPass: 0 };
				expect(workerDstWords(counts)).toEqual(dstCountWarnings(counts));
			}
		}
	});

	it('one resolver and one wording: the Worker imports the app modules, not a copy', () => {
		for (const name of [
			'resolveWallClocks',
			'wallClockToInstant',
			'instantToWallClock',
			'zoneOffsetMinutes'
		]) {
			expect(workerResolver[name], name).toBeTypeOf('function');
			expect(zones[name], name).toBe(workerResolver[name]);
		}
		expect(workerDstWords).toBe(dstCountWarnings);
	});

	const nzDay = (day, times) => times.map((hm) => `2024-${day} ${hm}`);
	const DST_DRAFT = {
		columns: [
			// Spring forward, 29 Sep 2024 02:00 to 03:00 NZ: 02:15 and 02:45 never happened.
			{
				name: 'spring',
				type: 'time',
				values: nzDay('09-29', ['01:30', '02:15', '02:45', '03:15']),
				time_zone: NZ
			},
			// Fall back, 7 Apr 2024 03:00 to 02:00: the repeated hour written once, sorted.
			{
				name: 'sorted',
				type: 'time',
				values: nzDay('04-07', ['01:30', '02:00', '02:15', '02:30', '02:45', '03:30']),
				time_zone: NZ
			},
			// The repeated hour twice, in order: information, not a warning.
			{
				name: 'logger',
				type: 'time',
				values: nzDay('04-07', ['01:30', '02:00', '02:30', '02:00', '02:30', '03:00']),
				time_zone: NZ
			},
			// A fixed offset and 'utc' have no daylight saving.
			{
				name: 'fixed',
				type: 'time',
				values: nzDay('09-29', ['02:15']),
				time_zone: '+12:00'
			},
			{ name: 'asw', type: 'time', values: nzDay('09-29', ['02:15']) },
			// Text with an offset names its instants.
			{ name: 'offs', type: 'time', values: ['2024-09-29T02:15:00+12:00'], time_zone: NZ }
		]
	};

	it('each column warns exactly what the loaded app column warns', async () => {
		const { session } = await load(DST_DRAFT);
		const mine = daylightSavingWarnings(session);
		const appWarnings = [];
		for (const c of session.data) {
			const app = appCol(c.name);
			const dst = columnWarnings(app).filter((w) => /daylight saving/.test(w));
			for (const w of dst) appWarnings.push(`Column "${c.name}": ${w}`);
		}
		expect(mine).toEqual(appWarnings);
		expect(mine).toEqual([
			`Column "spring": 2 times fall in the hour skipped when daylight saving began in ${NZ}, so they do not exist there; they are moved forward by the change (02:30 reads 03:30 after a 1 h change). This logger may not follow daylight saving: try a fixed offset.`,
			`Column "sorted": 4 times fall in the hour repeated when daylight saving ended in ${NZ}, and do not step back through it in order, so each is read as the earlier (daylight-saving) time. This logger may not follow daylight saving: try a fixed offset.`
		]);
	});
});
