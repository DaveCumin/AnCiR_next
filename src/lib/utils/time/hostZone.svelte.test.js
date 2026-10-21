// @ts-nocheck
// Clock readings must not depend on the COMPUTER's own time zone (plan
// ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md, section 5f).
//
// dayjs keeps zoned times on the machine's local clock: `dayjs.utc(ms).utcOffset(fixed)` and
// `dayjs(ms).tz(zone)` read their fields through local Date getters and do arithmetic
// (`startOf`, `hour()`, `add`) in local time. Near a daylight-saving change of the MACHINE's
// zone the result is an hour off, so one session read differently on two computers:
//   - a '+12:00' column read 01:00 for 02:00 on 29 Sep 2024 on a computer in Auckland;
//   - an actogram of an Auckland column whose first sample is on 7 Apr 2024 (the end of NZ
//     daylight saving) started its rows at 01:00, not midnight, on a computer elsewhere.
//
// Every test here runs under several machine zones (process.env.TZ, which Node applies at
// once), so each expectation must hold on every one of them. Before the fix each failed on
// at least one zone (named beside it).
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { core, appState, appConsts } from '$lib/core/core.svelte.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { loadPlots } from '$test/plotRegistry.js';
import { rowLabelText } from '$lib/plots/Actogram/rowLabels.js';
import { clockHourOfDay } from '$lib/utils/phaseReference.js';
import { dayOfYear } from '$lib/components/plotbits/encodings.js';
import { formatDateTime, parseShownTime } from '$lib/utils/time/displayTime.js';
import { firstBandStart } from '$lib/utils/aiEdit.js';
import { parseTimeStrict, guessDateofArray } from '$lib/utils/time/TimeUtils.js';
import { actogramDstNote, binDstNote } from '$lib/utils/time/dstNotes.js';
import { formatClockInput } from '$lib/core/columnTimeZone.js';
import { zoneStartOfDay, wallClockDayjs, zoneTransitions } from '$lib/utils/time/zones.js';

const PLOTS = await loadPlots();
appConsts.plotMap = PLOTS;

const HOSTS = ['UTC', 'Pacific/Auckland', 'America/New_York', 'Europe/London', 'Asia/Kolkata'];
const savedTZ = process.env.TZ;
afterAll(() => {
	if (savedTZ === undefined) delete process.env.TZ;
	else process.env.TZ = savedTZ;
});

const H = 3600000;
// 29 Sep 2024 02:00 at +12:00 (NZ standard time): the instant NZ daylight saving begins.
const NZ_SPRING = Date.UTC(2024, 8, 28, 14);
// 10 Mar 2024 02:00 at -05:00 (New York standard time): the instant US daylight saving begins.
const NY_SPRING = Date.UTC(2024, 2, 10, 7);
// 7 Apr 2024 00:00 NZDT (+13:00), the local midnight of the day NZ daylight saving ends.
const NZ_AUTUMN_MIDNIGHT = Date.UTC(2024, 3, 6, 11);

/** Run `fn` once per machine zone; the test names the zone that failed. */
function onEveryHost(fn) {
	for (const host of HOSTS) {
		process.env.TZ = host;
		try {
			fn(host);
		} catch (e) {
			e.message = `[machine zone ${host}] ${e.message}`;
			throw e;
		}
	}
}

