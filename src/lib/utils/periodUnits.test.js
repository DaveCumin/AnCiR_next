// Period units and the range a new free-period node starts from (v80.1). See periodUnits.js.
import { describe, it, expect } from 'vitest';
import {
	periodUnitForColumn,
	autoPeriodRange,
	periodInputProps,
	PERIOD_UNIT_X,
	NEW_NODE_TIME_PERIOD_RANGE
} from './periodUnits.js';
import { FREE_PERIOD_DEFAULTS, resolvePeriodRange } from './cosinor.js';

const numberCol = (data) => ({ type: 'number', getData: () => data });

describe('periodUnitForColumn', () => {
	it('hours for a time x or an unknown x, "x units" for any other column', () => {
		expect(periodUnitForColumn({ type: 'time' })).toBe('h');
		expect(periodUnitForColumn(null)).toBe('h');
		expect(periodUnitForColumn(undefined)).toBe('h');
		expect(periodUnitForColumn({ type: 'number' })).toBe(PERIOD_UNIT_X);
		expect(PERIOD_UNIT_X).toBe('x units');
		// A unit-looking name is not a unit: columns carry no unit field, so nothing is guessed.
		expect(periodUnitForColumn({ type: 'number', name: 'Time (days)' })).toBe('x units');
	});
});

describe('autoPeriodRange', () => {
	it('a time x starts at 1 to 30 h; the saved-session fallback stays 1 to 48 h', () => {
		expect(autoPeriodRange({ type: 'time', getData: () => [0, 1, 2] })).toEqual({
			minPeriod: 1,
			maxPeriod: 30
		});
		expect(NEW_NODE_TIME_PERIOD_RANGE).toEqual({ minPeriod: 1, maxPeriod: 30 });
		// Sessions without a stored range compute with this; it must not move with the new default.
		expect(FREE_PERIOD_DEFAULTS).toEqual({ minPeriod: 1, maxPeriod: 48 });
	});

	it("the author's x (0 to 3 days every 30 min): Nyquist to span, not 1 to 48", () => {
		const t = Array.from({ length: 145 }, (_, i) => i / 48);
		const r = autoPeriodRange(numberCol(t));
		expect(r).toEqual({ minPeriod: 0.0417, maxPeriod: 3 });
		// The 1-day rhythm is now well inside the range instead of on its lower limit.
		expect(r.minPeriod).toBeLessThan(1);
		expect(r.maxPeriod).toBeGreaterThan(1);
	});

	it('rounds both bounds UP to 3 significant figures, so the range never cuts into Nyquist', () => {
		const t = Array.from({ length: 50 }, (_, i) => i * 0.123456);
		const full = resolvePeriodRange(t, null, null);
		const r = autoPeriodRange(numberCol(t));
		expect(r.minPeriod).toBeGreaterThanOrEqual(full.nyquist);
		expect(r.minPeriod).toBe(0.247); // 2 x 0.123456 = 0.246912
		expect(r.maxPeriod).toBeGreaterThanOrEqual(full.span);
		expect(r.maxPeriod).toBe(6.05); // 49 x 0.123456 = 6.049344
	});

	it('ignores blanks and text, and gives null when x cannot define a range', () => {
		expect(autoPeriodRange(numberCol([null, '', 'a', 0, 1, 2, 3]))).toEqual({
			minPeriod: 2,
			maxPeriod: 3
		});
		expect(autoPeriodRange(numberCol([5]))).toBeNull();
		expect(autoPeriodRange(numberCol([]))).toBeNull();
		expect(autoPeriodRange(null)).toBeNull();
	});
});

describe('periodInputProps: the range inputs show and keep the stored value', () => {
	it('enough decimals to show the value; whole numbers keep step 1', () => {
		expect(periodInputProps(0.0417)).toEqual({ step: 0.0001, min: 0 });
		expect(periodInputProps(6.05)).toEqual({ step: 0.01, min: 0 });
		expect(periodInputProps(12.4)).toEqual({ step: 0.1, min: 0 });
		expect(periodInputProps(1)).toEqual({ step: 1, min: 0 });
		expect(periodInputProps(48)).toEqual({ step: 1, min: 0 });
		expect(periodInputProps(null)).toEqual({ step: 1, min: 0 });
	});
});
