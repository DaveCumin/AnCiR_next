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
	calculateTimeDifference
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
