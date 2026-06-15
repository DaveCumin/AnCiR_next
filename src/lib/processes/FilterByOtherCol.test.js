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

	it('filters by string notincludes', () => {
		mockColumns[FILTER_COL_ID] = { type: 'category', getData: () => ['ax', 'b', 'cx'] };
		const x = [1, 2, 3];
		const args = {
			parentColId: PARENT_ID,
			conditions: [{ byColId: FILTER_COL_ID, isOperator: 'notincludes', byColValue: 'x' }]
		};
		// keeps only the entry that does NOT contain 'x' → 'b' at index 1.
		expect(filterbyothercol(x, args)).toEqual([null, 2, null]);
	});

	it('filters by string inequality (!=)', () => {
		mockColumns[FILTER_COL_ID] = { type: 'category', getData: () => ['a', 'b', 'a'] };
		const x = [10, 20, 30];
		const args = {
			parentColId: PARENT_ID,
			conditions: [{ byColId: FILTER_COL_ID, isOperator: '!=', byColValue: 'a' }]
		};
		expect(filterbyothercol(x, args)).toEqual([null, 20, null]);
	});
});

// ─── all-pass / all-fail / boundary predicates ─────────────────────────────────

describe('filterbyothercol — all-pass and all-fail', () => {
	const PARENT_ID = 1;
	const COL = 5;

	it('all-pass predicate keeps every value', () => {
		mockColumns[COL] = { type: 'number', getData: () => [10, 20, 30] };
		const x = [1, 2, 3];
		const args = { parentColId: PARENT_ID, conditions: [{ byColId: COL, isOperator: '>=', byColValue: 0 }] };
		expect(filterbyothercol(x, args)).toEqual([1, 2, 3]);
	});

	it('all-fail predicate nullifies every value', () => {
		mockColumns[COL] = { type: 'number', getData: () => [10, 20, 30] };
		const x = [1, 2, 3];
		const args = { parentColId: PARENT_ID, conditions: [{ byColId: COL, isOperator: '<', byColValue: 0 }] };
		expect(filterbyothercol(x, args)).toEqual([null, null, null]);
	});

	it('unknown operator falls through to false → nullifies everything', () => {
		mockColumns[COL] = { type: 'number', getData: () => [1, 2, 3] };
		const x = [1, 2, 3];
		const args = { parentColId: PARENT_ID, conditions: [{ byColId: COL, isOperator: '???', byColValue: 0 }] };
		expect(filterbyothercol(x, args)).toEqual([null, null, null]);
	});
});

describe('filterbyothercol — boundary predicates', () => {
	const PARENT_ID = 1;
	const COL = 6;
	beforeEach(() => {
		mockColumns[COL] = { type: 'number', getData: () => [9, 10, 11] };
	});

	it('>= includes the boundary value', () => {
		const args = { parentColId: PARENT_ID, conditions: [{ byColId: COL, isOperator: '>=', byColValue: 10 }] };
		expect(filterbyothercol([1, 2, 3], args)).toEqual([null, 2, 3]);
	});

	it('> excludes the boundary value', () => {
		const args = { parentColId: PARENT_ID, conditions: [{ byColId: COL, isOperator: '>', byColValue: 10 }] };
		expect(filterbyothercol([1, 2, 3], args)).toEqual([null, null, 3]);
	});

	it('<= includes the boundary value', () => {
		const args = { parentColId: PARENT_ID, conditions: [{ byColId: COL, isOperator: '<=', byColValue: 10 }] };
		expect(filterbyothercol([1, 2, 3], args)).toEqual([1, 2, null]);
	});

	it('< excludes the boundary value', () => {
		const args = { parentColId: PARENT_ID, conditions: [{ byColId: COL, isOperator: '<', byColValue: 10 }] };
		expect(filterbyothercol([1, 2, 3], args)).toEqual([1, null, null]);
	});

	it('== matches the exact value', () => {
		const args = { parentColId: PARENT_ID, conditions: [{ byColId: COL, isOperator: '==', byColValue: 10 }] };
		expect(filterbyothercol([1, 2, 3], args)).toEqual([null, 2, null]);
	});
});

// ─── multiple conditions are ANDed ─────────────────────────────────────────────

describe('filterbyothercol — multiple conditions (AND logic)', () => {
	const PARENT_ID = 1;
	const COL = 7;

	it('keeps values satisfying both conditions', () => {
		mockColumns[COL] = { type: 'number', getData: () => [1, 2, 3, 4] };
		const x = [10, 20, 30, 40];
		const args = {
			parentColId: PARENT_ID,
			conditions: [
				{ byColId: COL, isOperator: '>', byColValue: 1 },
				{ byColId: COL, isOperator: '<', byColValue: 4 }
			]
		};
		// 1<v<4 → indices 1,2 only.
		expect(filterbyothercol(x, args)).toEqual([null, 20, 30, null]);
	});
});

// ─── mismatched lengths between x and the filter column ────────────────────────

describe('filterbyothercol — mismatched lengths', () => {
	const PARENT_ID = 1;
	const COL = 8;

	it('keeps trailing values when the filter column is shorter than x', () => {
		mockColumns[COL] = { type: 'number', getData: () => [10, 20] };
		const x = [1, 2, 3, 4];
		const args = { parentColId: PARENT_ID, conditions: [{ byColId: COL, isOperator: '>', byColValue: 15 }] };
		// indices 0,1 evaluated (10>15 false, 20>15 true); indices 2,3 keep default-true mask.
		expect(filterbyothercol(x, args)).toEqual([null, 2, 3, 4]);
	});

	it('ignores filter-column entries beyond x when the filter column is longer', () => {
		mockColumns[COL] = { type: 'number', getData: () => [10, 20, 30, 40, 50, 60] };
		const x = [1, 2, 3, 4];
		const args = { parentColId: PARENT_ID, conditions: [{ byColId: COL, isOperator: '>', byColValue: 25 }] };
		expect(filterbyothercol(x, args)).toEqual([null, null, 3, 4]);
	});
});

// ─── guards: missing column, empty data ────────────────────────────────────────

describe('filterbyothercol — guards', () => {
	const PARENT_ID = 1;

	it('skips a condition whose column is not found (keeps all)', () => {
		const x = [1, 2, 3];
		const args = { parentColId: PARENT_ID, conditions: [{ byColId: 999, isOperator: '==', byColValue: 0 }] };
		// getColumnById(999) → undefined → condition skipped → mask stays all-true.
		expect(filterbyothercol(x, args)).toEqual([1, 2, 3]);
	});

	it('skips a condition whose column returns empty data (keeps all)', () => {
		const EMPTY = 10;
		mockColumns[EMPTY] = { type: 'number', getData: () => [] };
		const x = [1, 2, 3];
		const args = { parentColId: PARENT_ID, conditions: [{ byColId: EMPTY, isOperator: '>', byColValue: 0 }] };
		expect(filterbyothercol(x, args)).toEqual([1, 2, 3]);
	});

	it('returns original x when conditions is undefined', () => {
		const x = [1, 2, 3];
		expect(filterbyothercol(x, { parentColId: PARENT_ID })).toBe(x);
	});
});
