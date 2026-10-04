// Unit cover for how imported cells are read (review findings STAT-16, STAT-17):
// the cell typer that replaces PapaParse's dynamicTyping, decimal commas, the
// non-numeric cell count, zone offsets in time formats, and the day/month order.
// End-to-end cover through the import modal is ImportData.parsing.test.js.
import { describe, it, expect } from 'vitest';
import Papa from 'papaparse';
import {
	countNonNumeric,
	decimalCommaColumns,
	detectColumnType,
	makeCellTyper,
	parseDecimalComma,
	resolveImportType
} from './importColumnTypes.js';
import {
	getUNIXDate,
	guessDateDetails,
	guessDateofArray,
	localeDayMonthOrder,
	parseTimeStrict,
	settleDayMonthOrder
} from './time/TimeUtils.js';

function parseColumns(csv, typer) {
	const r = Papa.parse(csv, {
		header: true,
		dynamicTyping: false,
		transform: typer,
		skipEmptyLines: 'greedy'
	});
	const out = {};
	for (const f of r.meta.fields) out[f] = r.data.map((row) => row[f]);
	return { columns: out, delimiter: r.meta.delimiter };
}

describe('makeCellTyper', () => {
	const typed = makeCellTyper();

	it('types numbers, booleans and blanks as PapaParse dynamicTyping did', () => {
		expect(typed('8.4')).toBe(8.4);
		expect(typed('-3')).toBe(-3);
		expect(typed('1e3')).toBe(1000);
		expect(typed(' 7 ')).toBe(7);
		expect(typed('true')).toBe(true);
		expect(typed('TRUE')).toBe(true);
		expect(typed('false')).toBe(false);
		expect(typed('FALSE')).toBe(false);
		expect(typed('')).toBe(null);
		expect(typed('abc')).toBe('abc');
	});

	it('leaves numbers past 2^53 as text, as PapaParse did', () => {
		expect(typed('9007199254740993')).toBe('9007199254740993');
	});

	it('passes a non-string value through untouched', () => {
		expect(typed(5)).toBe(5);
	});

	it('keeps zone-qualified ISO timestamps as text (dynamicTyping made them Dates)', () => {
		expect(typed('2026-03-01T08:00:00+13:00')).toBe('2026-03-01T08:00:00+13:00');
		expect(typed('2026-03-01T08:00:00Z')).toBe('2026-03-01T08:00:00Z');
		const dyn = Papa.parse('t\n2026-03-01T08:00:00Z', { header: true, dynamicTyping: true });
		expect(dyn.data[0].t).toBeInstanceOf(Date);
	});

	it('reads decimal commas only when asked', () => {
		expect(typed('10,5')).toBe('10,5');
		const dc = makeCellTyper({ decimalComma: true });
		expect(dc('10,5')).toBe(10.5);
		expect(dc('-0,25')).toBe(-0.25);
		expect(dc('1.234,5')).toBe(1234.5);
		expect(dc('8.4')).toBe(8.4);
		expect(dc('10,5 kg')).toBe('10,5 kg');
	});

	it('types a semicolon-delimited decimal-comma file end to end', () => {
		const csv = 'a;b\n10;1\n10,5;2\n';
		expect(parseColumns(csv, makeCellTyper()).columns.a).toEqual([10, '10,5']);
		const dc = parseColumns(csv, makeCellTyper({ decimalComma: true }));
		expect(dc.delimiter).toBe(';');
		expect(dc.columns.a).toEqual([10, 10.5]);
	});
});

describe('parseDecimalComma', () => {
	it('reads decimal-comma text and nothing else', () => {
		expect(parseDecimalComma('12,5')).toBe(12.5);
		expect(parseDecimalComma(' 0,001 ')).toBe(0.001);
		expect(parseDecimalComma('12.345.678,9')).toBe(12345678.9);
		expect(parseDecimalComma('12,5,1')).toBe(null);
		expect(parseDecimalComma('1.23,4')).toBe(null);
		expect(parseDecimalComma('12')).toBe(null);
		expect(parseDecimalComma(12.5)).toBe(null);
		expect(parseDecimalComma(null)).toBe(null);
	});
});

describe('decimalCommaColumns', () => {
	it('names a column of decimal commas and whole numbers', () => {
		expect(
			decimalCommaColumns({
				a: [10, '10,5', null, 'NA', '8,25'],
				b: [1, 2, 3],
				c: ['x', 'y']
			})
		).toEqual(['a']);
	});

	it('does not name a column that also has dot decimals or other text', () => {
		expect(decimalCommaColumns({ a: ['10,5', 1.5] })).toEqual([]);
		expect(decimalCommaColumns({ a: ['10,5', 'n/a'] })).toEqual([]);
	});

	it('copes with nothing to look at', () => {
		expect(decimalCommaColumns(null)).toEqual([]);
		expect(decimalCommaColumns({ a: null })).toEqual([]);
	});
});

