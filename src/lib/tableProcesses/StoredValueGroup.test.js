import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockColumns, mockRawDataSet, mockStoredValues } = vi.hoisted(() => ({
	mockColumns: {},
	mockRawDataSet: vi.fn(),
	mockStoredValues: {}
}));

vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData: { set: mockRawDataSet }, storedValues: mockStoredValues },
	getStoredValue: (name) => {
		const entry = mockStoredValues[name];
		if (!entry) return NaN;
		if (typeof entry.getter === 'function') return entry.getter();
		return entry.staticValue ?? NaN;
	}
}));

vi.mock('$lib/core/Column.svelte', () => ({
	getColumnById: (id) => mockColumns[id],
	removeColumn: vi.fn()
}));

vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));

import { storedvaluegroup } from './StoredValueGroup.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	Object.keys(mockStoredValues).forEach((k) => delete mockStoredValues[k]);
	mockRawDataSet.mockClear();
});

describe('storedvaluegroup', () => {
	it('returns invalid for empty groups', () => {
		const [, valid] = storedvaluegroup({ groups: [], out: {} });
		expect(valid).toBe(false);
	});

	it('builds grouped values in preview mode', () => {
		mockStoredValues.a = { getter: () => 1.25, source: 'Cosinor' };
		mockStoredValues.b = { getter: () => 2.5, source: 'Trend' };

		const [result, valid] = storedvaluegroup({
			groups: [
				{ id: 'g1', name: 'A', keys: ['a'] },
				{ id: 'g2', name: 'B', keys: ['b'] }
			],
			out: {}
		});

		expect(valid).toBe(true);
		expect(result.groups.g1.values).toEqual([1.25]);
		expect(result.groups.g2.values).toEqual([2.5]);
		expect(result.category).toEqual(['A', 'B']);
		expect(result.value).toEqual([1.25, 2.5]);
	});

	it('writes per-group columns only', () => {
		mockStoredValues.a = { getter: () => 3, source: 'Cosinor' };
		mockStoredValues.b = { getter: () => 4, source: 'Cosinor' };
		mockColumns[102] = { data: null, type: null, tableProcessGUId: null };

		const [, valid] = storedvaluegroup({
			groups: [{ id: 'g1', name: 'Group 1', keys: ['a', 'b'] }],
			out: { value: 100, category: 101, group_g1: 102 }
		});

		expect(valid).toBe(true);
		expect(mockRawDataSet).toHaveBeenCalledWith(102, [3, 4]);
		expect(mockColumns[102].type).toBe('number');
		expect(mockRawDataSet).not.toHaveBeenCalledWith(100, [3, 4]);
		expect(mockRawDataSet).not.toHaveBeenCalledWith(101, ['Group 1', 'Group 1']);
	});

	it('ignores missing and non-finite values', () => {
		mockStoredValues.ok = { getter: () => 2.2, source: 'Cosinor' };
		mockStoredValues.bad = { getter: () => NaN, source: 'Cosinor' };

		const [result, valid] = storedvaluegroup({
			groups: [{ id: 'g1', name: 'A', keys: ['ok', 'missing', 'bad'] }],
			out: {}
		});

		expect(valid).toBe(true);
		expect(result.groups.g1.values).toEqual([2.2]);
		expect(result.value).toEqual([2.2]);
	});
});
