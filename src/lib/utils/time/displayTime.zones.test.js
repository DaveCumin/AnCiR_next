// How a stored time is SHOWN once columns carry their own zone (STAT-18, phase 1).
//
// Three settings decide it (displayTime.js header): a legacy session's one zone, "Show times
// in", and the column's frame { zone, wall }. These tests pin each, with an Auckland date on
// each side of a daylight-saving change, India's +5:30, UTC and a fixed offset.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import dayjs from './dayjsSetup.js';

const appState = vi.hoisted(() => ({ displayTimezone: 'utc', showTimesIn: 'column' }));
vi.mock('$lib/core/core.svelte', () => ({ appState }));

import {
	formatDateTime,
	formatTimeAxisTick,
	autoTickPattern,
	formatDateTimeLocalInput,
	parseDateTimeLocalInput,
	parseShownTime,
	shownZoneLabel,
	getClockZone,
	getDisplayZone,
	getLegacyZone,
	getShowTimesIn,
	toTimeFrame,
	zoneAlignedTicks
} from './displayTime.js';
import { scaleUtc } from 'd3-scale';
import { formatTimeFromUNIX, timeCellText } from './TimeUtils.js';

const NZ = 'Pacific/Auckland';
const F = 'YYYY-MM-DD HH:mm';
// 08:00 written on 10 Jan (NZDT, +13) and on 10 Jul (NZST, +12), stored as UTC wall clocks.
const JAN_WALL = Date.UTC(2024, 0, 10, 8, 0);
const JUL_WALL = Date.UTC(2024, 6, 10, 8, 0);

const wall = (zone) => ({ zone, wall: true }); // a zone-less text column
const instant = (zone) => ({ zone, wall: false }); // text with offsets, or epoch ms

beforeEach(() => {
	appState.displayTimezone = 'utc';
	appState.showTimesIn = 'column';
});

describe('each column in its own zone (the default)', () => {
	it('a zone-less column shows exactly as written, whatever its zone', () => {
		for (const zone of ['utc', NZ, 'Asia/Kolkata', '+05:45']) {
			expect(formatDateTime(JAN_WALL, F, wall(zone))).toBe('2024-01-10 08:00');
			expect(formatDateTime(JUL_WALL, F, wall(zone))).toBe('2024-07-10 08:00');
		}
	});

	it('an instant column shows in its zone: Auckland across daylight saving, India, fixed, UTC', () => {
		const jan = Date.UTC(2024, 0, 9, 19, 0); // 08:00 NZDT
		const jul = Date.UTC(2024, 6, 9, 20, 0); // 08:00 NZST
		expect(formatDateTime(jan, F, instant(NZ))).toBe('2024-01-10 08:00');
		expect(formatDateTime(jul, F, instant(NZ))).toBe('2024-07-10 08:00');
		expect(formatDateTime(jan, F, instant('Asia/Kolkata'))).toBe('2024-01-10 00:30');
		expect(formatDateTime(jan, F, instant('+13:00'))).toBe('2024-01-10 08:00');
		expect(formatDateTime(jul, F, instant('+13:00'))).toBe('2024-07-10 09:00');
		expect(formatDateTime(jan, F, instant('utc'))).toBe('2024-01-09 19:00');
	});

	it('no zone given reads as a zone-less UTC column (how every time was shown before)', () => {
		expect(formatDateTime(JAN_WALL, F)).toBe('2024-01-10 08:00');
		expect(formatTimeFromUNIX(JAN_WALL)).toBe('10 Jan 2024 08:00:00');
	});

	it('a Column-like object is read through its timeFrame; a zone name is an instant zone', () => {
		const col = { timeFrame: instant(NZ) };
		expect(formatDateTime(Date.UTC(2024, 0, 9, 19, 0), F, col)).toBe('2024-01-10 08:00');
		expect(toTimeFrame('Asia/Kolkata')).toEqual(instant('Asia/Kolkata'));
		expect(toTimeFrame(null)).toEqual(wall('utc'));
	});

	it('axis ticks pick their pattern in the shown zone', () => {
		const utcMidnight = Date.UTC(2024, 0, 10, 0, 0);
		expect(autoTickPattern(utcMidnight, instant('utc'))).toBe('D MMM');
		// UTC midnight is 13:00 in Auckland, so the tick reads as a time of day there.
		expect(autoTickPattern(utcMidnight, instant(NZ))).toBe('HH:mm');
		expect(formatTimeAxisTick(utcMidnight, instant(NZ))).toBe('13:00');
		expect(formatTimeAxisTick(utcMidnight, wall(NZ))).toBe('10 Jan');
	});

	it('table cells: text stays as written, a computed time shows in its zone', () => {
		expect(timeCellText('2024-01-10 08:00', JAN_WALL, wall(NZ))).toBe('2024-01-10 08:00');
		expect(
			timeCellText(Date.UTC(2024, 0, 9, 19, 0), Date.UTC(2024, 0, 9, 19, 0), instant(NZ))
		).toBe('10 Jan 2024 08:00:00');
	});
});

