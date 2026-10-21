// The wall-clock resolver (per-column time zone, phase 3; plan sections 3.10 and 7): a wall
// clock written in a zone, read as UTC ms, to the instant it names, with the repeated and the
// missing hour of a daylight-saving change resolved by the plan's rules.
//
// Every expected instant is written out from the zone's published rules, not computed by the
// code under test. 2024 changes used:
//   Pacific/Auckland  back 03:00 NZDT -> 02:00 NZST on 7 Apr (06 Apr 14:00 UTC);
//                     forward 02:00 NZST -> 03:00 NZDT on 29 Sep (28 Sep 14:00 UTC)
//   Europe/London     forward 01:00 GMT -> 02:00 BST on 31 Mar (01:00 UTC);
//                     back 02:00 BST -> 01:00 GMT on 27 Oct (01:00 UTC)
//   America/New_York  forward 02:00 EST -> 03:00 EDT on 10 Mar (07:00 UTC);
//                     back 02:00 EDT -> 01:00 EST on 3 Nov (06:00 UTC)
//   Pacific/Chatham   +13:45 / +12:45: back 03:45 -> 02:45 on 7 Apr; forward 02:45 -> 03:45 on 29 Sep
//   Australia/Lord_Howe  +11:00 / +10:30 (a 30-minute change): back 02:00 -> 01:30 on 7 Apr
//                     (06 Apr 15:00 UTC); forward 02:00 -> 02:30 on 6 Oct (05 Oct 15:30 UTC)
import { describe, it, expect } from 'vitest';
import {
	resolveWallClocks,
	wallClockToInstant,
	instantToWallClock,
	parseInZone,
	UTC_ZONE
} from './zones.js';

const NZ = 'Pacific/Auckland';
const U = Date.UTC;
const MIN = 60000;
const H = 3600000;

/** A wall clock as UTC ms, written as its text. */
const wall = (y, mo, d, h, mi = 0) => U(y, mo - 1, d, h, mi);

