// The x-axis date-tick override, and the reason its default is EMPTY.
//
// `formatTimeAxisTick` picks a format per tick from what that tick is: HH:mm inside a day,
// D MMM across days, MMM across months, YYYY across years. A fixed format is what a figure
// spanning weeks wants and the wrong thing for one spanning hours, where every tick would
// read the same date. So the field overrides rather than defaults, and these tests pin both
// halves of that behaviour.
import { describe, it, expect, beforeEach } from 'vitest';
import { appState } from '$lib/core/core.svelte.js';
import {
	formatTimeAxisTick,
	formatDateTime,
	DEFAULT_DATE_FORMAT
} from '$lib/utils/time/displayTime.js';

/** Mirrors the component's `xTick`; the branch is the thing under test. */
function xTick(ms, xTickFormat) {
	return xTickFormat && xTickFormat.trim()
		? formatDateTime(ms, xTickFormat)
		: formatTimeAxisTick(ms);
}

const NOON = Date.UTC(2024, 7, 5, 12, 0);
const MIDNIGHT = Date.UTC(2024, 7, 5, 0, 0);

beforeEach(() => {
	appState.displayTimezone = 'utc';
});

describe('the automatic cascade (empty override)', () => {
	it('shows the time of day for an intraday tick', () => {
		// The case a hard 'DD MMM' default would ruin: every tick would read "05 Aug".
		expect(xTick(NOON, '')).toBe('12:00');
	});

	it('shows the date for a midnight tick', () => {
		expect(xTick(MIDNIGHT, '')).toBe('5 Aug');
	});

	it('treats undefined, null and whitespace as automatic', () => {
		expect(xTick(NOON, undefined)).toBe('12:00');
		expect(xTick(NOON, null)).toBe('12:00');
		expect(xTick(NOON, '   ')).toBe('12:00');
	});
});

describe('the override', () => {
	it('applies the default suggestion when the user enters it', () => {
		expect(xTick(NOON, DEFAULT_DATE_FORMAT)).toBe('05 Aug');
	});

	it('forces the SAME format on every tick, including intraday ones', () => {
		// Deliberate: this is what "override" means, and why it is not the default.
		expect(xTick(NOON, 'DD MMM')).toBe(xTick(MIDNIGHT, 'DD MMM'));
	});

	it('accepts any dayjs pattern', () => {
		expect(xTick(NOON, 'YYYY-MM-DD')).toBe('2024-08-05');
		expect(xTick(NOON, 'ddd HH:mm')).toBe('Mon 12:00');
		expect(xTick(NOON, '[day] D')).toBe('day 5');
	});

	it('follows the display timezone, like every other label in the app', () => {
		appState.displayTimezone = 'America/New_York';
		// 12:00Z on 5 Aug is 08:00 EDT the same day; midnight Z is 20:00 on the 4th.
		expect(xTick(NOON, 'DD MMM HH:mm')).toBe('05 Aug 08:00');
		expect(xTick(MIDNIGHT, 'DD MMM')).toBe('04 Aug');
	});

	it('returns empty for a non-finite tick rather than "Invalid Date"', () => {
		expect(xTick(NaN, 'DD MMM')).toBe('');
		expect(xTick(null, 'DD MMM')).toBe('');
	});
});
