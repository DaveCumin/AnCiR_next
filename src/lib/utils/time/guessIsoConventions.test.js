// The import guesser writes ISO 8601 formats the conventional way, "YYYY-MM-DD[T]HH:mm:ss[Z]",
// where it used to write "YYYY-MM-DDTH:mm:ss[Z]" (bare T, and H for hours 10 to 23). This file
// pins that the change is cosmetic: every old format and its new form read the same inputs to
// the same instant, carry the same offset answer, and score a column the same. Saved sessions
// keep whatever format they stored. Plan ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md
// section 5f.
import { describe, it, expect } from 'vitest';
import { guessFormat } from './guessTimeFormat.js';
import {
	parseTimeStrict,
	getUNIXDate,
	formatHasOffset,
	valueOffsetMinutes,
	guessDateofArray
} from './TimeUtils.js';
import { formatReadsOffset } from './offsetFormat.js';

// What guessFormat returned for each source before the change (HEAD 64cd80fe, v82.58), and
// what it returns now. Arrays are the multi-candidate results.
const GOLDEN = [
	['2024-04-06T12:00:00Z', 'YYYY-MM-DDTH:mm:ss[Z]', 'YYYY-MM-DD[T]HH:mm:ss[Z]'],
	['2024-04-06T09:00:00Z', 'YYYY-MM-DDTHH:mm:ss[Z]', 'YYYY-MM-DD[T]HH:mm:ss[Z]'],
	['2024-04-06T12:00:00+13:00', 'YYYY-MM-DDTH:mm:ssZ', 'YYYY-MM-DD[T]HH:mm:ssZ'],
	['2024-04-06T12:00:00-0500', 'YYYY-MM-DDTH:mm:ssZZ', 'YYYY-MM-DD[T]HH:mm:ssZZ'],
	['2024-04-06T12:00:00+05', 'YYYY-MM-DDTH:mm:ssZ', 'YYYY-MM-DD[T]HH:mm:ssZ'],
	['2024-04-06T12:00:00.123Z', 'YYYY-MM-DDTH:mm:ss.SSS[Z]', 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]'],
	['2024-04-06T12:00:00.123456Z', 'YYYY-MM-DDTH:mm:ss.SSS[Z]', 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]'],
	['2024-04-06T12:00:00,5Z', 'YYYY-MM-DDTH:mm:ss,S[Z]', 'YYYY-MM-DD[T]HH:mm:ss,S[Z]'],
	['2024-04-06T12:00Z', 'YYYY-MM-DDTH:mm[Z]', 'YYYY-MM-DD[T]HH:mm[Z]'],
	['2024-04-06T12:00', 'YYYY-MM-DDTH:mm', 'YYYY-MM-DD[T]HH:mm'],
	['2024-04-06T12', 'YYYY-MM-DDTH', 'YYYY-MM-DD[T]HH'],
	['2024-04-06T12Z', 'YYYY-MM-DDTH[Z]', 'YYYY-MM-DD[T]HH[Z]'],
	[
		'2024-04-06 12:00:00',
		['YYYY-MM-DD H:mm:ss', 'YYYY-MM-DD H:mm:ss'],
		['YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD H:mm:ss']
	],
	[
		'2024-04-06 09:30:00',
		['YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD HH:mm:ss'],
		['YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD HH:mm:ss']
	],
	['2024-04-06T12:00:00', 'YYYY-MM-DDTH:mm:ss', 'YYYY-MM-DD[T]HH:mm:ss'],
	['2024-04-06T00:00:00', 'YYYY-MM-DDTHH:mm:ss', 'YYYY-MM-DD[T]HH:mm:ss'],
	['20240406T120000Z', 'YYYYMMDDTHmmss[Z]', 'YYYYMMDD[T]HHmmss[Z]'],
	['20240406T1200', 'YYYYMMDDTHmm', 'YYYYMMDD[T]HHmm'],
	['2024-W14-6T12:00:00', 'YYYY-[W]WW-ETH:mm:ss', 'YYYY-[W]WW-E[T]HH:mm:ss'],
	['2024-097T12:00:00Z', 'YYYY-DDDDTH:mm:ss[Z]', 'YYYY-DDDD[T]HH:mm:ss[Z]'],
	['2024-04-06T23:59:59.999+05:30', 'YYYY-MM-DDTH:mm:ss.SSSZ', 'YYYY-MM-DD[T]HH:mm:ss.SSSZ'],
	['2024-04-06 12:00:00Z', 'YYYY-MM-DD H:mm:ss[Z]', 'YYYY-MM-DD HH:mm:ss[Z]'],
	// Date-only and non-ISO shapes are untouched.
	['2024-04-06', ['YYYY-MM-DD', 'YYYY-MM-DD'], ['YYYY-MM-DD', 'YYYY-MM-DD']],
	['20240406', 'YYYYMMDD', 'YYYYMMDD'],
	['2020-01-01 9:30:5', null, null],
	['31/12/2020 14:05', null, null],
	['8/6/2024, 12:00:00 AM', null, null]
];