describe('fixed offsets read the same on every computer (failed in Auckland / New York)', () => {
	it('row labels', () => {
		onEveryHost(() => {
			const opts = { mode: 'date', periodHrs: 24, dateFormat: 'DD MMM HH:mm' };
			expect(rowLabelText(1, { ...opts, startTime: NZ_SPRING - 24 * H, zone: '+12:00' })).toBe(
				'29 Sep 02:00'
			);
			expect(rowLabelText(1, { ...opts, startTime: NY_SPRING - 24 * H, zone: '-05:00' })).toBe(
				'10 Mar 02:00'
			);
		});
	});

	it('hour of day (clock phase, Colour by)', () => {
		onEveryHost(() => {
			expect(clockHourOfDay(NZ_SPRING + 30 * 60000, '+12:00')).toBe(2.5);
			expect(clockHourOfDay(NY_SPRING + 30 * 60000, '-05:00')).toBe(2.5);
		});
	});

	it('times shown in a column zone, and typed back', () => {
		onEveryHost(() => {
			expect(formatDateTime(NZ_SPRING, 'YYYY-MM-DD HH:mm', '+12:00')).toBe('2024-09-29 02:00');
			expect(formatDateTime(NY_SPRING, 'YYYY-MM-DD HH:mm', '-05:00')).toBe('2024-03-10 02:00');
			expect(parseShownTime('2024-09-29T02:00', null, '+12:00')).toBe(NZ_SPRING);
		});
	});

	it('a light band placed at a clock hour', () => {
		onEveryHost(() => {
			const inner = { xlims: [NZ_SPRING - H], anyXdataTime: true };
			expect(firstBandStart(inner, 2, '+12:00')).toBe(NZ_SPRING);
			// 00:30 has passed on the zone's first day (it is 01:00 there): the next day's.
			expect(firstBandStart(inner, 0.5, '+12:00')).toBe(NZ_SPRING + 22.5 * H);
			const ny = { xlims: [NY_SPRING - H], anyXdataTime: true };
			expect(firstBandStart(ny, 2, '-05:00')).toBe(NY_SPRING);
		});
	});

	it('text with an offset is read, not dropped, at the machine zone change', () => {
		onEveryHost(() => {
			const fmt = 'YYYY-MM-DD[T]HH:mm:ssZ';
			expect(parseTimeStrict('2024-09-29T02:30:00+12:00', fmt).valueOf()).toBe(
				NZ_SPRING + 30 * 60000
			);
			expect(parseTimeStrict('2024-03-10T02:30:00-05:00', fmt).valueOf()).toBe(
				NY_SPRING + 30 * 60000
			);
		});
	});

	it('a Z or ZZ token in a display format prints the zone offset', () => {
		onEveryHost(() => {
			expect(wallClockDayjs(NZ_SPRING, '+12:00').format('HH:mm Z')).toBe('02:00 +12:00');
			expect(wallClockDayjs(NZ_SPRING, 'Pacific/Auckland').format('HH:mm ZZ [Z]')).toBe(
				'03:00 +1300 Z'
			);
			expect(wallClockDayjs(NZ_SPRING, 'utc').format('HH:mm Z')).toBe('14:00 +00:00');
		});
	});
});

describe('IANA zones read the same on every computer', () => {
	it("a zone's wall clock inside the MACHINE's skipped hour (failed in Auckland)", () => {
		// 29 Sep 2024 02:30 in New York (EDT) never happened on an Auckland clock.
		const ms = Date.UTC(2024, 8, 29, 6, 30);
		onEveryHost(() => {
			expect(formatDateTime(ms, 'YYYY-MM-DD HH:mm', 'America/New_York')).toBe('2024-09-29 02:30');
			expect(clockHourOfDay(ms, 'America/New_York')).toBe(2.5);
		});
	});

	it('day of year at a zone midnight', () => {
		onEveryHost(() => {
			expect(dayOfYear(NZ_AUTUMN_MIDNIGHT, 'Pacific/Auckland')).toBe(98);
			expect(dayOfYear(NZ_AUTUMN_MIDNIGHT - 1, 'Pacific/Auckland')).toBe(97);
		});
	});

	it('DST notes name the local time rows and bins start at', () => {
		onEveryHost(() => {
			const clock = { zone: 'Pacific/Auckland', named: 'Pacific/Auckland' };
			const changes = zoneTransitions(
				'Pacific/Auckland',
				NZ_AUTUMN_MIDNIGHT,
				NZ_AUTUMN_MIDNIGHT + 3 * 24 * H
			);
			expect(
				actogramDstNote(clock, changes, { startTime: NZ_AUTUMN_MIDNIGHT, periodHrs: 24 })
			).toContain('rows after it start at 23:00 local time');
			expect(
				binDstNote(clock, changes, { firstEdge: NZ_AUTUMN_MIDNIGHT, stepHrs: 24, binHrs: 24 })
			).toContain('bins after it start at 23:00 local time');
		});
	});
});

