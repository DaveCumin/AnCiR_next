import { describe, it, expect } from 'vitest';
import { numToString } from './GeneralUtils.js';

describe('numToString', () => {
	it('converts 0 → "A"', () => expect(numToString(0)).toBe('A'));
	it('converts 25 → "Z"', () => expect(numToString(25)).toBe('Z'));
	it('converts 26 → "AA"', () => expect(numToString(26)).toBe('AA'));
	it('converts 27 → "AB"', () => expect(numToString(27)).toBe('AB'));
	it('converts 51 → "AZ"', () => expect(numToString(51)).toBe('AZ'));
	it('converts 52 → "BA"', () => expect(numToString(52)).toBe('BA'));
	it('returns undefined for negative input', () => expect(numToString(-1)).toBeUndefined());
	it('produces distinct values for 0..100', () => {
		const values = Array.from({ length: 101 }, (_, i) => numToString(i));
		const unique = new Set(values);
		expect(unique.size).toBe(101);
	});

	// Spreadsheet-column boundaries (the classic off-by-one cases).
	it('converts 701 → "ZZ" (last two-letter column)', () => {
		expect(numToString(701)).toBe('ZZ');
	});

	it('converts 702 → "AAA" (first three-letter column)', () => {
		expect(numToString(702)).toBe('AAA');
	});

	it('returns undefined for negative input', () => {
		expect(numToString(-5)).toBeUndefined();
	});

	it('produces strictly increasing, distinct values across the 2→3 letter boundary', () => {
		const values = Array.from({ length: 1000 }, (_, i) => numToString(i));
		// All distinct.
		expect(new Set(values).size).toBe(1000);
		// Length is non-decreasing as n grows (A.. , AA.. , AAA..).
		for (let i = 1; i < values.length; i++) {
			expect(values[i].length).toBeGreaterThanOrEqual(values[i - 1].length);
		}
	});

	it('uses only uppercase A–Z characters', () => {
		for (let i = 0; i < 200; i++) {
			expect(numToString(i)).toMatch(/^[A-Z]+$/);
		}
	});
});
