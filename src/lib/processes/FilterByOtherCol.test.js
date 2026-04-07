import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/ColumnSelector.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/DateTimeHrs.svelte', () => ({ default: {} }));

import { filterbyothercol } from './FilterByOtherCol.svelte';

// ─── self-filter (byColId === parentColId) ────────────────────────────────────
// When byColId === parentColId the filter data is x itself, but getColumnById must
// still return a column stub so the "not found" guard doesn't skip the condition.

describe('filterbyothercol — self-filter (numeric)', () => {
	const SELF_ID = 42;
	// Stub: getData unused for self-filter path, but type must exist for numeric branch.
	beforeEach(() => {
		mockColumns[SELF_ID] = { type: 'number', getData: () => [] };
	});

	it('keeps values that satisfy == condition', () => {
		const x = [1, 2, 3, 2, 1];
		const args = { parentColId: SELF_ID, conditions: [{ byColId: SELF_ID, isOperator: '==', byColValue: 2 }] };
		expect(filterbyothercol(x, args)).toEqual([null, 2, null, 2, null]);
	});

	it('keeps values that satisfy > condition', () => {
		const x = [1, 2, 3, 4, 5];
		const args = { parentColId: SELF_ID, conditions: [{ byColId: SELF_ID, isOperator: '>', byColValue: 3 }] };
		expect(filterbyothercol(x, args)).toEqual([null, null, null, 4, 5]);
	});

	it('keeps values that satisfy <= condition', () => {
		const x = [1, 2, 3];
		const args = { parentColId: SELF_ID, conditions: [{ byColId: SELF_ID, isOperator: '<=', byColValue: 2 }] };
		expect(filterbyothercol(x, args)).toEqual([1, 2, null]);
	});

	it('keeps values that satisfy != condition', () => {
		const x = [1, 2, 3];
		const args = { parentColId: SELF_ID, conditions: [{ byColId: SELF_ID, isOperator: '!=', byColValue: 2 }] };
		expect(filterbyothercol(x, args)).toEqual([1, null, 3]);
	});

	it('returns original x when no conditions', () => {
		const x = [1, 2, 3];
		expect(filterbyothercol(x, { parentColId: SELF_ID, conditions: [] })).toBe(x);
	});

	it('skips conditions with byColId == -1', () => {
		const x = [1, 2, 3];
		// The invalid condition is skipped, resultMask stays all-true → all kept
		const args = { parentColId: SELF_ID, conditions: [{ byColId: -1, isOperator: '==', byColValue: 0 }] };
		expect(filterbyothercol(x, args)).toEqual([1, 2, 3]);
	});
});

// ─── external column filter ───────────────────────────────────────────────────

describe('filterbyothercol — external numeric column', () => {
	const PARENT_ID = 1;
	const FILTER_COL_ID = 2;

	it('nullifies rows where filter column fails the condition', () => {
		mockColumns[FILTER_COL_ID] = { type: 'number', getData: () => [10, 20, 30] };
		const x = [100, 200, 300];
		const args = {
			parentColId: PARENT_ID,
			conditions: [{ byColId: FILTER_COL_ID, isOperator: '>=', byColValue: 20 }]
		};
		expect(filterbyothercol(x, args)).toEqual([null, 200, 300]);
	});
});

// ─── category column filter ───────────────────────────────────────────────────

describe('filterbyothercol — external category column', () => {
	const PARENT_ID = 1;
	const FILTER_COL_ID = 3;

	it('filters by string equality', () => {
		mockColumns[FILTER_COL_ID] = { type: 'category', getData: () => ['a', 'b', 'a'] };
		const x = [10, 20, 30];
		const args = {
			parentColId: PARENT_ID,
			conditions: [{ byColId: FILTER_COL_ID, isOperator: '==', byColValue: 'a' }]
		};
		expect(filterbyothercol(x, args)).toEqual([10, null, 30]);
	});

	it('filters by string includes', () => {
		mockColumns[FILTER_COL_ID] = { type: 'category', getData: () => ['hello world', 'foo', 'hello there'] };
		const x = [1, 2, 3];
		const args = {
			parentColId: PARENT_ID,
			conditions: [{ byColId: FILTER_COL_ID, isOperator: 'includes', byColValue: 'hello' }]
		};
		expect(filterbyothercol(x, args)).toEqual([1, null, 3]);
	});
});