const asList = (f) => (Array.isArray(f) ? f : [f]);
const hh = (h) => String(h).padStart(2, '0');

// Every value the formats are tried on: the golden sources, each hour of a day in every ISO
// shape the guesser recognises (the hour is where H and HH differ), NZ and US daylight-saving
// days, out-of-range values that must stay invalid, and the TimeUtils/import test cases.
const POOL = (() => {
	const v = new Set(GOLDEN.map((g) => g[0]));
	for (let h = 0; h < 24; h++) {
		for (const day of ['2024-04-06', '2024-04-07', '2024-09-29', '2024-03-10', '2024-02-29']) {
			v.add(`${day}T${hh(h)}:30:00Z`);
			v.add(`${day}T${hh(h)}:30:00+13:00`);
			v.add(`${day}T${hh(h)}:30:00-0500`);
			v.add(`${day}T${hh(h)}:30:00+05`);
			v.add(`${day}T${hh(h)}:30:00.250Z`);
			v.add(`${day}T${hh(h)}:30:00.250+05:30`);
			v.add(`${day}T${hh(h)}:30Z`);
			v.add(`${day}T${hh(h)}:30`);
			v.add(`${day}T${hh(h)}:30:15`);
			v.add(`${day}T${hh(h)}`);
			v.add(`${day}T${hh(h)}Z`);
			v.add(`${day} ${hh(h)}:30:15`);
			v.add(`${day} ${hh(h)}:30:15Z`);
			v.add(`${day.replace(/-/g, '')}T${hh(h)}3015Z`);
			v.add(`${day.replace(/-/g, '')}T${hh(h)}30`);
		}
	}
	for (const bad of [
		'2024-04-06T24:00:00Z',
		'2024-04-06T12:60:00Z',
		'2024-02-30T12:00:00Z',
		'2024-13-01T12:00:00',
		'2024-04-06t12:00:00Z',
		'2024-04-06T12:00:00',
		'2024-04-06T12:00:00+1300',
		'2024-04-06T12:00:00.12Z',
		'garbage',
		'',
		'2026-04-30T05:38:03.894Z',
		'2024-08-06T00:00:00',
		'2024-01-01 00:00:00',
		'2017-12-20 09:05:00',
		'2017-12-20 15:05:00',
		'2020-01-01 08:00:00',
		'2026-03-01T08:00:00+05:30',
		'2026-03-01T08:00:00-04:00',
		'2024-09-29T02:30:00+12:00'
	]) {
		v.add(bad);
	}
	return [...v];
})();

// The value with a two-digit ISO hour; the guesser's ISO parsers require one.
const TWO_DIGIT_HOUR = /^\d{4}-?(\d{2}-?\d{2}|\d{3}|W\d{2}-?\d)[T ]\d{2}(?!\d:)/;

function reading(value, fmt) {
	const dt = parseTimeStrict(value, fmt);
	return dt.isValid() ? dt.valueOf() : 'invalid';
}