describe('"Show times in" a chosen zone (display override)', () => {
	it('relabels an instant column in the chosen zone', () => {
		appState.showTimesIn = 'Asia/Kolkata';
		expect(formatDateTime(Date.UTC(2024, 0, 9, 19, 0), F, instant(NZ))).toBe('2024-01-10 00:30');
	});

	it('a zone-less Auckland column is converted from its wall clock, DST included', () => {
		appState.showTimesIn = 'utc';
		expect(formatDateTime(JAN_WALL, F, wall(NZ))).toBe('2024-01-09 19:00');
		expect(formatDateTime(JUL_WALL, F, wall(NZ))).toBe('2024-07-09 20:00');
		// An "as written" UTC column is its instant already.
		appState.showTimesIn = NZ;
		expect(formatDateTime(JAN_WALL, F, wall('utc'))).toBe('2024-01-10 21:00');
	});

	it('a fixed offset can be the override', () => {
		appState.showTimesIn = '-03:30';
		expect(formatDateTime(Date.UTC(2024, 0, 10, 12, 0), F, instant('utc'))).toBe(
			'2024-01-10 08:30'
		);
	});

	it('an unknown override falls back to each column own zone', () => {
		appState.showTimesIn = 'Mars/Olympus';
		expect(getShowTimesIn()).toBe('column');
	});

	it('says which zone is shown', () => {
		expect(shownZoneLabel(instant(NZ))).toBe(NZ);
		appState.showTimesIn = '+05:30';
		expect(shownZoneLabel(instant(NZ))).toBe('UTC+05:30 (fixed)');
	});

	it('does NOT move the clock-time zone analysis reads (decision 2)', () => {
		appState.showTimesIn = NZ;
		expect(getClockZone()).toBe('utc');
		expect(getDisplayZone()).toBe('utc');
	});
});

describe('a legacy session (saved with a non-UTC Timezone setting)', () => {
	// The formula every display used before per-column zones.
	const before = (ms, zone, fmt) =>
		(zone === 'utc' ? dayjs.utc(ms) : dayjs(ms).tz(zone)).format(fmt);

	it('renders every time exactly as before, whatever the column zones or override say', () => {
		appState.displayTimezone = NZ;
		appState.showTimesIn = 'Asia/Kolkata';
		for (const ms of [
			JAN_WALL,
			JUL_WALL,
			Date.UTC(2024, 3, 6, 13, 30),
			Date.UTC(2024, 8, 28, 14, 30)
		]) {
			for (const frame of [wall('utc'), wall(NZ), instant('+05:30'), null]) {
				expect(formatDateTime(ms, F, frame)).toBe(before(ms, NZ, F));
				expect(formatTimeAxisTick(ms, frame)).toBe(before(ms, NZ, autoTickPattern(ms, frame)));
			}
		}
		expect(getLegacyZone()).toBe(NZ);
	});

	it('keeps its zone for clock-time analysis', () => {
		appState.displayTimezone = NZ;
		expect(getClockZone()).toBe(NZ);
		expect(getDisplayZone()).toBe(NZ);
	});

	it('utc (any case) is not legacy', () => {
		appState.displayTimezone = 'UTC';
		expect(getLegacyZone()).toBeNull();
		expect(getClockZone()).toBe('utc');
	});
});

describe('typing a time back (the inverse of how it is shown)', () => {
	const cases = [
		['each column own zone', 'column', null],
		['override', 'Asia/Kolkata', null],
		['legacy', 'column', NZ]
	];
	it.each(cases)('round-trips in every frame: %s', (_, show, legacy) => {
		appState.showTimesIn = show;
		appState.displayTimezone = legacy ?? 'utc';
		for (const frame of [wall('utc'), wall(NZ), instant(NZ), instant('+05:45'), null]) {
			for (const ms of [JAN_WALL, JUL_WALL]) {
				const text = formatDateTimeLocalInput(ms, frame);
				expect(parseDateTimeLocalInput(text, frame)).toBe(ms);
				expect(
					parseShownTime(
						formatDateTime(ms, 'DD MMM YYYY HH:mm:ss', frame),
						'DD MMM YYYY HH:mm:ss',
						frame
					)
				).toBe(ms);
			}
		}
	});
});

describe('time axis ticks on round times of the shown zone', () => {
	const utcTicks = (d, c) => scaleUtc().domain(d).ticks(c);
	const domain = [Date.UTC(2024, 3, 4, 23, 0), Date.UTC(2024, 3, 6, 23, 0)];

	it('d3 UTC ticks are kept where they are already round: as written, UTC, legacy', () => {
		expect(zoneAlignedTicks(domain, 5, wall(NZ), utcTicks)).toBeNull();
		expect(zoneAlignedTicks(domain, 5, instant('utc'), utcTicks)).toBeNull();
		appState.displayTimezone = NZ;
		expect(zoneAlignedTicks(domain, 5, instant('+13:00'), utcTicks)).toBeNull();
	});

	it('a +13:00 column gets ticks on its own midnights and noons', () => {
		const ticks = zoneAlignedTicks(domain, 5, instant('+13:00'), utcTicks);
		const shown = ticks.map((t) => formatTimeAxisTick(+t, instant('+13:00')));
		// The domain is 12:00 on 5 Apr to 12:00 on 7 Apr in +13:00.
		expect(shown).toEqual(['12:00', '6 Apr', '12:00', '7 Apr', '12:00']);
		for (const t of ticks) expect(+t).toBeGreaterThanOrEqual(domain[0]);
	});

	it('India +5:30 and an override convert the same way', () => {
		const ticks = zoneAlignedTicks(domain, 5, instant('Asia/Kolkata'), utcTicks);
		for (const t of ticks) {
			expect(['00:00', '12:00']).toContain(formatDateTime(+t, 'HH:mm', instant('Asia/Kolkata')));
		}
		appState.showTimesIn = 'Asia/Kolkata';
		const viaOverride = zoneAlignedTicks(domain, 5, wall(NZ), utcTicks);
		for (const t of viaOverride) {
			expect(['00:00', '12:00']).toContain(formatDateTime(+t, 'HH:mm', wall(NZ)));
		}
	});
});
