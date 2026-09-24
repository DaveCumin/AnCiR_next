import { describe, it, expect, vi } from 'vitest';

// TimeUtils touches `appState.displayTimezone` via displayTime.js.
vi.mock('$lib/core/core.svelte', () => ({ appState: { displayTimezone: 'utc' } }));

import {
	normalizeTimeFormat,
	getUNIXDate,
	getISODate,
	formatTimeFromUNIX,
	formatTimeFromISO,
	guessDateofArray,
	calculateTimeDifference,
	getPeriod,
	getstartTimeOffset,
	addTime,
	forceFormat,
	getGuessedFormat,
	parseTimeStrict,
	hasTimeFormat,
	describeTimeFormatProblem
} from './TimeUtils.js';
import { formatTimeAxisTick } from './displayTime.js';

describe('normalizeTimeFormat — Luxon → dayjs format string conversion', () => {
	it('translates the saved-session timestamp format', () => {
		expect(normalizeTimeFormat("yyyy-LL-dd'T'HH:mm:ss.S'Z'")).toBe('YYYY-MM-DD[T]HH:mm:ss.SSS[Z]');
	});

	it('translates a date-only Luxon format', () => {
		expect(normalizeTimeFormat('yyyy-LL-dd')).toBe('YYYY-MM-DD');
	});

	it('translates a 2-digit-year format', () => {
		expect(normalizeTimeFormat('dd-LLL-yy')).toBe('DD-MMM-YY');
	});

	it('passes through a string already in dayjs syntax unchanged', () => {
		expect(normalizeTimeFormat('YYYY-MM-DD[T]HH:mm:ss.SSS[Z]')).toBe(
			'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]'
		);
	});

	it('returns falsy input unchanged', () => {
		expect(normalizeTimeFormat('')).toBe('');
		expect(normalizeTimeFormat(null)).toBe(null);
		expect(normalizeTimeFormat(undefined)).toBe(undefined);
	});
});