describe('guessFormat writes ISO 8601 as YYYY-MM-DD[T]HH (plan 5f)', () => {
	it('emits the conventional format for every ISO shape', () => {
		for (const [src, , now] of GOLDEN) {
			if (now === null) continue;
			expect(guessFormat(src), src).toEqual(now);
		}
	});

	it('leaves non-ISO shapes exactly as before', () => {
		expect(guessFormat('2020-01-01 9:30:5')).toBe('YYYY-MM-DD H:mm:s');
		expect(guessFormat('31/12/2020 14:05')).toBe('DD/MM/YYYY H:mm');
		expect(guessFormat('8/6/2024, 12:00:00 AM')).toEqual(
			expect.arrayContaining(['D/M/YYYY, h:mm:ss A', 'M/D/YYYY, h:mm:ss A'])
		);
	});

	describe('each old format and its new form read the pool identically', () => {
		for (const [src, before, now] of GOLDEN) {
			if (before === null) continue;
			const pairs = asList(before).map((b, i) => [b, asList(now)[i]]);
			for (const [oldFmt, newFmt] of pairs) {
				it(`${src}: ${oldFmt} -> ${newFmt}`, () => {
					let readable = 0;
					for (const value of POOL) {
						const a = reading(value, oldFmt);
						const b = reading(value, newFmt);
						expect(b, `${value} under ${newFmt}`).toBe(a);
						expect(getUNIXDate(value, newFmt), value).toEqual(getUNIXDate(value, oldFmt));
						expect(valueOffsetMinutes(value, newFmt), value).toBe(
							valueOffsetMinutes(value, oldFmt)
						);
						if (a !== 'invalid') readable++;
					}
					// The pool exercises the format, not just its rejections. A few old guesses do
					// not read their own source (dayjs has no parse token for a one-digit fraction
					// "S", ISO week "WW-E" or day of year "DDDD"; "+05" and six fraction digits do
					// not round-trip strictly); the new form reads exactly as little.
					if (reading(src, oldFmt) !== 'invalid') expect(readable).toBeGreaterThan(0);
					expect(formatHasOffset(newFmt)).toBe(formatHasOffset(oldFmt));
					expect(formatReadsOffset(newFmt)).toBe(formatReadsOffset(oldFmt));
				});
			}
		}
	});

	it('the only values the old formats read and the new ones do not are unpadded ISO hours', () => {
		// "T9:30" is not ISO 8601 (the guesser never suggests a format from it). An old guess
		// with H read it; the same guess from an hour 00 to 09 was already HH and did not. The
		// new HH never does; a column that has such rows still gets an H candidate from the
		// delimited parsers (next test).
		const oldFmt = 'YYYY-MM-DDTH:mm:ss[Z]';
		const newFmt = 'YYYY-MM-DD[T]HH:mm:ss[Z]';
		const unpadded = '2024-04-06T9:30:00Z';
		expect(reading(unpadded, oldFmt)).toBe(Date.parse('2024-04-06T09:30:00Z'));
		expect(reading(unpadded, newFmt)).toBe('invalid');
		expect(reading(unpadded, 'YYYY-MM-DDTHH:mm:ss[Z]')).toBe('invalid');
		for (const value of POOL.filter((v) => TWO_DIGIT_HOUR.test(v))) {
			expect(reading(value, newFmt), value).toBe(reading(value, oldFmt));
		}
	});

	it('scores a column to the conventional format, reading every row as before', () => {
		const iso = Array.from({ length: 24 }, (_, h) => `2024-04-06T${hh(h)}:00:00Z`);
		const fmt = guessDateofArray(iso);
		expect(fmt).toBe('YYYY-MM-DD[T]HH:mm:ss[Z]');
		expect(iso.map((v) => getUNIXDate(v, fmt))).toEqual(iso.map((v) => Date.parse(v)));

		// Space-separated with an unpadded hour: the H candidate still wins on score.
		const mixed = ['2024-04-06 12:00:00', '2024-04-06 9:30:00', '2024-04-06 13:00:00'];
		const mixedFmt = guessDateofArray(mixed);
		expect(mixed.map((v) => reading(v, mixedFmt))).not.toContain('invalid');
	});
});
