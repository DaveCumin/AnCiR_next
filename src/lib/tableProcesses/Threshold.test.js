import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: new Map(), tableProcesses: [] } }));
vi.mock('$lib/core/Column.svelte', () => ({
	getColumnById: (id) => mockColumns[id],
	Column: class {}
}));
vi.mock('$lib/components/inputs/ColumnSelector.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));

import { thresholddata } from './Threshold.svelte';
import { core } from '$lib/core/core.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	core.rawData.clear();
});

const outCol = () => ({ type: 'number', data: -1 });

describe('thresholddata', () => {
	it('is invalid with no input column', () => {
		expect(thresholddata({ xIN: -1, threshold: 0, comparison: '>=', out: {} })[1]).toBe(false);
	});

	it('binarises with >= (default), inclusive of the cutoff', () => {
		mockColumns[1] = { type: 'number', getData: () => [-2, 0, 1, 5] };
		mockColumns[9] = outCol();
		const [result, valid] = thresholddata({ xIN: 1, threshold: 0, comparison: '>=', out: { binary: 9 } });
		expect(valid).toBe(true);
		expect(result).toEqual([0, 1, 1, 1]); // 0 satisfies >= 0
		expect(core.rawData.get(9)).toEqual([0, 1, 1, 1]);
		expect(mockColumns[9].type).toBe('number');
	});

	it('each comparison operator picks the right side', () => {
		mockColumns[1] = { type: 'number', getData: () => [1, 2, 3] };
		mockColumns[9] = outCol();
		const run = (comparison, threshold) =>
			thresholddata({ xIN: 1, threshold, comparison, out: { binary: 9 } })[0];
		expect(run('>', 2)).toEqual([0, 0, 1]); // strictly above 2
		expect(run('>=', 2)).toEqual([0, 1, 1]);
		expect(run('<', 2)).toEqual([1, 0, 0]);
		expect(run('<=', 2)).toEqual([1, 1, 0]);
	});

	it('missing / non-numeric values stay MISSING, never a spurious 0', () => {
		mockColumns[1] = { type: 'number', getData: () => [1, null, '', NaN, 'x', 5] };
		mockColumns[9] = outCol();
		const [result] = thresholddata({ xIN: 1, threshold: 0, comparison: '>=', out: { binary: 9 } });
		expect(result).toEqual([1, null, null, null, null, 1]);
	});

	it('an unknown comparison falls back to >=', () => {
		mockColumns[1] = { type: 'number', getData: () => [-1, 0, 1] };
		mockColumns[9] = outCol();
		const [result] = thresholddata({ xIN: 1, threshold: 0, comparison: 'nonsense', out: { binary: 9 } });
		expect(result).toEqual([0, 1, 1]);
	});
});
