import { describe, it, expect } from 'vitest';
import { darkenColour } from './colourShade.js';

describe('darkenColour', () => {
	it('darkens a 6-digit hex by the given fraction', () => {
		// 0x80 = 128; ×0.5 = 64 = 0x40
		expect(darkenColour('#808080', 0.5)).toBe('#404040');
	});

	it('defaults to a 35% darken', () => {
		expect(darkenColour('#ffffff')).toBe('#a6a6a6'); // 255 × 0.65 = 165.75 → 166
	});

	it('expands 3-digit hex', () => {
		expect(darkenColour('#fff', 1)).toBe('#000000');
		expect(darkenColour('#abc', 0)).toBe('#aabbcc');
	});

	it('clamps amount to [0, 1]', () => {
		expect(darkenColour('#123456', 2)).toBe('#000000');
		expect(darkenColour('#123456', -1)).toBe('#123456');
	});

	it('amount 0 is a no-op (normalised to 6 digits)', () => {
		expect(darkenColour('#1f77b4', 0)).toBe('#1f77b4');
	});

	it('passes through anything unparseable unchanged', () => {
		expect(darkenColour('pink', 0.5)).toBe('pink');
		expect(darkenColour('rgb(1,2,3)', 0.5)).toBe('rgb(1,2,3)');
		expect(darkenColour(null, 0.5)).toBe(null);
		expect(darkenColour(undefined, 0.5)).toBe(undefined);
	});

	it('is case-insensitive on input', () => {
		expect(darkenColour('#FFFFFF', 0.5)).toBe('#808080');
	});
});