describe('countNonNumeric', () => {
	it('counts non-blank cells that are not numbers, skipping missing markers', () => {
		expect(countNonNumeric([1, '10,5', null, '', 'NA', 'NaN', 'null', 'x', NaN, true])).toEqual({
			count: 3,
			example: '10,5'
		});
	});

	it('is zero for a clean column and for no column', () => {
		expect(countNonNumeric([1, 2.5, null])).toEqual({ count: 0, example: undefined });
		expect(countNonNumeric(undefined)).toEqual({ count: 0, example: undefined });
	});

	it('counts Infinity as not a number', () => {
		expect(countNonNumeric([1, Infinity]).count).toBe(1);
	});
});

describe('zone offsets in a time format', () => {
	it('parses "+hh:mm" and "-hh:mm" to the instant the text names, in UTC and local mode', () => {
		for (const utc of [true, false]) {
			expect(
				parseTimeStrict('2026-03-01T08:00:00+05:30', 'YYYY-MM-DDTHH:mm:ssZ', { utc }).valueOf()
			).toBe(Date.UTC(2026, 2, 1, 2, 30));
			expect(
				parseTimeStrict('2026-03-01T08:00:00-04:00', 'YYYY-MM-DDTHH:mm:ssZ', { utc }).valueOf()
			).toBe(Date.UTC(2026, 2, 1, 12, 0));
		}
	});

	it('parses the compact "+hhmm" form (ZZ)', () => {
		expect(parseTimeStrict('2026-03-01 08:00 +0530', 'YYYY-MM-DD HH:mm ZZ').valueOf()).toBe(
			Date.UTC(2026, 2, 1, 2, 30)
		);
	});

	it('accepts a "Z" where the format has an offset token', () => {
		expect(parseTimeStrict('2026-03-01T08:00:00Z', 'YYYY-MM-DDTHH:mm:ssZ').valueOf()).toBe(
			Date.UTC(2026, 2, 1, 8, 0)
		);
	});

	it('still rejects an impossible wall clock or a missing offset', () => {
		expect(parseTimeStrict('2026-03-01T25:00:00+05:30', 'YYYY-MM-DDTHH:mm:ssZ').isValid()).toBe(
			false
		);
		expect(parseTimeStrict('2026-02-30T08:00:00+05:30', 'YYYY-MM-DDTHH:mm:ssZ').isValid()).toBe(
			false
		);
		expect(parseTimeStrict('2026-03-01T08:00:00', 'YYYY-MM-DDTHH:mm:ssZ').isValid()).toBe(false);
		expect(parseTimeStrict('garbage+05:30', 'YYYY-MM-DDTHH:mm:ssZ').isValid()).toBe(false);
	});

	it('guesses and reads a whole column of offsets', () => {
		const col = ['2026-03-01T08:00:00+05:30', '2026-03-01T09:00:00+05:30'];
		const fmt = guessDateofArray(col);
		expect(col.map((v) => getUNIXDate(v, fmt))).toEqual([
			Date.UTC(2026, 2, 1, 2, 30),
			Date.UTC(2026, 2, 1, 3, 30)
		]);
	});

	it('reads Date objects another parser made as their ISO text', () => {
		const dates = [new Date(Date.UTC(2026, 2, 1, 8)), new Date(Date.UTC(2026, 2, 1, 9))];
		expect(guessDateofArray(dates)).not.toEqual([]);
		const r = resolveImportType(dates, null);
		expect(r.type).toBe('time');
		expect(r.values).toEqual(['2026-03-01T08:00:00.000Z', '2026-03-01T09:00:00.000Z']);
		expect(resolveImportType([new Date(NaN), 'x'], null).values[0]).toBeInstanceOf(Date);
	});
});

