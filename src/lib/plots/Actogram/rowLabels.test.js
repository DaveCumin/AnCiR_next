import { describe, it, expect } from 'vitest';
import {
	rowLabelText,
	rowLabelGutter,
	migrateRowLabels,
	DEFAULT_DATE_FORMAT
} from './rowLabels.js';

// 2024-08-01T00:00:00Z
const START = Date.UTC(2024, 7, 1);
const date = (over = {}) => ({
	mode: 'date',
	startTime: START,
	periodHrs: 24,
	dateFormat: DEFAULT_DATE_FORMAT,
	zone: 'utc',
	...over
});

describe('rowLabelText — period mode', () => {
	it('is the 1-based ordinal, because row 0 is "period 1"', () => {
		expect(rowLabelText(0, { mode: 'period' })).toBe('1');
		expect(rowLabelText(9, { mode: 'period' })).toBe('10');
	});

	it('is the default, so a session that predates dates is unaffected', () => {
		expect(rowLabelText(0, {})).toBe('1');
		expect(rowLabelText(4, { startTime: START })).toBe('5');
	});
});

describe('rowLabelText — date mode', () => {
	it('formats the first row as the start date', () => {
		expect(rowLabelText(0, date())).toBe('01 Aug');
	});

	it('advances one calendar day per row at a 24 h period', () => {
		expect(rowLabelText(1, date())).toBe('02 Aug');
		expect(rowLabelText(30, date())).toBe('31 Aug');
	});

	it('crosses a month boundary correctly', () => {
		expect(rowLabelText(31, date())).toBe('01 Sep');
	});

	it('honours a custom format', () => {
		expect(rowLabelText(0, date({ dateFormat: 'YYYY-MM-DD' }))).toBe('2024-08-01');
		expect(rowLabelText(0, date({ dateFormat: 'ddd D MMM' }))).toBe('Thu 1 Aug');
	});

	it('falls back to the default when the format is empty', () => {
		// An empty box must not silently unlabel every row.
		expect(rowLabelText(0, date({ dateFormat: '' }))).toBe('01 Aug');
		expect(rowLabelText(0, date({ dateFormat: '   ' }))).toBe('01 Aug');
	});

	it('DRIFTS against the calendar when the period is not 24 h', () => {
		// The whole reason periodHrs is in the arithmetic. At tau = 23.5 the rows slip
		// earlier, so two adjacent rows can legitimately carry the same date.
		const opts = date({ periodHrs: 23.5, dateFormat: 'DD MMM HH:mm' });
		expect(rowLabelText(0, opts)).toBe('01 Aug 00:00');
		expect(rowLabelText(1, opts)).toBe('01 Aug 23:30');
		expect(rowLabelText(2, opts)).toBe('02 Aug 23:00');
	});

	it('is not confused by a period longer than a day', () => {
		expect(rowLabelText(1, date({ periodHrs: 25, dateFormat: 'DD MMM HH:mm' }))).toBe(
			'02 Aug 01:00'
		);
	});

	it('falls back to the ordinal when there is no time base', () => {
		// A plot with no time column has nothing to date rows from; the ordinal keeps the
		// axis labelled rather than leaving it blank, which would read as a broken render.
		expect(rowLabelText(3, date({ startTime: null }))).toBe('4');
		expect(rowLabelText(3, date({ startTime: NaN }))).toBe('4');
		expect(rowLabelText(3, date({ startTime: undefined }))).toBe('4');
	});

	it('falls back to 24 h for a nonsense period rather than producing Invalid Date', () => {
		expect(rowLabelText(1, date({ periodHrs: 0 }))).toBe('02 Aug');
		expect(rowLabelText(1, date({ periodHrs: -5 }))).toBe('02 Aug');
		expect(rowLabelText(1, date({ periodHrs: NaN }))).toBe('02 Aug');
	});

	it('formats in the given zone, so a row cannot disagree with the x axis', () => {
		// 2024-08-01T00:00Z is 12:00 on 1 August in Auckland (NZST, UTC+12: AHEAD, so the
		// date is unchanged) and 20:00 on 31 July in New York (EDT, UTC-4: the date moves).
		expect(rowLabelText(0, date({ zone: 'Pacific/Auckland' }))).toBe('01 Aug');
		expect(rowLabelText(0, date({ zone: 'America/New_York' }))).toBe('31 Jul');
	});
});

