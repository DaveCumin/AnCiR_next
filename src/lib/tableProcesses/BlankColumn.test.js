import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData: new Map(), storedValues: {} },
	getStoredValue: vi.fn()
}));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: vi.fn() }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));

import { blankcolumn } from './BlankColumn.svelte';

// Preview mode: out.result === -1

describe('blankcolumn', () => {
	it('creates N empty (NaN) cells in preview mode', () => {
		const [result, valid] = blankcolumn({ N: 5, storedValueRefs: {}, out: { result: -1 } });
		expect(valid).toBe(true);
		expect(result).toHaveLength(5);
		// Empty cells are NaN (numeric-empty), not '' — the editing grid uses '' only
		// as its string sentinel and commits NaN for numeric columns.
		result.forEach((v) => expect(v).toBeNaN());
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