describe('day/month order', () => {
	const AMBIGUOUS = ['03/04/2024', '03/05/2024', '03/06/2024'];

	it('says when every value reads both ways round', () => {
		const d = guessDateDetails(AMBIGUOUS);
		expect(d.dayMonth).toEqual({
			ambiguous: true,
			dayFirst: 'DD/MM/YYYY',
			monthFirst: 'MM/DD/YYYY'
		});
	});

	it('takes the order it is given for an ambiguous column, and the old default without one', () => {
		expect(guessDateofArray(AMBIGUOUS, { order: 'month' })).toBe('MM/DD/YYYY');
		expect(guessDateofArray(AMBIGUOUS, { order: 'day' })).toBe('DD/MM/YYYY');
		expect(guessDateofArray(AMBIGUOUS)).toBe('DD/MM/YYYY');
		expect(guessDateofArray(AMBIGUOUS, { order: 'sideways' })).toBe('DD/MM/YYYY');
	});

	it('is settled by a day of 13 or more, whichever order is asked for', () => {
		const us = [...AMBIGUOUS, '03/13/2024'];
		expect(guessDateDetails(us).dayMonth.ambiguous).toBe(false);
		expect(guessDateofArray(us, { order: 'day' })).toBe('MM/DD/YYYY');
		const nz = [...AMBIGUOUS, '13/03/2024'];
		expect(guessDateofArray(nz, { order: 'month' })).toBe('DD/MM/YYYY');
	});

	it('flags single-digit and time-of-day forms too', () => {
		const d = guessDateDetails(['3/4/2024 10:00', '3/5/2024 11:30']);
		expect(d.dayMonth.ambiguous).toBe(true);
		expect(d.dayMonth.monthFirst).toMatch(/^M\/D\/YYYY/);
	});

	it('reads year-first dates year-month-day without asking', () => {
		const d = guessDateDetails(['2024/03/04', '2024/03/05']);
		expect(d.dayMonth).toBe(null);
		expect(d.format).toBe('YYYY/MM/DD');
	});

	it('has nothing to say about month names or about non-dates', () => {
		expect(guessDateDetails(['03 Apr 2024', '04 Apr 2024']).dayMonth).toBe(null);
		expect(guessDateDetails(['10:00', '11:00']).dayMonth).toBe(null);
		expect(guessDateDetails([1, 2]).dayMonth).toBe(null);
		expect(guessDateDetails('nope')).toEqual({ format: [], dayMonth: null });
	});

	it('detectColumnType reports the verdict and applies the order', () => {
		const t = detectColumnType(AMBIGUOUS, { order: 'month' });
		expect(t.type).toBe('time');
		expect(t.timeFormat).toBe('MM/DD/YYYY');
		expect(t.dayMonth.ambiguous).toBe(true);
		expect(detectColumnType(AMBIGUOUS, { order: 'day' }).timeFormat).toBe('DD/MM/YYYY');
		expect(detectColumnType([1, 2]).dayMonth).toBe(null);
		expect(detectColumnType(['a', 'b']).dayMonth).toBe(null);
	});

	it('resolveImportType imports in the order it is given', () => {
		const r = resolveImportType(AMBIGUOUS, null, { order: 'month' });
		expect(r.timeFormat).toBe('MM/DD/YYYY');
		expect(getUNIXDate(r.values[0], r.timeFormat)).toBe(Date.UTC(2024, 2, 4));
		const t = resolveImportType(AMBIGUOUS, { choice: 'time' }, { order: 'month' });
		expect(t.timeFormat).toBe('MM/DD/YYYY');
	});
});

describe('settleDayMonthOrder', () => {
	it('finds the first value only one reading accepts', () => {
		const values = ['03/04/2024', '', null, '03/13/2024', '13/03/2024'];
		expect(settleDayMonthOrder(values, 'DD/MM/YYYY', 'MM/DD/YYYY')).toEqual({
			order: 'month',
			index: 3,
			value: '03/13/2024'
		});
		expect(settleDayMonthOrder(['13/03/2024'], 'DD/MM/YYYY', 'MM/DD/YYYY').order).toBe('day');
	});

	it('is null when nothing settles it', () => {
		expect(settleDayMonthOrder(['03/04/2024', 'x'], 'DD/MM/YYYY', 'MM/DD/YYYY')).toBe(null);
		expect(settleDayMonthOrder(null, 'DD/MM/YYYY', 'MM/DD/YYYY')).toBe(null);
	});
});

describe('localeDayMonthOrder', () => {
	it('reads the order from the locale', () => {
		expect(localeDayMonthOrder('en-US')).toBe('month');
		expect(localeDayMonthOrder('en-NZ')).toBe('day');
		expect(localeDayMonthOrder('en-GB')).toBe('day');
		expect(localeDayMonthOrder('de-DE')).toBe('day');
		expect(localeDayMonthOrder('ja-JP')).toBe('month');
		expect(['day', 'month']).toContain(localeDayMonthOrder());
	});

	it('falls back to day first for a locale Intl rejects', () => {
		expect(localeDayMonthOrder('not a locale!!')).toBe('day');
	});
});