describe('rowLabelGutter', () => {
	it('reserves nothing when the labels are off', () => {
		expect(rowLabelGutter({ mode: 'none' })).toBe(0);
		// An absent or unrecognised mode reserves nothing either: the gutter must never be
		// held open for labels that are not drawn.
		expect(rowLabelGutter({})).toBe(0);
		expect(rowLabelGutter({ mode: 'wat' })).toBe(0);
	});

	it('grows with the number of rows in period mode', () => {
		const few = rowLabelGutter({ mode: 'period', nRows: 9 });
		const many = rowLabelGutter({ mode: 'period', nRows: 100 });
		expect(many).toBeGreaterThan(few);
	});

	it('reserves more for a date than for a period number', () => {
		// The clipping this exists to prevent: "05 Aug" is far wider than "5".
		const period = rowLabelGutter({ mode: 'period', nRows: 10 });
		const asDate = rowLabelGutter({ mode: 'date', dateFormat: 'DD MMM' });
		expect(asDate).toBeGreaterThan(period);
	});

	it('measures MMM as a three-letter month, not as the token', () => {
		// 'MMM' renders "Aug", so reserving by raw token length would under-reserve for a
		// format like 'MMMM' (September).
		const short = rowLabelGutter({ mode: 'date', dateFormat: 'MMM' });
		const long = rowLabelGutter({ mode: 'date', dateFormat: 'MMMM' });
		expect(long).toBeGreaterThan(short);
	});

	it('reserves for the default when no format is given', () => {
		expect(rowLabelGutter({ mode: 'date' })).toBe(
			rowLabelGutter({ mode: 'date', dateFormat: DEFAULT_DATE_FORMAT })
		);
	});

	it('never returns a negative or fractional gutter', () => {
		const g = rowLabelGutter({ mode: 'period', nRows: 0 });
		expect(g).toBeGreaterThan(0);
		expect(Number.isInteger(g)).toBe(true);
	});
});

// Three vintages of saved session have to land on the right mode. The boolean is
// authoritative for OFF: a session with labels switched off must not come back with them on.
describe('migrateRowLabels', () => {
	it('takes the new field when present', () => {
		expect(migrateRowLabels({ rowLabels: 'date' })).toBe('date');
		expect(migrateRowLabels({ rowLabels: 'none' })).toBe('none');
	});

	it('ignores a nonsense new value rather than drawing an unknown mode', () => {
		expect(migrateRowLabels({ rowLabels: 'sideways' })).toBe('none');
	});

	it('reads the original boolean', () => {
		expect(migrateRowLabels({ showDayNumbers: true })).toBe('period');
		expect(migrateRowLabels({ showDayNumbers: false })).toBe('none');
	});

	it('reads the intermediate boolean-plus-mode shape', () => {
		expect(migrateRowLabels({ showDayNumbers: true, rowLabelMode: 'date' })).toBe('date');
		expect(migrateRowLabels({ showDayNumbers: true, rowLabelMode: 'period' })).toBe('period');
	});

	it('keeps OFF off even when a mode was stored beside it', () => {
		// The pair could express "off, and when on show dates". Only the off part survives.
		expect(migrateRowLabels({ showDayNumbers: false, rowLabelMode: 'date' })).toBe('none');
	});

	it('defaults to none for a session older than the feature', () => {
		expect(migrateRowLabels({})).toBe('none');
		expect(migrateRowLabels(null)).toBe('none');
		expect(migrateRowLabels(undefined)).toBe('none');
	});

	it('prefers the new field over the legacy pair when both are present', () => {
		expect(migrateRowLabels({ rowLabels: 'none', showDayNumbers: true })).toBe('none');
	});
});
