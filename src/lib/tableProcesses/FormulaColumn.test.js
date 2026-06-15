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

	// --- Added edge cases ---

	it('fails safe (no throw, invalid) when a referenced column is missing', () => {
		// col 99 absent from mockColumns
		const tokens = [{ type: 'col', id: 99 }, { type: 'text', value: ' + 1' }];
		expect(() => formulacolumn({ tokens, out: preview })).not.toThrow();
		const [, valid] = formulacolumn({ tokens, out: preview });
		expect(valid).toBe(false);
	});

	it('fails safe when a referenced stored value is missing', () => {
		mockColumns[1] = { getData: () => [1, 2] };
		const tokens = [
			{ type: 'col', id: 1 },
			{ type: 'text', value: ' * ' },
			{ type: 'stored', key: 'absent' }
		];
		const [, valid] = formulacolumn({ tokens, out: preview });
		expect(valid).toBe(false);
	});

	it('divide-by-zero yields Infinity rather than throwing', () => {
		mockColumns[1] = { getData: () => [1, 2, 3] };
		const tokens = [{ type: 'col', id: 1 }, { type: 'text', value: ' / 0' }];
		const [result, valid] = formulacolumn({ tokens, out: preview });
		expect(valid).toBe(true);
		expect(result).toEqual([Infinity, Infinity, Infinity]);
	});

	it('supports Math functions in the expression', () => {
		mockColumns[1] = { getData: () => [1, 4, 9] };
		const tokens = [{ type: 'text', value: 'Math.sqrt(' }, { type: 'col', id: 1 }, { type: 'text', value: ')' }];
		const [result, valid] = formulacolumn({ tokens, out: preview });
		expect(valid).toBe(true);
		expect(result).toEqual([1, 2, 3]);
	});

	it('returns invalid for an empty source column', () => {
		mockColumns[1] = { getData: () => [] };
		const tokens = [{ type: 'col', id: 1 }, { type: 'text', value: ' + 1' }];
		const [, valid] = formulacolumn({ tokens, out: preview });
		expect(valid).toBe(false);
	});

	it('propagates NaN from NaN source cells', () => {
		mockColumns[1] = { getData: () => [1, NaN, 3] };
		const tokens = [{ type: 'col', id: 1 }, { type: 'text', value: ' + 1' }];
		const [result, valid] = formulacolumn({ tokens, out: preview });
		expect(valid).toBe(true);
		expect(result[0]).toBe(2);
		expect(Number.isNaN(result[1])).toBe(true);
		expect(result[2]).toBe(4);
	});

	it('uses the first column length even when columns differ in length (off-by-one)', () => {
		mockColumns[1] = { getData: () => [1, 2, 3] }; // length 3 drives the loop
		mockColumns[2] = { getData: () => [10, 20] }; // shorter → index 2 is undefined → NaN
		const tokens = [
			{ type: 'col', id: 1 },
			{ type: 'text', value: ' + ' },
			{ type: 'col', id: 2 }
		];
		const [result, valid] = formulacolumn({ tokens, out: preview });
		expect(valid).toBe(true);
		expect(result.length).toBe(3);
		expect(result[0]).toBe(11);
		expect(result[1]).toBe(22);
		expect(Number.isNaN(result[2])).toBe(true); // 3 + undefined
	});

	it('reusing the same column twice references it once internally', () => {
		mockColumns[1] = { getData: () => [2, 3] };
		const tokens = [
			{ type: 'col', id: 1 },
			{ type: 'text', value: ' * ' },
			{ type: 'col', id: 1 }
		];
		const [result] = formulacolumn({ tokens, out: preview });
		expect(result).toEqual([4, 9]);
	});

	it('writes to the committed output column and tags type number', async () => {
		const { core } = await import('$lib/core/core.svelte');
		core.rawData.set.mockClear();
		mockColumns[1] = { getData: () => [1, 2] };
		mockColumns[5] = { data: null, type: null, tableProcessGUId: null };
		const tokens = [{ type: 'col', id: 1 }, { type: 'text', value: ' + 10' }];

		const [, valid] = formulacolumn({ tokens, out: { result: 5 } });
		expect(valid).toBe(true);
		const call = core.rawData.set.mock.calls.find(([id]) => id === 5);
		expect(call[1]).toEqual([11, 12]);
		expect(mockColumns[5].type).toBe('number');
		expect(mockColumns[5].tableProcessGUId).toBeTruthy();
	});

	it('classifies a string-producing formula as category type', async () => {
		const { core } = await import('$lib/core/core.svelte');
		mockColumns[1] = { getData: () => [1, 2] };
		mockColumns[6] = { data: null, type: null, tableProcessGUId: null };
		const tokens = [
			{ type: 'text', value: '"row" + ' },
			{ type: 'col', id: 1 }
		];
		const [result, valid] = formulacolumn({ tokens, out: { result: 6 } });
		expect(valid).toBe(true);
		expect(result).toEqual(['row1', 'row2']);
		expect(mockColumns[6].type).toBe('category');
	});
});
