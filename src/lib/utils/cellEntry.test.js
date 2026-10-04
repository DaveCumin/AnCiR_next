import { describe, it, expect } from 'vitest';
import { isBlankEntry, parseNumberEntry, parseCellEntry, upsertEdit } from './cellEntry.js';
import { isInvalidValue } from './stats.js';

describe('isBlankEntry', () => {
	it('null, undefined, blank or whitespace text and NaN are blank', () => {
		for (const v of [null, undefined, '', '   ', '\t', NaN]) expect(isBlankEntry(v)).toBe(true);
	});
	it('0, "0", text and numbers are not blank', () => {
		for (const v of [0, '0', 'a', 12, -1]) expect(isBlankEntry(v)).toBe(false);
	});
});

describe('parseNumberEntry', () => {
	it('blank is missing (null), which the house rule treats as missing', () => {
		const r = parseNumberEntry('');
		expect(r).toEqual({ ok: true, value: null });
		expect(isInvalidValue(r.value)).toBe(true);
	});
	it('reads numbers, trimming spaces, and keeps a real 0', () => {
		expect(parseNumberEntry(' 3.5 ')).toEqual({ ok: true, value: 3.5 });
		expect(parseNumberEntry('0')).toEqual({ ok: true, value: 0 });
		expect(parseNumberEntry('-2e3')).toEqual({ ok: true, value: -2000 });
		expect(parseNumberEntry(7)).toEqual({ ok: true, value: 7 });
	});
	it('refuses text and Infinity with a reason naming the entry', () => {
		const r = parseNumberEntry('abc');
		expect(r.ok).toBe(false);
		expect(r.reason).toContain('"abc" is not a number');
		expect(r.reason).toContain('clear the cell');
		expect(parseNumberEntry('Infinity').ok).toBe(false);
	});
});

describe('parseCellEntry', () => {
	it('number columns parse, category columns keep text, blank is null in both', () => {
		expect(parseCellEntry('number', '4')).toEqual({ ok: true, value: 4 });
		expect(parseCellEntry('category', '4')).toEqual({ ok: true, value: '4' });
		expect(parseCellEntry('category', 'treated')).toEqual({ ok: true, value: 'treated' });
		expect(parseCellEntry('category', ' ')).toEqual({ ok: true, value: null });
		expect(parseCellEntry('number', ' ')).toEqual({ ok: true, value: null });
	});
});

describe('upsertEdit', () => {
	it('appends a new position with a fresh id', () => {
		expect(upsertEdit([], 2, 5, () => 'x')).toEqual([{ id: 'x', position: 2, value: 5 }]);
		expect(upsertEdit(undefined, 1, null, () => 'y')).toEqual([
			{ id: 'y', position: 1, value: null }
		]);
	});
	it('replaces the value at an existing position without mutating the input', () => {
		const before = [
			{ id: 'a', position: 1, value: 1 },
			{ id: 'b', position: 2, value: 2 }
		];
		const after = upsertEdit(before, 2, null);
		expect(after).toEqual([
			{ id: 'a', position: 1, value: 1 },
			{ id: 'b', position: 2, value: null }
		]);
		expect(before[1].value).toBe(2);
		expect(after).not.toBe(before);
	});
	it('matches a position stored as a string (older sessions)', () => {
		expect(upsertEdit([{ id: 'a', position: '3', value: 1 }], 3, 9)).toEqual([
			{ id: 'a', position: '3', value: 9 }
		]);
	});
});
