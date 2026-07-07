import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({ core: { tableProcesses: [] } }));
vi.mock('$lib/core/Column.svelte', () => ({
	getColumnById: (id) => mockColumns[id]
}));

import { matchesPredicate, selectedColumnIds, setSelection } from './columnSet.js';
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

describe('setSelection', () => {
	beforeEach(() => {
		mockColumns[1] = { name: 'liver 1', groupLabel: 'liver' };
		mockColumns[2] = { name: 'kidney 1', groupLabel: 'kidney' };
		mockColumns[3] = { name: 'liver 2', groupLabel: 'liver' };
		core.tableProcesses = [
			{
				id: 7,
				name: 'ColumnSet',
				args: { colsIN: [1, 2, 3], pattern: 'liver', matchField: 'label' }
			},
			{
				id: 8,
				name: 'ColumnSet',
				args: { colsIN: [2], pattern: '', matchField: 'either' }
			}
		];
	});

	it('returns the candidate domain and the ordered selection for a set', () => {
		const { candidates, selected } = setSelection([7]);
		expect([...candidates].sort()).toEqual([1, 2, 3]); // ownership = all colsIN
		expect(selected).toEqual([1, 3]); // rule = label:liver
	});

	it('unions candidates and selection across several wired sets, de-duped', () => {
		const { candidates, selected } = setSelection([7, 8]);
		expect([...candidates].sort()).toEqual([1, 2, 3]);
		expect(selected).toEqual([1, 3, 2]); // set 7 → [1,3], set 8 → [2]
	});

	it('re-evaluates live when a set’s rule changes', () => {
		core.tableProcesses[0].args.pattern = '';
		expect(setSelection([7]).selected).toEqual([1, 2, 3]);
	});

	it('ignores missing / empty set ids', () => {
		expect(setSelection([999]).selected).toEqual([]);
		expect(setSelection([]).selected).toEqual([]);
		expect(setSelection(null).selected).toEqual([]);
	});
});
