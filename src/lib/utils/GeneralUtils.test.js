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
});