describe('wallClockToInstant: one value', () => {
	const cases = [
		// [zone, wall, instant, what]
		[NZ, wall(2024, 1, 10, 8), U(2024, 0, 9, 19), 'NZ summer, +13:00'],
		[NZ, wall(2024, 7, 10, 8), U(2024, 6, 9, 20), 'NZ winter, +12:00'],
		[NZ, wall(2024, 4, 7, 1, 59), U(2024, 3, 6, 12, 59), 'NZ just before the repeated hour'],
		[NZ, wall(2024, 4, 7, 2, 30), U(2024, 3, 6, 13, 30), 'NZ repeated hour: the earlier (NZDT)'],
		[NZ, wall(2024, 4, 7, 3, 0), U(2024, 3, 6, 15, 0), 'NZ just after the repeated hour'],
		[NZ, wall(2024, 9, 29, 1, 59), U(2024, 8, 28, 13, 59), 'NZ just before the gap'],
		[NZ, wall(2024, 9, 29, 2, 30), U(2024, 8, 28, 14, 30), 'NZ gap: shifted forward to 03:30 NZDT'],
		[NZ, wall(2024, 9, 29, 3, 0), U(2024, 8, 28, 14, 0), 'NZ just after the gap'],
		['Europe/London', wall(2024, 3, 31, 0, 59), U(2024, 2, 31, 0, 59), 'London before the gap'],
		['Europe/London', wall(2024, 3, 31, 1, 30), U(2024, 2, 31, 1, 30), 'London gap shifted'],
		['Europe/London', wall(2024, 3, 31, 2, 0), U(2024, 2, 31, 1, 0), 'London after the gap'],
		['Europe/London', wall(2024, 10, 27, 1, 30), U(2024, 9, 27, 0, 30), 'London repeated, earlier'],
		['Europe/London', wall(2024, 10, 27, 2, 0), U(2024, 9, 27, 2, 0), 'London after the repeat'],
		['America/New_York', wall(2024, 3, 10, 2, 30), U(2024, 2, 10, 7, 30), 'New York gap shifted'],
		['America/New_York', wall(2024, 3, 10, 3, 0), U(2024, 2, 10, 7, 0), 'New York after the gap'],
		['America/New_York', wall(2024, 11, 3, 1, 30), U(2024, 10, 3, 5, 30), 'New York repeated'],
		['America/New_York', wall(2024, 11, 3, 2, 0), U(2024, 10, 3, 7, 0), 'New York after it'],
		['Asia/Kolkata', wall(2024, 6, 1, 8), U(2024, 5, 1, 2, 30), 'India +05:30'],
		['Asia/Kathmandu', wall(2024, 6, 1, 8), U(2024, 5, 1, 2, 15), 'Nepal +05:45'],
		['Pacific/Chatham', wall(2024, 1, 10, 8), U(2024, 0, 9, 18, 15), 'Chatham +13:45'],
		['Pacific/Chatham', wall(2024, 7, 10, 8), U(2024, 6, 9, 19, 15), 'Chatham +12:45'],
		['Pacific/Chatham', wall(2024, 4, 7, 3, 0), U(2024, 3, 6, 13, 15), 'Chatham repeated'],
		['Pacific/Chatham', wall(2024, 9, 29, 3, 0), U(2024, 8, 28, 14, 15), 'Chatham gap shifted'],
		['Australia/Lord_Howe', wall(2024, 4, 7, 1, 45), U(2024, 3, 6, 14, 45), 'Lord Howe repeated'],
		['Australia/Lord_Howe', wall(2024, 4, 7, 2, 0), U(2024, 3, 6, 15, 30), 'Lord Howe after'],
		['Australia/Lord_Howe', wall(2024, 10, 6, 2, 15), U(2024, 9, 5, 15, 45), 'Lord Howe gap'],
		['Australia/Lord_Howe', wall(2024, 10, 6, 2, 30), U(2024, 9, 5, 15, 30), 'Lord Howe after'],
		['+12:00', wall(2024, 4, 7, 2, 30), U(2024, 3, 6, 14, 30), 'fixed +12:00 has no repeat'],
		['+12:00', wall(2024, 9, 29, 2, 30), U(2024, 8, 28, 14, 30), 'fixed +12:00 has no gap'],
		['-03:30', wall(2024, 1, 1, 0), U(2024, 0, 1, 3, 30), 'fixed -03:30'],
		[UTC_ZONE, wall(2024, 4, 7, 2, 30), wall(2024, 4, 7, 2, 30), 'utc is the wall clock']
	];
	for (const [zone, w, want, what] of cases) {
		it(what, () => expect(wallClockToInstant(w, zone)).toBe(want));
	}

	it('a gap value reads 1 h later on the clock; a repeated one reads as written', () => {
		expect(instantToWallClock(wallClockToInstant(wall(2024, 9, 29, 2, 30), NZ), NZ)).toBe(
			wall(2024, 9, 29, 3, 30)
		);
		expect(instantToWallClock(wallClockToInstant(wall(2024, 4, 7, 2, 30), NZ), NZ)).toBe(
			wall(2024, 4, 7, 2, 30)
		);
	});

	it('passes a missing value through', () => {
		expect(wallClockToInstant(null, NZ)).toBeNull();
		expect(wallClockToInstant(NaN, NZ)).toBeNaN();
	});

	it('refuses a zone it does not know', () => {
		expect(() => wallClockToInstant(wall(2024, 1, 1, 0), 'Mars/Olympus')).toThrow(RangeError);
		expect(() => resolveWallClocks([wall(2024, 1, 1, 0)], '+25:00')).toThrow(RangeError);
	});

	it('parseInZone reads a typed time with the same rules', () => {
		expect(parseInZone('2024-04-07T02:30', null, NZ)).toBe(U(2024, 3, 6, 13, 30));
		expect(parseInZone('2024-09-29T02:30', null, NZ)).toBe(U(2024, 8, 28, 14, 30));
	});
});

/** Walls every `stepMin` minutes from h0:m0 for `n` steps, as one logger would write them. */
function series(y, mo, d, h0, m0, stepMin, n) {
	return Array.from({ length: n }, (_, i) => wall(y, mo, d, h0, m0) + i * stepMin * MIN);
}

