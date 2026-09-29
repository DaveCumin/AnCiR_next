// The day-selection rule (Decision 1a), pure. These cases are the ones the Python and R
// ports must reproduce (Phase B parity fixtures).
import { describe, it, expect } from 'vitest';
import { isDaySelected, selectionMask, fitDayRange, isOutsideFitRange } from './markerSelection.js';

describe('markerSelection', () => {
	it('a missing tick counts as ticked', () => {
		expect(selectionMask(4, [true, false])).toEqual([true, false, true, true]);
		expect(selectionMask(3, null)).toEqual([true, true, true]);
	});

	it('the range is ignored unless it scopes the fit (an own block, today)', () => {
		expect(selectionMask(5, [], { lineMinDay: 2, lineMaxDay: 3 })).toEqual([
			true,
			true,
			true,
			true,
			true
		]);
	});

	it('range AND ticks when the range scopes the fit (a rule instance)', () => {
		const opts = { rangeScopesFit: true, lineMinDay: 2, lineMaxDay: 4 };
		expect(selectionMask(6, [true, true, false, true, true, true], opts)).toEqual([
			false,
			true,
			false,
			true,
			false,
			false
		]);
		expect(isDaySelected(0, [true], opts)).toBe(false);
		expect(isOutsideFitRange(0, opts)).toBe(true);
		expect(isOutsideFitRange(2, opts)).toBe(false);
	});

	it('an open side of the range is unbounded; a min below 1 is clamped', () => {
		expect(fitDayRange({ lineMinDay: null, lineMaxDay: null })).toEqual({ lo: 1, hi: Infinity });
		expect(fitDayRange({ lineMinDay: -3, lineMaxDay: 2 })).toEqual({ lo: 1, hi: 2 });
		expect(selectionMask(4, [], { rangeScopesFit: true, lineMinDay: 3 })).toEqual([
			false,
			false,
			true,
			true
		]);
	});
});
