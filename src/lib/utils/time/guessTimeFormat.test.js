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

	describe('non-date input', () => {
		it('returns an empty array for an empty string', () => {
			expect(guessFormat('')).toEqual([]);
		});

		it('returns an empty array for plain non-date text', () => {
			expect(guessFormat('hello world')).toEqual([]);
		});
	});

	describe('day-vs-month disambiguation', () => {
		it('reads "31/12/2020" as DD/MM/YYYY (31 cannot be a month)', () => {
			expect(getFormat('31/12/2020')).toBe('DD/MM/YYYY');
		});

		it('reads "12/31/2020" as MM/DD/YYYY (31 cannot be a month)', () => {
			expect(getFormat('12/31/2020')).toBe('MM/DD/YYYY');
		});

		it('offers both interpretations for the ambiguous "8/6/2024, ..."', () => {
			const result = guessFormat('8/6/2024, 12:00:00 AM');
			const arr = Array.isArray(result) ? result : [result];
			expect(arr).toContain('D/M/YYYY, h:mm:ss A');
			expect(arr).toContain('M/D/YYYY, h:mm:ss A');
		});
	});

	describe('produced format strings actually parse their source', () => {
		// A guessed format should parse the very string it was guessed from.
		const cases = ['2024-08-06T00:00:00', '2024-08-06 14:30:00', '31/12/2020', '06/08/2024 00:00'];
		for (const src of cases) {
			it(`round-trips "${src}"`, async () => {
				const { default: dayjs } = await import('./dayjsSetup.js');
				const fmt = getFormat(src);
				expect(dayjs(src, fmt, true).isValid()).toBe(true);
			});
		}
	});

	// Loggers often write bare minutes and seconds ("9:30:5"). The guesser used to
	// require two digits, returned no candidates, and the column imported as text.
	describe('unpadded minutes and seconds', () => {
		const as = (r) => (Array.isArray(r) ? r : [r]);
		it('emits "s" for a one-digit second', () => {
			expect(as(guessFormat('2020-01-01 9:30:5'))).toContain('YYYY-MM-DD H:mm:s');
		});
		it('emits "m" for a one-digit minute', () => {
			expect(as(guessFormat('2020-01-01 10:0:35'))).toContain('YYYY-MM-DD H:m:ss');
		});
		it('handles a bare time of day', () => {
			expect(as(guessFormat('9:5:7'))).toContain('H:m:s');
		});
		it('handles day-first dates with bare minutes', () => {
			expect(as(guessFormat('13/01/2020 9:5'))).toContain('DD/MM/YYYY H:m');
		});
		it('does not read a decimal number as hours.minutes', () => {
			// "12.5" must not become a time of day; only ":" introduces a bare minute.
			expect(as(guessFormat('12.5'))).not.toContain('H.m');
			expect(as(guessFormat('3.7'))).not.toContain('H.m');
		});
		it('still rejects a minute of 60 or more', () => {
			expect(as(guessFormat('9:65'))).toEqual([]);
		});
	});
});
