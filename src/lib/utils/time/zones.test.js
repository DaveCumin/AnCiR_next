// Zones as the app names them: 'utc', fixed offsets and IANA names (per-column time zone,
// STAT-18). The Auckland dates straddle real daylight-saving changes: NZDT (+13:00) ended
// at 03:00 local on Sunday 7 April 2024 and NZST (+12:00) ended at 02:00 local on Sunday
// 29 September 2024.
import { describe, it, expect } from 'vitest';
import {
	UTC_ZONE,
	normalizeZone,
	isFixedOffset,
	fixedOffsetMinutes,
	formatFixedOffset,
	zoneOffsetMinutes,
	wallClockToInstant,
	instantToWallClock,
	dayjsInZone,
	parseInZone,
	zoneLabel,
	suggestZoneFromOffsets,
	COMMON_FIXED_OFFSETS
} from './zones.js';

const NZ = 'Pacific/Auckland';
const FMT = 'YYYY-MM-DD HH:mm';

describe('normalizeZone', () => {
	it('reads every spelling of UTC as utc', () => {
		for (const z of ['utc', 'UTC', ' Utc ', 'Z', 'GMT', 'Etc/UTC', '+00:00', '-0000']) {
			expect(normalizeZone(z)).toBe(UTC_ZONE);
		}
	});

	it('writes a fixed offset as ±HH:MM', () => {
		expect(normalizeZone('+0530')).toBe('+05:30');
		expect(normalizeZone('-04:00')).toBe('-04:00');
		expect(normalizeZone('+13:45')).toBe('+13:45');
	});

	it('keeps a real IANA zone and refuses junk', () => {
		expect(normalizeZone(NZ)).toBe(NZ);
		expect(normalizeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
		expect(normalizeZone('Mars/Olympus')).toBeNull();
		expect(normalizeZone('+25:00')).toBeNull();
		expect(normalizeZone('')).toBeNull();
		expect(normalizeZone(null)).toBeNull();
		expect(normalizeZone(5)).toBeNull();
	});

	it('the picker offsets are all valid, unique and none is +00:00', () => {
		expect(new Set(COMMON_FIXED_OFFSETS).size).toBe(COMMON_FIXED_OFFSETS.length);
		for (const z of COMMON_FIXED_OFFSETS) expect(normalizeZone(z)).toBe(z);
		expect(COMMON_FIXED_OFFSETS).not.toContain('+00:00');
	});
});

describe('fixed offsets', () => {
	it('parses and formats minutes east of UTC', () => {
		expect(isFixedOffset('+05:30')).toBe(true);
		expect(isFixedOffset(NZ)).toBe(false);
		expect(fixedOffsetMinutes('+05:30')).toBe(330);
		expect(fixedOffsetMinutes('-0930')).toBe(-570);
		expect(formatFixedOffset(-570)).toBe('-09:30');
		expect(formatFixedOffset(765)).toBe('+12:45');
	});
});

describe('zoneOffsetMinutes', () => {
	it('Auckland is +13:00 in summer and +12:00 in winter, changing on 7 April 2024', () => {
		// 6 Apr 2024 13:59 UTC is 02:59 NZDT on 7 Apr; at 14:00 UTC clocks went back to 02:00 NZST.
		expect(zoneOffsetMinutes(NZ, Date.UTC(2024, 3, 6, 13, 59))).toBe(780);
		expect(zoneOffsetMinutes(NZ, Date.UTC(2024, 3, 6, 14, 0))).toBe(720);
		expect(zoneOffsetMinutes(NZ, Date.UTC(2024, 6, 1))).toBe(720);
	});

	it('India is +05:30 all year; a fixed offset and utc are constant', () => {
		expect(zoneOffsetMinutes('Asia/Kolkata', Date.UTC(2024, 0, 1))).toBe(330);
		expect(zoneOffsetMinutes('Asia/Kolkata', Date.UTC(2024, 6, 1))).toBe(330);
		expect(zoneOffsetMinutes('+12:00', Date.UTC(2024, 0, 1))).toBe(720);
		expect(zoneOffsetMinutes(UTC_ZONE, Date.UTC(2024, 0, 1))).toBe(0);
	});
});

describe('wall clock and instant', () => {
	it('an Auckland wall clock in summer is 13 h ahead of the instant, in winter 12 h', () => {
		const summerWall = Date.UTC(2024, 0, 10, 8, 0); // 08:00 on 10 Jan, written in Auckland
		expect(wallClockToInstant(summerWall, NZ)).toBe(Date.UTC(2024, 0, 9, 19, 0));
		const winterWall = Date.UTC(2024, 6, 10, 8, 0);
		expect(wallClockToInstant(winterWall, NZ)).toBe(Date.UTC(2024, 6, 9, 20, 0));
	});

	it('instantToWallClock undoes wallClockToInstant away from a transition', () => {
		for (const zone of [NZ, 'Asia/Kolkata', '+05:45', UTC_ZONE]) {
			const wall = Date.UTC(2024, 4, 3, 17, 25);
			expect(instantToWallClock(wallClockToInstant(wall, zone), zone)).toBe(wall);
		}
	});
});

describe('dayjsInZone and parseInZone', () => {
	const ms = Date.UTC(2024, 3, 6, 12, 30); // 01:30 NZDT on 7 Apr, before the change
	it('formats one instant in each kind of zone', () => {
		expect(dayjsInZone(ms, UTC_ZONE).format(FMT)).toBe('2024-04-06 12:30');
		expect(dayjsInZone(ms, NZ).format(FMT)).toBe('2024-04-07 01:30');
		expect(dayjsInZone(ms, 'Asia/Kolkata').format(FMT)).toBe('2024-04-06 18:00');
		expect(dayjsInZone(ms, '+05:45').format(FMT)).toBe('2024-04-06 18:15');
		expect(dayjsInZone(ms, '-03:30').format(FMT)).toBe('2024-04-06 09:00');
	});

	it('parses the text it formats back to the same instant', () => {
		for (const zone of [UTC_ZONE, NZ, 'Asia/Kolkata', '+05:45', '-03:30']) {
			const text = dayjsInZone(ms, zone).format('YYYY-MM-DDTHH:mm');
			expect(parseInZone(text, null, zone)).toBe(ms);
			expect(parseInZone(dayjsInZone(ms, zone).format(FMT), FMT, zone)).toBe(ms);
		}
		expect(parseInZone('', null, NZ)).toBeNaN();
		expect(parseInZone('not a time', FMT, NZ)).toBeNaN();
	});
});

describe('zoneLabel', () => {
	it('reads as a person would', () => {
		expect(zoneLabel('utc')).toBe('UTC');
		expect(zoneLabel('+13:00')).toBe('UTC+13:00 (fixed)');
		expect(zoneLabel(NZ)).toBe(NZ);
	});
});

describe('suggestZoneFromOffsets', () => {
	const h = 3600000;
	it('one offset throughout is that fixed offset; Z is utc; none is null', () => {
		const s = [0, 1, 2].map((i) => ({ instant: Date.UTC(2024, 0, 1) + i * h, offset: 780 }));
		expect(suggestZoneFromOffsets(s)).toEqual({ zone: '+13:00', note: null, offsets: ['+13:00'] });
		const z = s.map((x) => ({ ...x, offset: 0 }));
		expect(suggestZoneFromOffsets(z).zone).toBe(UTC_ZONE);
		expect(suggestZoneFromOffsets([])).toBeNull();
	});

	it('offsets that change at Auckland daylight saving suggest Pacific/Auckland, preferred first', () => {
		const end = Date.UTC(2024, 3, 6, 14, 0); // NZDT ended
		const samples = [-2, -1, 0, 1, 2].map((i) => ({
			instant: end + i * h,
			offset: i < 0 ? 780 : 720
		}));
		const out = suggestZoneFromOffsets(samples, { preferZone: NZ, zones: ['Europe/London'] });
		expect(out.zone).toBe(NZ);
		expect(out.offsets).toEqual(['+13:00', '+12:00']);
		expect(out.note).toMatch(/daylight saving/);
	});

	it('finds the zone in the list when the preferred one does not fit', () => {
		const end = Date.UTC(2024, 3, 6, 14, 0);
		const samples = [-1, 1].map((i) => ({ instant: end + i * h, offset: i < 0 ? 780 : 720 }));
		const out = suggestZoneFromOffsets(samples, {
			preferZone: 'Europe/London',
			zones: ['Asia/Kolkata', NZ]
		});
		expect(out.zone).toBe(NZ);
	});

	it('no zone fits: the first offset, with a note', () => {
		const samples = [
			{ instant: Date.UTC(2024, 0, 1), offset: 330 },
			{ instant: Date.UTC(2024, 0, 2), offset: 345 }
		];
		const out = suggestZoneFromOffsets(samples, { zones: [NZ, 'Asia/Kolkata'] });
		expect(out.zone).toBe('+05:30');
		expect(out.note).toMatch(/no time zone matches/);
	});
});
