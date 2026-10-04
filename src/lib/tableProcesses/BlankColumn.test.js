import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData: new Map(), storedValues: {} },
	getStoredValue: vi.fn()
}));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: vi.fn() }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));

import { blankcolumn, enteredColumn } from './BlankColumn.svelte';

// Preview mode: out.result === -1

describe('blankcolumn', () => {
	it('creates N empty (missing, null) cells in preview mode', () => {
		const [result, valid] = blankcolumn({ N: 5, storedValueRefs: {}, out: { result: -1 } });
		expect(valid).toBe(true);
		expect(result).toHaveLength(5);
		// Empty cells are null, the house rule's "missing" (utils/stats.js isInvalidValue).
		result.forEach((v) => expect(v).toBeNull());
	});

	it('N = 0 produces an empty array', () => {
		const [result] = blankcolumn({ N: 0, storedValueRefs: {}, out: { result: -1 } });
		expect(result).toHaveLength(0);
	});

	it('floors non-integer N', () => {
		const [result] = blankcolumn({ N: 3.9, storedValueRefs: {}, out: { result: -1 } });
		expect(result).toHaveLength(3);
	});

	it('clamps negative N to 0', () => {
		const [result] = blankcolumn({ N: -5, storedValueRefs: {}, out: { result: -1 } });
		expect(result).toHaveLength(0);
	});
});

// What the grid's typed cells are stored as (STAT-15). A blank cell is missing (null) in both
// column types: never 0 (a whitespace cell used to pass Number(' ') === 0) and never NaN.
describe('enteredColumn', () => {
	it('a numeric column stores numbers, and blank cells as null', () => {
		expect(enteredColumn(['1', '', '2.5'])).toEqual({ type: 'number', values: [1, null, 2.5] });
	});

	it('a whitespace-only cell is blank, not 0', () => {
		expect(enteredColumn(['1', '  ', '3'])).toEqual({ type: 'number', values: [1, null, 3] });
	});

	it('cells reloaded from a session (null, or the NaN older sessions stored) stay missing', () => {
		expect(enteredColumn([4, null, NaN, '5'])).toEqual({
			type: 'number',
			values: [4, null, null, 5]
		});
	});

	it('any text makes it a category column that keeps its labels, with blanks as null', () => {
		expect(enteredColumn(['a', '', 'b', ' '])).toEqual({
			type: 'category',
			values: ['a', null, 'b', null]
		});
	});

	it('an untouched column stays categorical and all-missing', () => {
		expect(enteredColumn(['', '', null])).toEqual({ type: 'category', values: [null, null, null] });
	});

	it('keepRaw leaves non-blank category entries as they are (a stored-value number stays a number)', () => {
		expect(enteredColumn(['a', 3, ''], { keepRaw: true })).toEqual({
			type: 'category',
			values: ['a', 3, null]
		});
		expect(enteredColumn(['a', 3, ''])).toEqual({ type: 'category', values: ['a', '3', null] });
	});
});
