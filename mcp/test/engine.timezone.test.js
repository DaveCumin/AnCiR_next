// Per-column time zone through the ENGINE MCP (src/server.js import_data and list_columns,
// which delegate to AncirSession). A time column takes ISO text or epoch ms and an optional
// `time_zone`, stored as the app's import stores it, read by the app's own Column, and
// reported by list_columns with how its times relate to the zone. Plan
// ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md, sections 3.2, 3.9 and 5e.
//
// Pacific/Auckland 2024: NZDT (+13:00) until 03:00 on 7 Apr, then NZST (+12:00).
import { beforeAll, describe, expect, it } from 'vitest';
import { AncirSession, ensureRegistry } from '../src/engine/session.js';
import { core, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { columnClock } from '$lib/core/columnTimeZone.js';

beforeAll(async () => {
	await ensureRegistry();
});

const NZ = 'Pacific/Auckland';
const H = 3600000;
const saved = (name) => JSON.parse(outputCoreAsJson()).data.find((c) => c.name === name);
const col = (name) => core.data.find((c) => c.name === name);

describe('import_data time_zone', () => {
	it('reads text with no offset in its zone, saves the zone as the app does, and list_columns says so', () => {
		const s = new AncirSession('tz-wall');
		const added = s.importColumns([
			{
				name: 't',
				type: 'time',
				values: ['2024-04-01T12:00:00', '2024-04-01T13:00:00', null],
				time_zone: NZ
			},
			{ name: 'v', values: [1, 2, 3] }
		]);
		expect(added[0]).toEqual({ id: 0, name: 't', type: 'time', time_zone: NZ });
		expect(added[1]).toEqual({ id: 1, name: 'v', type: 'number' });
		// 12:00 NZDT is 23:00 UTC the day before.
		expect(col('t').getData()).toEqual([Date.UTC(2024, 2, 31, 23), Date.UTC(2024, 3, 1, 0), null]);
		expect(saved('t')).toMatchObject({ timeZone: NZ, timeFormat: 'YYYY-MM-DD[T]HH:mm:ss' });
		const listed = s.listColumns();
		expect(listed[0]).toEqual({
			id: 0,
			name: 't',
			type: 'time',
			length: 3,
			time_zone: NZ,
			times: 'wall clock'
		});
		expect(listed[1]).not.toHaveProperty('time_zone');
	});

	it("'utc' (any spelling) and no zone save no zone, read as written", () => {
		for (const tz of [undefined, 'utc', 'UTC', '+00:00']) {
			const s = new AncirSession('tz-utc');
			s.importColumns([
				{ name: 't', type: 'time', values: ['2024-04-01 12:00', '2024-04-01 13:00'], time_zone: tz }
			]);
			expect(saved('t')).not.toHaveProperty('timeZone');
			expect(col('t').getData()).toEqual([Date.UTC(2024, 3, 1, 12), Date.UTC(2024, 3, 1, 13)]);
			expect(s.listColumns()[0]).toMatchObject({ time_zone: 'utc', times: 'as written' });
		}
	});

	it('stores a fixed offset in its canonical form', () => {
		const s = new AncirSession('tz-fixed');
		s.importColumns([
			{ name: 't', type: 'time', values: ['2024-04-08 12:00'], time_zone: '+1200' }
		]);
		expect(saved('t').timeZone).toBe('+12:00');
		expect(col('t').getData()).toEqual([Date.UTC(2024, 3, 8, 0)]);
	});

	it('epoch ms and text with an offset keep their instants; the zone names their clock', () => {
		const s = new AncirSession('tz-instant');
		const ms = [Date.UTC(2024, 3, 1, 0), Date.UTC(2024, 3, 1, 1)];
		s.importColumns([
			{ name: 'e', type: 'time', values: ms, time_zone: NZ },
			{
				name: 'z',
				type: 'time',
				values: ['2024-04-01T00:00:00Z', '2024-04-01T01:00:00Z'],
				time_zone: NZ
			},
			{ name: 'o', type: 'time', values: ['2024-04-01T13:00:00+13:00'], time_zone: NZ }
		]);
		expect(col('e').getData()).toEqual(ms);
		// "Z" means UTC: a zone on the column does not move it.
		expect(col('z').getData()).toEqual(ms);
		expect(col('o').getData()).toEqual([ms[0]]);
		for (const n of ['e', 'z', 'o']) {
			expect(s.listColumns().find((c) => c.name === n)).toMatchObject({
				time_zone: NZ,
				times: 'instants'
			});
			expect(columnClock(col(n))).toMatchObject({ zone: NZ, named: NZ, wall: false });
		}
	});

	it('refuses an unknown zone, a zone on a non-time column, and text that is not ISO 8601, importing nothing', () => {
		const s = new AncirSession('tz-bad');
		expect(() =>
			s.importColumns([
				{ name: 'ok', values: [1] },
				{ name: 't', type: 'time', values: ['2024-04-01 12:00'], time_zone: 'Mars/Olympus' }
			])
		).toThrow(
			'Column "t": time_zone "Mars/Olympus" is not a time zone. Use an IANA name such as "Pacific/Auckland" (follows daylight saving), a fixed offset such as "+12:00" (never changes), or "utc".'
		);
		expect(() => s.importColumns([{ name: 'v', values: [1], time_zone: NZ }])).toThrow(
			'time_zone is only for a time column'
		);
		expect(() => s.importColumns([{ name: 't', type: 'time', values: ['1 April 2024'] }])).toThrow(
			'Write times as ISO 8601 text'
		);
		expect(core.data).toHaveLength(0);
	});

	it("an analysis output inherits its input's zone, and list_columns says where from", async () => {
		const s = new AncirSession('tz-inherit');
		s.importColumns([
			{
				name: 't',
				type: 'time',
				values: Array.from(
					{ length: 6 },
					(_, i) => `2024-04-01T${String(10 + i).padStart(2, '0')}:00:00`
				),
				time_zone: NZ
			},
			{ name: 'v', values: [1, 2, 3, 4, 5, 6] }
		]);
		const r = await s.runTableProcess('Cosinor', {
			xIN: 't',
			yIN: ['v'],
			useFixedPeriod: true,
			fixedPeriod: 24
		});
		expect(r.error ?? null).toBe(null);
		const fitX = r.outputs.find((o) => o.key === 'cosinorx').name;
		expect(s.listColumns().find((c) => c.name === fitX)).toMatchObject({
			type: 'time',
			time_zone: NZ,
			times: 'wall clock',
			zone_from: 't'
		});
		// Hourly text read in NZDT: 10:00 NZDT is 21:00 UTC the day before.
		expect(col('t').getData()[0]).toBe(Date.UTC(2024, 2, 31, 21));
		expect(col('t').getData()[5] - col('t').getData()[0]).toBe(5 * H);
	});
});
