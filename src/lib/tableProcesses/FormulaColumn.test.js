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
		const tokens = [
			{ type: 'col', id: 1 },
			{ type: 'text', value: ' @@@ invalid' }
		];
		const [, valid] = formulacolumn({ tokens, out: preview });
		expect(valid).toBe(false);
	});

	// --- Added edge cases ---

	it('fails safe (no throw, invalid) when a referenced column is missing', () => {
		// col 99 absent from mockColumns
		const tokens = [
			{ type: 'col', id: 99 },
			{ type: 'text', value: ' + 1' }
		];
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

	it('divide-by-zero yields a missing cell (null), not Infinity, and does not throw', () => {
		mockColumns[1] = { getData: () => [1, 2, 3] };
		const tokens = [
			{ type: 'col', id: 1 },
			{ type: 'text', value: ' / 0' }
		];
		const [result, valid] = formulacolumn({ tokens, out: preview });
		expect(valid).toBe(true);
		// A non-finite result is missing: Infinity would poison means, fits and plot axes.
		expect(result).toEqual([null, null, null]);
	});

	it('supports Math functions in the expression', () => {
		mockColumns[1] = { getData: () => [1, 4, 9] };
		const tokens = [
			{ type: 'text', value: 'Math.sqrt(' },
			{ type: 'col', id: 1 },
			{ type: 'text', value: ')' }
		];
		const [result, valid] = formulacolumn({ tokens, out: preview });
		expect(valid).toBe(true);
		expect(result).toEqual([1, 2, 3]);
	});

	it('returns invalid for an empty source column', () => {
		mockColumns[1] = { getData: () => [] };
		const tokens = [
			{ type: 'col', id: 1 },
			{ type: 'text', value: ' + 1' }
		];
		const [, valid] = formulacolumn({ tokens, out: preview });
		expect(valid).toBe(false);
	});

	it('treats a NaN source cell as missing (null out)', () => {
		mockColumns[1] = { getData: () => [1, NaN, 3] };
		const tokens = [
			{ type: 'col', id: 1 },
			{ type: 'text', value: ' + 1' }
		];
		const [result, valid] = formulacolumn({ tokens, out: preview });
		expect(valid).toBe(true);
		expect(result[0]).toBe(2);
		expect(result[1]).toBeNull();
		expect(result[2]).toBe(4);
	});

	it('uses the first column length even when columns differ in length (off-by-one)', () => {
		mockColumns[1] = { getData: () => [1, 2, 3] }; // length 3 drives the loop
		mockColumns[2] = { getData: () => [10, 20] }; // shorter: index 2 is past the end, so missing
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
		expect(result[2]).toBeNull(); // 3 + (missing) is missing
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
		const tokens = [
			{ type: 'col', id: 1 },
			{ type: 'text', value: ' + 10' }
		];

		const [, valid] = formulacolumn({ tokens, out: { result: 5 } });
		expect(valid).toBe(true);
		const call = core.rawData.set.mock.calls.find(([id]) => id === 5);
		expect(call[1]).toEqual([11, 12]);
		expect(mockColumns[5].type).toBe('number');
		expect(mockColumns[5].tableProcessGUId).toBeTruthy();
	});

	it('refuses string literals (the grammar is numeric) and writes a number column', async () => {
		mockColumns[1] = { getData: () => [1, 2] };
		mockColumns[6] = { data: null, type: null, tableProcessGUId: null };
		const [result, valid, error] = formulacolumn({
			tokens: [
				{ type: 'text', value: '"row" + ' },
				{ type: 'col', id: 1 }
			],
			out: { result: 6 }
		});
		expect(valid).toBe(false);
		expect(result).toEqual([]);
		expect(error).toMatch(/Unexpected character/);

		formulacolumn({
			tokens: [
				{ type: 'col', id: 1 },
				{ type: 'text', value: ' + 1' }
			],
			out: { result: 6 }
		});
		expect(mockColumns[6].type).toBe('number');
	});
});

// --- Review fixes: SEC-1 (code injection), STAT-8 (^ and log), STAT-6 (missing cells) ---
describe('formulacolumn: fixed grammar, no code execution (SEC-1)', () => {
	it('does not execute JavaScript smuggled in a text token, and refuses the formula', () => {
		mockColumns[1] = { getData: () => [1, 2] };
		delete globalThis.__pwned;
		const tokens = [
			{ type: 'col', id: 1 },
			{ type: 'text', value: '" + ((globalThis.__pwned=1), 0) + "' }
		];
		const [result, valid, error] = formulacolumn({ tokens, out: preview });
		expect(globalThis.__pwned).toBeUndefined();
		expect(valid).toBe(false);
		expect(result).toEqual([]);
		expect(error).toMatch(/Unexpected character/);
	});

	it('refuses an expression-only payload (comma operator and assignment)', () => {
		mockColumns[1] = { getData: () => [1, 2] };
		delete globalThis.__pwned;
		const tokens = [
			{ type: 'text', value: '(globalThis.__pwned=1, ' },
			{ type: 'col', id: 1 },
			{ type: 'text', value: ')' }
		];
		const [, valid, error] = formulacolumn({ tokens, out: preview });
		expect(globalThis.__pwned).toBeUndefined();
		expect(valid).toBe(false);
		expect(error).toBeTruthy();
	});

	it('refuses property access and unknown identifiers', () => {
		mockColumns[1] = { getData: () => [1, 2] };
		for (const value of [' + constructor', '.constructor', ' + window', ' + Math.random()']) {
			const [, valid, error] = formulacolumn({
				tokens: [
					{ type: 'col', id: 1 },
					{ type: 'text', value }
				],
				out: preview
			});
			expect(valid, value).toBe(false);
			expect(error, value).toBeTruthy();
		}
	});
});

describe('formulacolumn: operators and functions (STAT-8)', () => {
	const run = (text, data = [1, 2, 3]) => {
		mockColumns[1] = { getData: () => data };
		return formulacolumn({
			tokens: [
				{ type: 'text', value: text[0] },
				{ type: 'col', id: 1 },
				{ type: 'text', value: text[1] }
			],
			out: preview
		});
	};

	it('^ is power, not XOR', () => {
		const [result, valid] = run(['', '^2'], [3, 2.5, -2]);
		expect(valid).toBe(true);
		expect(result).toEqual([9, 6.25, 4]);
	});

	it('the documented log(x) works and is the natural log', () => {
		const [result, valid] = run(['log(', ')'], [1, Math.E, Math.E ** 2]);
		expect(valid).toBe(true);
		expect(result[0]).toBe(0);
		expect(result[1]).toBeCloseTo(1, 12);
		expect(result[2]).toBeCloseTo(2, 12);
	});

	it('unary minus binds looser than ^ on its left (-x^2 = -(x^2))', () => {
		const [result] = run(['-', '^2'], [3]);
		expect(result).toEqual([-9]);
	});
});

describe('formulacolumn: missing cells stay missing (STAT-6)', () => {
	it('a null or blank input cell gives a null output cell, never 0', () => {
		mockColumns[1] = { getData: () => [1, null, 3, '', undefined, NaN] };
		const tokens = [
			{ type: 'col', id: 1 },
			{ type: 'text', value: ' * 2' }
		];
		const [result, valid] = formulacolumn({ tokens, out: preview });
		expect(valid).toBe(true);
		expect(result).toEqual([2, null, 6, null, null, null]);
	});
});
