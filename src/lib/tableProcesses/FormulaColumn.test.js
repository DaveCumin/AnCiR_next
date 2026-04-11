import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockColumns, mockStoredValues } = vi.hoisted(() => ({
	mockColumns: {},
	mockStoredValues: {}
}));

vi.mock('$lib/core/core.svelte', () => ({
	core: {
		rawData: { set: vi.fn() },
		storedValues: mockStoredValues
	},
	getStoredValue: (key) => mockStoredValues[key]
}));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));

import { formulacolumn } from './FormulaColumn.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	Object.keys(mockStoredValues).forEach((k) => delete mockStoredValues[k]);
});

const preview = { result: -1 };

describe('formulacolumn', () => {
	it('returns invalid when no column tokens', () => {
		const [, valid] = formulacolumn({ tokens: [{ type: 'text', value: '42' }], out: preview });
		expect(valid).toBe(false);
	});

	it('evaluates a simple expression using one column', () => {
		mockColumns[1] = { getData: () => [1, 2, 3] };
		const tokens = [
			{ type: 'col', id: 1 },
			{ type: 'text', value: ' * 2' }
		];
		const [result, valid] = formulacolumn({ tokens, out: preview });
		expect(valid).toBe(true);
		expect(result).toEqual([2, 4, 6]);
	});

	it('evaluates an expression with two columns', () => {
		mockColumns[1] = { getData: () => [1, 2, 3] };
		mockColumns[2] = { getData: () => [10, 20, 30] };
		const tokens = [
			{ type: 'col', id: 1 },
			{ type: 'text', value: ' + ' },
			{ type: 'col', id: 2 }
		];
		const [result, valid] = formulacolumn({ tokens, out: preview });
		expect(valid).toBe(true);
		expect(result).toEqual([11, 22, 33]);
	});

	it('evaluates a stored value token', () => {
		mockColumns[1] = { getData: () => [2, 4, 6] };
		mockStoredValues['scale'] = 3;
		const tokens = [
			{ type: 'col', id: 1 },
			{ type: 'text', value: ' * ' },
			{ type: 'stored', key: 'scale' }
		];
		const [result, valid] = formulacolumn({ tokens, out: preview });
		expect(valid).toBe(true);
		expect(result).toEqual([6, 12, 18]);
	});

	it('returns invalid for a syntax-error expression', () => {
		mockColumns[1] = { getData: () => [1, 2] };
		const tokens = [{ type: 'col', id: 1 }, { type: 'text', value: ' @@@ invalid' }];
		const [, valid] = formulacolumn({ tokens, out: preview });
		expect(valid).toBe(false);
	});
});
