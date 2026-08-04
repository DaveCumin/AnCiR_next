// The x-axis date-tick override, and the reason its default is EMPTY.
//
// `formatTimeAxisTick` picks a format per tick from what that tick is: HH:mm inside a day,
// D MMM across days, MMM across months, YYYY across years. A fixed format is what a figure
// spanning weeks wants and the wrong thing for one spanning hours, where every tick would
// read the same date. So the field overrides rather than defaults, and these tests pin both
// halves of that behaviour.
import { describe, it, expect, beforeEach } from 'vitest';
import { appState } from '$lib/core/core.svelte.js';
import { scaleUtc } from 'd3-scale';
import {
	formatTimeAxisTick,
	formatDateTime,
	autoTickPattern,
	dominantTickPattern,
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

// The box shows the format the ticks are ACTUALLY using, rather than the word "Automatic".
// A blank box gives a user nothing to start from; "D MMM" does.
describe('the format shown in the box', () => {
	it('names the pattern behind a given tick', () => {
		expect(autoTickPattern(NOON)).toBe('HH:mm');
		expect(autoTickPattern(MIDNIGHT)).toBe('D MMM');
		expect(autoTickPattern(Date.UTC(2024, 7, 1))).toBe('MMM');
		expect(autoTickPattern(Date.UTC(2024, 0, 1))).toBe('YYYY');
		expect(autoTickPattern(Date.UTC(2024, 7, 5, 12, 0, 30))).toBe('[:]ss');
	});

	it('agrees with what the formatter actually draws', () => {
		// The two ran off separate copies of the cascade before; now the formatter is
		// defined in terms of the pattern, so they cannot disagree.
		for (const ms of [NOON, MIDNIGHT, Date.UTC(2024, 7, 1), Date.UTC(2024, 0, 1)]) {
			expect(formatDateTime(ms, autoTickPattern(ms))).toBe(formatTimeAxisTick(ms));
		}
	});

	it('picks the pattern most of an axis uses', () => {
		// A day-scale axis: mostly "D MMM", with one month boundary reading "MMM".
		const ticks = [2, 3, 4, 5].map((d) => Date.UTC(2024, 7, d));
		expect(dominantTickPattern([...ticks, Date.UTC(2024, 7, 1)])).toBe('D MMM');
	});

	it('accepts Date objects, which is what d3 scales hand back', () => {
		expect(dominantTickPattern([new Date(MIDNIGHT), new Date(MIDNIGHT)])).toBe('D MMM');
	});

	it('is null for no ticks, so the caller can fall back to the suggestion', () => {
		expect(dominantTickPattern([])).toBeNull();
		expect(dominantTickPattern(null)).toBeNull();
		expect(dominantTickPattern([NaN, null])).toBeNull();
	});
});

// The bug the screenshot caught: the box read "HH:mm" while the axis drew "5 Aug, 6 Aug…".
//
// The axis renders `.ticks(axisData.nticks)` (default 5). The placeholder asked the scale
// for `.ticks()` with NO count, so d3 returned its default of about 10 — which over a
// four-day span lands on 12-hourly steps, half of them at noon, and 'HH:mm' won the vote.
// Same scale, same code path, different tick set. The count has to match the axis.
describe('the pattern must be read from the ticks the axis actually draws', () => {
	// The exact limits from the report: 04 Aug 08:26 → 08 Aug 01:26, not whole days.
	const domain = [Date.UTC(2026, 7, 4, 8, 26), Date.UTC(2026, 7, 8, 1, 26)];
	const scale = () => scaleUtc().domain(domain).range([0, 400]);

	it('reads D MMM from the 5 ticks the axis asks for', () => {
		// scale.ticks(5) lands on the four midnights, which is what the axis drew.
		expect(dominantTickPattern(scale().ticks(5))).toBe('D MMM');
	});

	it("still reads D MMM from d3's default count, which used to tie and lose", () => {
		// scale.ticks() returns eight ticks alternating midnight/noon: four 'D MMM' against
		// four 'HH:mm'. The tie is now broken toward the coarser pattern, so a caller that
		// asks for the wrong count no longer contradicts the axis.
		expect(dominantTickPattern(scale().ticks())).toBe('D MMM');
	});

	it('every drawn tick agrees with the pattern shown, at the axis count', () => {
		const ticks = scale().ticks(5);
		const shown = dominantTickPattern(ticks);
		for (const t of ticks) expect(autoTickPattern(t)).toBe(shown);
	});

	it('breaks an exact tie toward the coarser pattern', () => {
		const noon = Date.UTC(2026, 7, 5, 12, 0);
		const midnight = Date.UTC(2026, 7, 6, 0, 0);
		// Both orders must agree, or the answer depends on which tick came first.
		expect(dominantTickPattern([noon, midnight])).toBe('D MMM');
		expect(dominantTickPattern([midnight, noon])).toBe('D MMM');
	});

	it('still lets a genuine majority win over coarseness', () => {
		const noons = [10, 11, 12].map((h) => Date.UTC(2026, 7, 5, h, 0));
		expect(dominantTickPattern([...noons, Date.UTC(2026, 7, 6)])).toBe('HH:mm');
	});
});
