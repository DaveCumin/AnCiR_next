import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({ core: { tableProcesses: [] } }));
vi.mock('$lib/core/Column.svelte', () => ({
	getColumnById: (id) => mockColumns[id]
}));

import {
	matchesPredicate,
	selectedColumnIds,
	expandColumnRefs,
	makeSetRef,
	isSetRef,
	setRefId
} from './columnSet.js';
import { core } from '$lib/core/core.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	core.tableProcesses = [];
});

describe('matchesPredicate', () => {
	const col = { name: 'Liver rep 1', groupLabel: 'liver' };

	it('empty pattern selects everything (pass-through)', () => {
		expect(matchesPredicate(col, '', 'either')).toBe(true);
		expect(matchesPredicate(null, '', 'either')).toBe(true);
	});

	it('is case-insensitive substring on name', () => {
		expect(matchesPredicate(col, 'LIVER', 'name')).toBe(true);
		expect(matchesPredicate(col, 'rep 1', 'name')).toBe(true);
		expect(matchesPredicate(col, 'kidney', 'name')).toBe(false);
	});

	it('matches on label when field is label', () => {
		expect(matchesPredicate(col, 'liver', 'label')).toBe(true);
		expect(matchesPredicate({ name: 'Liver x', groupLabel: 'kidney' }, 'liver', 'label')).toBe(
			false
		);
	});

	it('either matches name OR label', () => {
		expect(matchesPredicate({ name: 'sample A', groupLabel: 'liver' }, 'liver', 'either')).toBe(
			true
		);
		expect(matchesPredicate({ name: 'liver A', groupLabel: 'x' }, 'liver', 'either')).toBe(true);
		expect(matchesPredicate({ name: 'a', groupLabel: 'b' }, 'liver', 'either')).toBe(false);
	});

	it('a non-empty pattern never matches a missing column', () => {
		expect(matchesPredicate(null, 'liver', 'either')).toBe(false);
	});
});

describe('selectedColumnIds', () => {
	beforeEach(() => {
		mockColumns[1] = { name: 'liver 1', groupLabel: 'liver' };
		mockColumns[2] = { name: 'kidney 1', groupLabel: 'kidney' };
		mockColumns[3] = { name: 'liver 2', groupLabel: 'liver' };
	});

	it('selects all candidates when the pattern is empty', () => {
		expect(selectedColumnIds({ colsIN: [1, 2, 3], pattern: '' })).toEqual([1, 2, 3]);
	});

	it('filters candidates by the label rule, preserving order', () => {
		expect(selectedColumnIds({ colsIN: [1, 2, 3], pattern: 'liver', matchField: 'label' })).toEqual(
			[1, 3]
		);
	});

	it('ignores non-numeric / missing candidates', () => {
		expect(selectedColumnIds({ colsIN: [1, 99, -1], pattern: '' })).toEqual([1]);
	});
});

describe('setRef token helpers', () => {
	it('round-trips', () => {
		const t = makeSetRef(7);
		expect(isSetRef(t)).toBe(true);
		expect(setRefId(t)).toBe(7);
	});
	it('rejects plain ids', () => {
		expect(isSetRef(5)).toBe(false);
		expect(isSetRef(null)).toBe(false);
		expect(setRefId(5)).toBe(-1);
	});
});

describe('expandColumnRefs', () => {
	beforeEach(() => {
		mockColumns[1] = { name: 'liver 1', groupLabel: 'liver' };
		mockColumns[2] = { name: 'kidney 1', groupLabel: 'kidney' };
		mockColumns[3] = { name: 'liver 2', groupLabel: 'liver' };
		core.tableProcesses = [
			{
				id: 7,
				name: 'ColumnSet',
				args: { colsIN: [1, 2, 3], pattern: 'liver', matchField: 'label' }
			}
		];
	});

	it('passes plain ids through unchanged', () => {
		expect(expandColumnRefs([1, 2, 3])).toEqual([1, 2, 3]);
	});

	it('expands a setRef token to the set’s currently-selected ids, in place', () => {
		expect(expandColumnRefs([makeSetRef(7)])).toEqual([1, 3]);
		expect(expandColumnRefs([9, makeSetRef(7), 5])).toEqual([9, 1, 3, 5]);
	});

	it('a token pointing at a missing set expands to nothing', () => {
		expect(expandColumnRefs([makeSetRef(999), 4])).toEqual([4]);
	});

	it('re-evaluates live when the set’s rule changes', () => {
		core.tableProcesses[0].args.pattern = '';
		expect(expandColumnRefs([makeSetRef(7)])).toEqual([1, 2, 3]);
	});

	it('non-array input yields an empty array', () => {
		expect(expandColumnRefs(-1)).toEqual([]);
		expect(expandColumnRefs(null)).toEqual([]);
	});
});
