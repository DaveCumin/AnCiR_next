import { describe, it, expect, vi } from 'vitest';

// displayTime reads appState.displayTimezone; pin it to UTC for determinism.
vi.mock('$lib/core/core.svelte', () => ({ appState: { displayTimezone: 'utc' } }));

import {
	getDisplayZone,
	formatDateTime,
	formatDateTimeLocalInput,
	parseDateTimeLocalInput
} from './displayTime.js';

describe('getDisplayZone', () => {
	it('returns the configured display timezone (utc in tests)', () => {
		expect(getDisplayZone()).toBe('utc');
	});
});

describe('formatDateTime', () => {
	it('formats a millisecond timestamp with the default format', () => {
		const ms = Date.UTC(2026, 3, 30, 5, 38);
		expect(formatDateTime(ms)).toBe('30 Apr 2026, 05:38');
	});

	it('accepts a custom moment-style format string', () => {
		const ms = Date.UTC(2026, 0, 2, 9, 7, 5);
		expect(formatDateTime(ms, 'YYYY-MM-DD HH:mm:ss')).toBe('2026-01-02 09:07:05');
	});

	it('returns "" for null / undefined / NaN', () => {
		expect(formatDateTime(null)).toBe('');
		expect(formatDateTime(undefined)).toBe('');
		expect(formatDateTime(NaN)).toBe('');
	});

	it('coerces a numeric string timestamp', () => {
		const ms = Date.UTC(2026, 3, 30, 5, 38);
		expect(formatDateTime(String(ms))).toBe('30 Apr 2026, 05:38');
	});
});

describe('formatDateTimeLocalInput', () => {
	it('emits a value parseable by <input type="datetime-local">', () => {
		const ms = Date.UTC(2026, 3, 30, 5, 38, 3);
		expect(formatDateTimeLocalInput(ms)).toBe('2026-04-30T05:38:03');
	});
});

describe('parseDateTimeLocalInput', () => {
	it('parses a datetime-local string back to the original ms (UTC zone)', () => {
		const ms = Date.UTC(2026, 3, 30, 5, 38, 3);
		const str = formatDateTimeLocalInput(ms);
		expect(parseDateTimeLocalInput(str)).toBe(ms);
	});

	it('parses a value with no seconds', () => {
		const ms = Date.UTC(2026, 3, 30, 5, 38);
		expect(parseDateTimeLocalInput('2026-04-30T05:38')).toBe(ms);
	});

	it('returns NaN for an empty string', () => {
		expect(parseDateTimeLocalInput('')).toBeNaN();
	});

	it('returns NaN for an unparseable string', () => {
		expect(parseDateTimeLocalInput('not a date')).toBeNaN();
	});

	it('round-trips an arbitrary instant through format then parse', () => {
		for (const ms of [
			Date.UTC(2000, 0, 1, 0, 0, 0),
			Date.UTC(2024, 1, 29, 23, 59, 59), // leap day
			Date.UTC(2026, 11, 31, 12, 0, 0)
		]) {
			expect(parseDateTimeLocalInput(formatDateTimeLocalInput(ms))).toBe(ms);
		}
	});
});