describe('the start of a day in a zone (failed off Auckland)', () => {
	it('local midnight on the day daylight saving ends, starts and on plain days', () => {
		onEveryHost(() => {
			// 7 Apr 2024 is 25 h long in Auckland; midnight is 00:00 NZDT.
			expect(zoneStartOfDay(NZ_AUTUMN_MIDNIGHT + 10 * H, 'Pacific/Auckland')).toBe(
				NZ_AUTUMN_MIDNIGHT
			);
			expect(zoneStartOfDay(NZ_AUTUMN_MIDNIGHT, 'Pacific/Auckland')).toBe(NZ_AUTUMN_MIDNIGHT);
			expect(zoneStartOfDay(NZ_AUTUMN_MIDNIGHT - 1, 'Pacific/Auckland')).toBe(
				NZ_AUTUMN_MIDNIGHT - 24 * H
			);
			// 29 Sep 2024 is 23 h long; midnight is 00:00 NZST (+12:00).
			expect(zoneStartOfDay(NZ_SPRING + 5 * H, 'Pacific/Auckland')).toBe(NZ_SPRING - 2 * H);
			// A zone whose day starts in the skipped hour (America/Santiago, 8 Sep 2024: 00:00
			// becomes 01:00): the day starts at its first instant, 01:00 local.
			expect(zoneStartOfDay(Date.UTC(2024, 8, 8, 12), 'America/Santiago')).toBe(
				Date.UTC(2024, 8, 8, 4)
			);
			expect(zoneStartOfDay(NZ_SPRING + 30 * 60000, '+12:00')).toBe(NZ_SPRING - 2 * H);
			expect(zoneStartOfDay(Date.UTC(2024, 2, 5, 7, 30), 'utc')).toBe(Date.UTC(2024, 2, 5));
		});
	});

	it("an actogram's automatic first row", () => {
		onEveryHost(() => {
			core.data = [];
			core.plots = [];
			core.rawData = new Map();
			appState.displayTimezone = 'utc';
			appState.showTimesIn = 'column';
			const t = new Column({ type: 'time', data: -1 });
			// Hourly instants from 7 Apr 2024 02:00 NZDT, the day daylight saving ends.
			core.rawData.set(
				t.id,
				Array.from({ length: 72 }, (_, i) => NZ_AUTUMN_MIDNIGHT + (2 + i) * H)
			);
			t.data = t.id;
			t.timeZone = 'Pacific/Auckland';
			core.data.push(t);
			const v = new Column({ type: 'number', data: -1 });
			core.rawData.set(
				v.id,
				Array.from({ length: 72 }, (_, i) => i % 24)
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
			const p = core.plots.at(-1).plot;
			expect(p.clockZone).toBe('Pacific/Auckland');
			expect(p.startTime).toBe(NZ_AUTUMN_MIDNIGHT);
			expect(formatClockInput(p.startTime, t)).toBe('2024-04-07T00:00:00');
		});
	});
});

describe('import format guessing (failed in Auckland)', () => {
	beforeEach(() => {
		process.env.TZ = 'UTC';
	});
	it("times that all fall in the machine's skipped hour are still read as times", () => {
		const values = Array.from(
			{ length: 12 },
			(_, i) => `2024-09-29 02:${String(i * 5).padStart(2, '0')}`
		);
		onEveryHost(() => {
			expect(guessDateofArray(values)).toBe('YYYY-MM-DD HH:mm');
		});
	});
});
