import { describe, it, expect } from 'vitest';
import { guessFormat } from './guessTimeFormat.js';

// guessFormat(dateString) returns a format string (or array of strings)

function getFormat(dateStr) {
	const result = guessFormat(dateStr);
	// If multiple matches, take the first
	return Array.isArray(result) ? result[0] : result;
}

describe('guessFormat', () => {
	it('returns a string for valid input', () => {
		const result = guessFormat('8/6/2024, 12:00:00 AM');
		const fmt = Array.isArray(result) ? result[0] : result;
		expect(typeof fmt).toBe('string');
		expect(fmt.length).toBeGreaterThan(0);
	});

	describe('testData.csv format — "8/6/2024, 12:00:00 AM"', () => {
		it('parses the format without throwing', () => {
			expect(() => guessFormat('8/6/2024, 12:00:00 AM')).not.toThrow();
		});

		it('detects 12-hour time indicator (AM/PM)', () => {
			const fmt = getFormat('8/6/2024, 12:00:00 AM');
			expect(fmt).toMatch(/[aApP]/); // AM/PM token present
		});
	});

	describe('ISO 8601 — "2024-08-06T00:00:00"', () => {
		it('parses without throwing', () => {
			expect(() => guessFormat('2024-08-06T00:00:00')).not.toThrow();
		});

		it('returns a non-empty format string', () => {
			const fmt = getFormat('2024-08-06T00:00:00');
			expect(fmt).toBeTruthy();
		});
	});

	describe('Excel-style — "06/08/2024 00:00"', () => {
		it('parses without throwing', () => {
			expect(() => guessFormat('06/08/2024 00:00')).not.toThrow();
		});

		it('returns a non-empty format string', () => {
			const fmt = getFormat('06/08/2024 00:00');
			expect(fmt).toBeTruthy();
		});
	});

	describe('edge cases', () => {
		it('handles DST transition date (2024-03-31 02:00:00)', () => {
			expect(() => guessFormat('2024-03-31 02:00:00')).not.toThrow();
		});

		it('handles leap year date (2024-02-29)', () => {
			expect(() => guessFormat('2024-02-29 12:00:00')).not.toThrow();
		});

		it('handles ambiguous slash format "01/02/03"', () => {
			// Should return at least one candidate without throwing
			expect(() => guessFormat('01/02/03')).not.toThrow();
			const result = guessFormat('01/02/03');
			const fmt = Array.isArray(result) ? result[0] : result;
			expect(fmt).toBeTruthy();
		});

		it('handles date with day name — "Tuesday, 6 August 2024"', () => {
			expect(() => guessFormat('Tuesday, 6 August 2024')).not.toThrow();
		});

		it('handles 24-hour time — "2024-08-06 14:30:00"', () => {
			expect(() => guessFormat('2024-08-06 14:30:00')).not.toThrow();
			const fmt = getFormat('2024-08-06 14:30:00');
			expect(fmt).toBeTruthy();
		});
	});
});