describe('getUNIXDate / getISODate — parses the ISO timestamp the user reported', () => {
	const ISO = '2026-04-30T05:38:03.894Z';
	const LEGACY_FMT = "yyyy-LL-dd'T'HH:mm:ss.S'Z'";
	const expectedMs = Date.UTC(2026, 3, 30, 5, 38, 3, 894); // months are 0-indexed

	it('parses with a legacy Luxon-style format string', () => {
		expect(getUNIXDate(ISO, LEGACY_FMT)).toBe(expectedMs);
	});

	it('parses with a current dayjs-style format string', () => {
		expect(getUNIXDate(ISO, 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]')).toBe(expectedMs);
	});

	it('round-trips ISO via getISODate', () => {
		expect(getISODate(ISO, LEGACY_FMT)).toBe(ISO);
	});
});

describe('formatTimeFromUNIX / formatTimeFromISO — defensive against bad input', () => {
	// Regression: a single null/NaN cell in a UNIX-ms time column used to throw
	// "Cannot read properties of undefined (reading 'split')" because dayjs
	// returned the literal "Invalid Date" string and formatTimeFromISO split it
	// into ["Invalid Date"], leaving timePart undefined.
	it('formatTimeFromUNIX returns "" for null/undefined/NaN', () => {
		expect(formatTimeFromUNIX(null)).toBe('');
		expect(formatTimeFromUNIX(undefined)).toBe('');
		expect(formatTimeFromUNIX(NaN)).toBe('');
	});

	it('formatTimeFromISO returns "" instead of throwing for malformed input', () => {
		expect(formatTimeFromISO('Invalid Date')).toBe('');
		expect(formatTimeFromISO('')).toBe('');
		expect(formatTimeFromISO(null)).toBe('');
		expect(formatTimeFromISO('2026-04-30')).toBe(''); // missing time part
		expect(formatTimeFromISO('2026-04-30T')).toBe(''); // empty time part
	});

	it('formatTimeFromUNIX still formats valid timestamps', () => {
		// 2026-04-30 05:38:03 UTC
		const ms = Date.UTC(2026, 3, 30, 5, 38, 3);
		expect(formatTimeFromUNIX(ms)).toBe('30 Apr 2026 05:38:03');
	});
});

describe('dotted meridiem (a.m./p.m.) parsing', () => {
	it('guesses a usable format and parses to UNIX ms', () => {
		const sample = [
			'20/04/2026 5:27:54 p.m.',
			'20/04/2026 5:48:07 p.m.',
			'21/04/2026 12:12:20 a.m.'
		];
		const guessed = guessDateofArray(sample);
		expect(typeof guessed).toBe('string');

		const ms0 = getUNIXDate(sample[0], guessed);
		const ms1 = getUNIXDate(sample[1], guessed);
		expect(Number.isFinite(ms0)).toBe(true);
		expect(Number.isFinite(ms1)).toBe(true);
		expect(ms1).toBeGreaterThan(ms0);
	});

	it('calculates time differences correctly across midnight with dotted meridiem', () => {
		const fmt = 'DD/MM/YYYY h:mm:s a';
		const h = calculateTimeDifference('20/04/2026 11:52:07 p.m.', '21/04/2026 12:12:20 a.m.', fmt);
		expect(Number(h)).toBeGreaterThan(0);
		expect(Number(h)).toBeCloseTo(0.337, 2); // ~20m13s
	});
});

describe('normalizeTimeFormat — additional token rules', () => {
	it('leaves a lone "s" alone (parsing accepts padded and unpadded seconds)', () => {
		expect(normalizeTimeFormat('HH:mm:s')).toBe('HH:mm:s');
	});

	it('leaves an existing "ss" untouched', () => {
		expect(normalizeTimeFormat('HH:mm:ss')).toBe('HH:mm:ss');
	});

	it('converts single-quoted literals to bracketed literals', () => {
		expect(normalizeTimeFormat("yyyy'T'LL")).toBe('YYYY[T]MM');
	});

	it('translates a lone Luxon day token "d" to "D"', () => {
		expect(normalizeTimeFormat('yyyy-LL-d')).toBe('YYYY-MM-D');
	});

	it('translates standalone month token "L" to "M"', () => {
		expect(normalizeTimeFormat('L/d/yyyy')).toBe('M/D/YYYY');
	});
});

describe('calculateTimeDifference — null/undefined handling', () => {
	const fmt = 'YYYY-MM-DD HH:mm:ss';

	it('returns null when start is null/undefined', () => {
		expect(calculateTimeDifference(null, '2024-01-01 02:00:00', fmt)).toBeNull();
		expect(calculateTimeDifference(undefined, '2024-01-01 02:00:00', fmt)).toBeNull();
	});

	it('returns null when end is null/undefined', () => {
		expect(calculateTimeDifference('2024-01-01 00:00:00', null, fmt)).toBeNull();
		expect(calculateTimeDifference('2024-01-01 00:00:00', undefined, fmt)).toBeNull();
	});

	it('returns a fixed-precision fractional-hour difference', () => {
		expect(calculateTimeDifference('2024-01-01 00:00:00', '2024-01-01 02:30:00', fmt)).toBe(
			'2.5000'
		);
	});

	it('returns a negative difference when end precedes start', () => {
		const h = Number(calculateTimeDifference('2024-01-01 05:00:00', '2024-01-01 02:00:00', fmt));
		expect(h).toBeCloseTo(-3, 4);
	});
});

describe('getPeriod', () => {
	const fmt = 'YYYY-MM-DD HH:mm:ss';

	it('reports a constant 1-hour spacing', () => {
		const times = [
			'2024-01-01 00:00:00',
			'2024-01-01 01:00:00',
			'2024-01-01 02:00:00',
			'2024-01-01 03:00:00'
		];
		const p = getPeriod(times, fmt);
		expect(Number(p.minDiff)).toBeCloseTo(1, 4);
		expect(p.constant).toBe(true);
	});

	it('flags non-constant spacing', () => {
		const times = ['2024-01-01 00:00:00', '2024-01-01 01:00:00', '2024-01-01 03:00:00'];
		const p = getPeriod(times, fmt);
		expect(Number(p.minDiff)).toBeCloseTo(1, 4);
		expect(p.constant).toBe(false);
	});
});

describe('forceFormat / getGuessedFormat', () => {
	const fmt = 'YYYY-MM-DD HH:mm:ss';

	it('forceFormat returns hours-from-first for each row', () => {
		const times = [
			'2024-01-01 00:00:00',
			'2024-01-01 01:00:00',
			'2024-01-01 02:00:00',
			'2024-01-01 03:00:00'
		];
		expect(forceFormat(times, fmt)).toEqual(['0.0000', '1.0000', '2.0000', '3.0000']);
	});

	it('getGuessedFormat returns a usable format string for ISO data', () => {
		const guessed = getGuessedFormat(['2024-08-06T00:00:00', '2024-08-06T01:00:00']);
		expect(typeof guessed).toBe('string');
		expect(getUNIXDate('2024-08-06T01:00:00', guessed)).toBeGreaterThan(
			getUNIXDate('2024-08-06T00:00:00', guessed)
		);
	});
});

describe('addTime', () => {
	it('adds whole hours and rolls over to the next day', () => {
		// 2024-01-01 00:00 UTC + 25h = 2024-01-02 01:00
		expect(addTime('2024-01-01T00:00:00.000Z', 25)).toBe('02 Jan 2024 01:00:00');
	});

	it('subtracts hours for a negative offset', () => {
		expect(addTime('2024-01-02T01:00:00.000Z', -25)).toBe('01 Jan 2024 00:00:00');
	});
});

describe('getstartTimeOffset', () => {
	const fmt = 'YYYY-MM-DD HH:mm:ss';

	it('returns a fixed-precision numeric string', () => {
		const offset = getstartTimeOffset('2024-01-01T00:00:00.000Z', '2024-01-01 06:00:00', fmt);
		// Format is "x.xxxx" (4 decimals); exact sign depends on the runner's
		// local zone since firstTime is parsed as wall-clock, so just check shape.
		expect(offset).toMatch(/^-?\d+\.\d{4}$/);
	});
});

describe('formatTimeAxisTick — multi-resolution axis tick labels', () => {
	it('returns "" for nullish or non-numeric input', () => {
		expect(formatTimeAxisTick(null)).toBe('');
		expect(formatTimeAxisTick(undefined)).toBe('');
		expect(formatTimeAxisTick(NaN)).toBe('');
		expect(formatTimeAxisTick('not a number')).toBe('');
	});

	it('shows fractional seconds when the tick has sub-second precision', () => {
		expect(formatTimeAxisTick(Date.UTC(2026, 3, 30, 14, 30, 45, 123))).toBe('.123');
	});

	it('shows :ss when the tick lands on a non-round minute', () => {
		expect(formatTimeAxisTick(Date.UTC(2026, 3, 30, 14, 30, 45))).toBe(':45');
	});

	it('shows HH:mm for hour and minute ticks within a day', () => {
		expect(formatTimeAxisTick(Date.UTC(2026, 3, 30, 14, 30))).toBe('14:30');
		expect(formatTimeAxisTick(Date.UTC(2026, 3, 30, 14, 0))).toBe('14:00');
	});

	it('shows day + month for midnight ticks that are not the 1st of the month', () => {
		expect(formatTimeAxisTick(Date.UTC(2026, 3, 30))).toBe('30 Apr');
	});

	it('shows month for first-of-month ticks (excluding January)', () => {
		expect(formatTimeAxisTick(Date.UTC(2026, 3, 1))).toBe('Apr');
	});

	it('shows year for January 1st ticks', () => {
		expect(formatTimeAxisTick(Date.UTC(2026, 0, 1))).toBe('2026');
	});
});

// Sessions saved by older versions store formats such as 'YYYY-MM-DD H:mm:s'. A
// single-width numeric token (H h m s D M) means "one or two digits", so it must
// accept a zero-padded value as well as a bare one. dayjs's strict mode rejects
// '09' under 'H' because it round-trips the parse through format() and compares
// strings, which blanked every row from 00:00 to 09:59 in such a session.
describe('single-width tokens accept padded and unpadded values', () => {
	const at = (iso) => Date.parse(iso);

	it('parses zero-padded hours under a legacy "H:mm:s" format', () => {
		const fmt = 'YYYY-MM-DD H:mm:s';
		expect(getUNIXDate('2017-12-20 09:05:00', fmt)).toBe(at('2017-12-20T09:05:00Z'));
		expect(getUNIXDate('2017-12-21 00:00:00', fmt)).toBe(at('2017-12-21T00:00:00Z'));
		expect(getUNIXDate('2017-12-20 15:05:00', fmt)).toBe(at('2017-12-20T15:05:00Z'));
	});

	it('still parses unpadded values under the same format', () => {
		const fmt = 'YYYY-MM-DD H:mm:s';
		expect(getUNIXDate('2017-12-20 9:05:7', fmt)).toBe(at('2017-12-20T09:05:07Z'));
	});

	it.each([
		['H', '07', '7', 'hour', 7],
		['m', '07', '7', 'minute', 7],
		['s', '07', '7', 'second', 7],
		['D', '07', '7', 'date', 7],
		['M', '07', '7', 'month', 6]
	])('token %s accepts "%s" and "%s"', (tok, padded, bare, unit, expected) => {
		const fmt = `YYYY ${tok}`;
		for (const v of [padded, bare]) {
			const ms = getUNIXDate(`2020 ${v}`, fmt);
			expect(Number.isFinite(ms)).toBe(true);
			const d = new Date(ms);
			const got = {
				hour: d.getUTCHours(),
				minute: d.getUTCMinutes(),
				second: d.getUTCSeconds(),
				date: d.getUTCDate(),
				month: d.getUTCMonth()
			}[unit];
			expect(got).toBe(expected);
		}
	});

	it('token h accepts padded and unpadded 12-hour values', () => {
		const fmt = 'YYYY-MM-DD h:mm a';
		expect(getUNIXDate('2020-01-01 07:30 pm', fmt)).toBe(at('2020-01-01T19:30:00Z'));
		expect(getUNIXDate('2020-01-01 7:30 pm', fmt)).toBe(at('2020-01-01T19:30:00Z'));
	});

	it('accepts mixed padding within one value', () => {
		expect(getUNIXDate('2020-3-05 09:5:07', 'YYYY-M-D H:m:s')).toBe(at('2020-03-05T09:05:07Z'));
	});

	it('keeps double-width tokens strict (HH rejects a bare hour)', () => {
		expect(Number.isNaN(getUNIXDate('2020-01-01 9:05:00', 'YYYY-MM-DD HH:mm:ss'))).toBe(true);
	});

	it('still rejects out-of-range values instead of rolling them over', () => {
		expect(Number.isNaN(getUNIXDate('2020-02-30 09:00', 'YYYY-MM-D H:mm'))).toBe(true);
		expect(Number.isNaN(getUNIXDate('13/05/2020', 'D/M/YYYY'))).toBe(false);
		expect(Number.isNaN(getUNIXDate('13/05/2020', 'M/D/YYYY'))).toBe(true);
		expect(Number.isNaN(getUNIXDate('2020-01-01 25:00', 'YYYY-MM-DD H:mm'))).toBe(true);
	});

	it('keeps day/month disambiguation working in the guesser', () => {
		const dates = ['13/05/2020 09:00', '14/05/2020 10:00', '15/05/2020 11:00'];
		const fmt = guessDateofArray(dates);
		for (const d of dates) expect(Number.isFinite(getUNIXDate(d, fmt))).toBe(true);
		expect(new Date(getUNIXDate(dates[0], fmt)).getUTCMonth()).toBe(4);
	});

	it('time differences and offsets work for padded hours under "H"', () => {
		const fmt = 'YYYY-MM-DD H:mm:s';
		expect(calculateTimeDifference('2020-01-01 08:00:00', '2020-01-01 09:30:00', fmt)).toBe(
			'1.5000'
		);
		expect(getISODate('2020-01-01 08:00:00', fmt)).toBe('2020-01-01T08:00:00.000Z');
	});

	it('a guessed format parses every row of padded overnight data', () => {
		const times = [];
		for (let h = 0; h < 24; h++) times.push(`2020-01-01 ${String(h).padStart(2, '0')}:00:00`);
		const fmt = guessDateofArray(times);
		const bad = times.filter((t) => !Number.isFinite(getUNIXDate(t, fmt)));
		expect(bad).toEqual([]);
	});

	it('a format guessed from afternoon-only rows still parses padded morning rows', () => {
		// Column.svelte guesses from the first 10 rows. A recording starting at 15:05
		// yields 'H' (the guesser maps 10-23 to H), which must still read "09:05:00".
		const sample = [];
		for (let i = 0; i < 10; i++) sample.push(`2017-12-20 15:${String(5 * i).padStart(2, '0')}:00`);
		const fmt = guessDateofArray(sample);
		expect(fmt).toContain('H:');
		expect(getUNIXDate('2017-12-21 09:05:00', fmt)).toBe(at('2017-12-21T09:05:00Z'));
	});

	it('a guessed format parses every row of unpadded hours', () => {
		// (The guesser only recognises two-digit minutes and seconds.)
		const times = [];
		for (let h = 0; h < 24; h++) times.push(`2020-01-01 ${h}:30:00`);
		const fmt = guessDateofArray(times);
		const bad = times.filter((t) => !Number.isFinite(getUNIXDate(t, fmt)));
		expect(bad).toEqual([]);
	});
});

// When the guesser recognises nothing it returns [], and Column.timeFormat also
// defaults to []. getUNIXDate(x, []) used to throw a TypeError from inside dayjs,
// which Column.getData swallowed, handing raw strings on as "times".
describe('no time format ([] or empty string)', () => {
	it('hasTimeFormat treats [] and blank strings as no format', () => {
		expect(hasTimeFormat([])).toBe(false);
		expect(hasTimeFormat('')).toBe(false);
		expect(hasTimeFormat('  ')).toBe(false);
		expect(hasTimeFormat(undefined)).toBe(false);
		expect(hasTimeFormat('YYYY')).toBe(true);
		expect(hasTimeFormat(['YYYY', 'YY'])).toBe(true);
	});

	it('getUNIXDate does not throw and passes the value through', () => {
		expect(() => getUNIXDate('2020-01-01 9:30:5', [])).not.toThrow();
		expect(Number(getUNIXDate('2020-01-01 9:30:5', []))).toBeNaN();
		expect(getUNIXDate(1577836800000, [])).toBe(1577836800000);
	});

	it('parseTimeStrict and time differences return invalid rather than throwing', () => {
		expect(parseTimeStrict('2020-01-01', []).isValid()).toBe(false);
		expect(() => calculateTimeDifference('a', 'b', [])).not.toThrow();
	});

	it('parseTimeStrict tries each format of a list, with padding tolerance', () => {
		const fmts = ['DD MMM YYYY', 'YYYY-MM-DD H:mm:s'];
		expect(parseTimeStrict('2020-01-01 09:30:05', fmts).valueOf()).toBe(
			Date.parse('2020-01-01T09:30:05Z')
		);
	});
});

describe('guessing unpadded minutes and seconds end to end', () => {
	it('guesses a format that reads every row of a bare-seconds log', () => {
		const rows = [];
		for (let i = 0; i < 30; i++) {
			const t = 9 * 3600 + 59 * 60 + i * 7;
			rows.push(`2020-01-01 ${Math.floor(t / 3600)}:${Math.floor((t % 3600) / 60)}:${t % 60}`);
		}
		const fmt = guessDateofArray(rows);
		expect(hasTimeFormat(fmt)).toBe(true);
		const ms = rows.map((r) => getUNIXDate(r, fmt));
		expect(ms.every(Number.isFinite)).toBe(true);
		expect(ms[1] - ms[0]).toBe(7000);
		expect(ms[29]).toBe(Date.parse('2020-01-01T10:02:23Z'));
	});
});

describe('describeTimeFormatProblem', () => {
	it('says so when there is no format', () => {
		expect(describeTimeFormatProblem(['9:30:5'], [])).toMatch(/No time format was recognised/);
	});

	it('counts values the format does not read', () => {
		const msg = describeTimeFormatProblem(['2020-01-01 09:00', 'garbage', ''], 'YYYY-MM-DD H:mm');
		expect(msg).toMatch(/^1 of 2 values/);
		expect(msg).toContain('"garbage"');
	});

	it('returns null when every value parses, or there is no text to parse', () => {
		expect(describeTimeFormatProblem(['2020-01-01 09:00'], 'YYYY-MM-DD H:mm')).toBeNull();
		expect(describeTimeFormatProblem([1577836800000], [])).toBeNull();
	});
});