describe('resolveWallClocks: a column', () => {
	it('utc returns the walls unchanged, nulls and NaN kept', () => {
		const walls = [wall(2024, 4, 7, 2, 30), null, NaN, wall(2024, 4, 7, 2, 30)];
		const r = resolveWallClocks(walls, UTC_ZONE);
		expect(r.instants).toEqual(walls);
		expect([r.repeated, r.secondPass, r.skipped]).toEqual([0, 0, 0]);
	});

	it('a logger that follows daylight saving, every 10 min across the NZ repeated hour: in order', () => {
		// 01:50, 02:00 … 02:50 (NZDT), then 02:00 … 02:50 again (NZST), then 03:00.
		const walls = [
			wall(2024, 4, 7, 1, 50),
			...series(2024, 4, 7, 2, 0, 10, 6),
			...series(2024, 4, 7, 2, 0, 10, 6),
			wall(2024, 4, 7, 3, 0)
		];
		const r = resolveWallClocks(walls, NZ);
		const first = U(2024, 3, 6, 12, 50);
		expect(r.instants).toEqual(walls.map((_, i) => first + i * 10 * MIN));
		expect(r.repeated).toBe(12);
		expect(r.secondPass).toBe(6);
		expect(r.unordered).toBe(0);
		expect(r.skipped).toBe(0);
	});

	it('an hourly logger writes the repeated hour as the same time twice: still in order', () => {
		const walls = [
			wall(2024, 4, 7, 1),
			wall(2024, 4, 7, 2),
			wall(2024, 4, 7, 2),
			wall(2024, 4, 7, 3)
		];
		const r = resolveWallClocks(walls, NZ);
		expect(r.instants).toEqual([
			U(2024, 3, 6, 12),
			U(2024, 3, 6, 13),
			U(2024, 3, 6, 14),
			U(2024, 3, 6, 15)
		]);
		expect([r.repeated, r.secondPass]).toEqual([2, 1]);
	});

	it('blank cells inside the repeated hour do not break the run', () => {
		const walls = [wall(2024, 4, 7, 2, 30), null, wall(2024, 4, 7, 2, 15), ''];
		const r = resolveWallClocks(walls, NZ);
		expect(r.instants).toEqual([U(2024, 3, 6, 13, 30), null, U(2024, 3, 6, 14, 15), '']);
		expect(r.secondPass).toBe(1);
	});

	it('London and New York autumn, in order', () => {
		const ln = [...series(2024, 10, 27, 1, 0, 30, 2), ...series(2024, 10, 27, 1, 0, 30, 2)];
		expect(resolveWallClocks(ln, 'Europe/London').instants).toEqual(
			[0, 1, 2, 3].map((k) => U(2024, 9, 27, 0, 0) + k * 30 * MIN)
		);
		const ny = [...series(2024, 11, 3, 1, 0, 30, 2), ...series(2024, 11, 3, 1, 0, 30, 2)];
		expect(resolveWallClocks(ny, 'America/New_York').instants).toEqual(
			[0, 1, 2, 3].map((k) => U(2024, 10, 3, 5, 0) + k * 30 * MIN)
		);
	});

	it('Lord Howe: a 30-minute repeat, in order', () => {
		// 01:30, 01:45 (LHDT, +11:00), then 01:30, 01:45 again (LHST, +10:30).
		const walls = [...series(2024, 4, 7, 1, 30, 15, 2), ...series(2024, 4, 7, 1, 30, 15, 2)];
		const r = resolveWallClocks(walls, 'Australia/Lord_Howe');
		expect(r.instants).toEqual([0, 1, 2, 3].map((k) => U(2024, 3, 6, 14, 30) + k * 15 * MIN));
		expect([r.repeated, r.secondPass]).toEqual([4, 2]);
	});

	it('out of order (rows sorted by the written time): every repeated value takes the earlier instant', () => {
		// What sorting by the text does to a 10-min DST logger: each time twice in a row.
		const walls = series(2024, 4, 7, 2, 0, 10, 3).flatMap((w) => [w, w]);
		const r = resolveWallClocks(walls, NZ);
		expect(r.instants).toEqual(walls.map((w) => w - 13 * H));
		expect([r.repeated, r.secondPass, r.unordered]).toEqual([6, 0, 6]);
	});

	it('shuffled: the earlier instant', () => {
		const walls = [
			wall(2024, 4, 7, 2, 40),
			wall(2024, 4, 7, 2, 10),
			wall(2024, 4, 7, 2, 50),
			wall(2024, 4, 7, 2, 0)
		];
		const r = resolveWallClocks(walls, NZ);
		expect(r.instants).toEqual(walls.map((w) => w - 13 * H));
		expect(r.secondPass).toBe(0);
	});

	it('a logger on standard time all year read as NZ: the repeated hour once, the earlier instant', () => {
		const walls = series(2024, 4, 7, 1, 50, 10, 8); // 01:50 to 03:00, never stepping back
		const r = resolveWallClocks(walls, NZ);
		expect(r.instants.slice(0, 7)).toEqual(walls.slice(0, 7).map((w) => w - 13 * H));
		expect(r.instants[7]).toBe(wall(2024, 4, 7, 3, 0) - 12 * H);
		expect([r.repeated, r.secondPass, r.unordered, r.skipped]).toEqual([6, 0, 6, 0]);
	});

	it('the NZ gap: values in it are shifted forward by the gap and counted', () => {
		const walls = series(2024, 9, 29, 1, 50, 10, 8); // 01:50 to 03:00 on a standard-time logger
		const r = resolveWallClocks(walls, NZ);
		expect(r.skipped).toBe(6);
		expect(r.instants[0]).toBe(U(2024, 8, 28, 13, 50));
		// 02:00 .. 02:50 do not exist: read with the offset before the change, i.e. 03:00 .. 03:50 NZDT.
		expect(r.instants.slice(1, 7)).toEqual(series(2024, 9, 29, 2, 0, 10, 6).map((w) => w - 12 * H));
		expect(r.instants[7]).toBe(U(2024, 8, 28, 14, 0));
	});

	it('a fixed offset never repeats or skips', () => {
		const walls = [...series(2024, 4, 7, 2, 0, 10, 6), ...series(2024, 9, 29, 2, 0, 10, 6)];
		const r = resolveWallClocks(walls, '+12:00');
		expect(r.instants).toEqual(walls.map((w) => w - 12 * H));
		expect([r.repeated, r.secondPass, r.skipped]).toEqual([0, 0, 0]);
	});

	it('two repeated hours a year apart are separate runs', () => {
		const a = [...series(2024, 4, 7, 2, 0, 30, 2), ...series(2024, 4, 7, 2, 0, 30, 2)];
		const b = [...series(2025, 4, 6, 2, 0, 30, 2), ...series(2025, 4, 6, 2, 0, 30, 2)];
		for (const walls of [
			[...a, wall(2024, 6, 1, 0), ...b],
			[...a, ...b]
		]) {
			const r = resolveWallClocks(walls, NZ);
			expect(r.secondPass).toBe(4);
			expect(r.repeated).toBe(8);
		}
	});
});

describe('size gates: the per-call memo', () => {
	// The memo is per 15-minute wall bucket, so a long column costs a few lookups per bucket.
	// Same answers whatever the length, either side of a long record.
	// 60,000 quarter-hour buckets (625 days, two of each change) need about 240,000 offset
	// lookups, past the offset cache's 50,000-entry cap, so it is cleared mid-column.
	for (const n of [95, 96, 97, 20_000, 60_000]) {
		it(`${n} values every 15 min from the NZ repeated hour match value-by-value`, () => {
			const start = wall(2024, 4, 6, 0);
			const walls = Array.from({ length: n }, (_, i) => start + i * 15 * MIN);
			const r = resolveWallClocks(walls, NZ);
			walls.forEach((w, i) => expect(r.instants[i]).toBe(wallClockToInstant(w, NZ)));
		});
	}
});
