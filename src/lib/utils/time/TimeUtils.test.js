import { describe, it, expect, vi } from 'vitest';

// TimeUtils touches `appState.displayTimezone` via displayTime.js.
vi.mock('$lib/core/core.svelte', () => ({ appState: { displayTimezone: 'utc' } }));

import { normalizeTimeFormat, getUNIXDate, getISODate } from './TimeUtils.js';

describe('normalizeTimeFormat — Luxon → dayjs format string conversion', () => {
	it('translates the saved-session timestamp format', () => {
		expect(normalizeTimeFormat("yyyy-LL-dd'T'HH:mm:ss.S'Z'")).toBe(
			'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]'
		);
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
