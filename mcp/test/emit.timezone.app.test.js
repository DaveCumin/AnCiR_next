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
	mixedZoneWarnings
} from '../src/emit/timeColumns.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { core, appConsts, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { columnClock, timeZoneSource, readsWallClockText } from '$lib/core/columnTimeZone.js';

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
