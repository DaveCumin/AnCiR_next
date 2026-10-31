// @ts-nocheck
// The chi-squared periodogram's short-record warning (decision 2026-11-01). The threshold and
// its numbers are in chiSquaredShortRecord.js; the size simulation in
// periodogram.shortRecordSize.test.js.
import { describe, it, expect } from 'vitest';
import {
	chiSquaredShortRecordWarning,
	recordLength,
	CHI_SQUARED_MIN_CYCLES
} from './chiSquaredShortRecord.js';

const hourly = (days) => Array.from({ length: 24 * days }, (_, i) => i);

describe('chi-squared short-record warning', () => {
	it('the record is the span plus one sampling interval (72 hourly samples are 3 days)', () => {
		expect(recordLength(hourly(3))).toBe(72);
		expect(recordLength([0, null, 0.5, 1, 'x', 1.5])).toBe(2);
		expect(recordLength([5])).toBeNaN();
	});

	it('3 days tested to 30 h: plain words, the numbers, and what to do', () => {
		expect(CHI_SQUARED_MIN_CYCLES).toBe(7);
		expect(chiSquaredShortRecordWarning({ length: 72, periodMax: 30 })).toBe(
			'With only 3 days of data (2.4 cycles of the longest period tested, 30 h), the chi-squared ' +
				'test is very conservative and can miss a rhythm that is there; consider Lomb-Scargle or ' +
				'a longer record (at least 7 cycles).'
		);
	});

	it('warns below 7 cycles of the longest period tested, not at or above', () => {
		expect(chiSquaredShortRecordWarning({ length: 7 * 28 - 1, periodMax: 28 })).not.toBe('');
		expect(chiSquaredShortRecordWarning({ length: 7 * 28, periodMax: 28 })).toBe('');
		expect(chiSquaredShortRecordWarning({ length: 14 * 24, periodMax: 30 })).toBe('');
		expect(chiSquaredShortRecordWarning({ length: NaN, periodMax: 30 })).toBe('');
		expect(chiSquaredShortRecordWarning({ length: 72, periodMax: 0 })).toBe('');
	});

	it('a number x names cycles only; a moving window speaks of the window; one day is singular', () => {
		expect(chiSquaredShortRecordWarning({ length: 50, periodMax: 10, hours: false })).toBe(
			'With only 5 cycles of the longest period tested, 10, the chi-squared test is very ' +
				'conservative and can miss a rhythm that is there; consider Lomb-Scargle or a longer ' +
				'record (at least 7 cycles).'
		);
		expect(chiSquaredShortRecordWarning({ length: 72, periodMax: 28, perWindow: true })).toBe(
			'With each window holding only 3 days of data (2.6 cycles of the longest period tested, ' +
				'28 h), the chi-squared test is very conservative and can miss a rhythm that is there; ' +
				'consider Lomb-Scargle or a longer window (at least 7 cycles).'
		);
		expect(chiSquaredShortRecordWarning({ length: 24, periodMax: 24 })).toMatch(
			/^With only 1 day of data \(1 cycle of/
		);
	});
});
