import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: { set: vi.fn(), get: vi.fn(), has: vi.fn() } } }));
vi.mock('$lib/core/Column.svelte', () => ({
	getColumnById: (id) => mockColumns[id],
	removeColumn: vi.fn()
}));
vi.mock('$lib/components/plotbits/Table.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/ColumnSelector.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/utils/time/TimeUtils', () => ({ formatTimeFromUNIX: vi.fn() }));

import { duplicate } from './Duplicate.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
});

describe('duplicate', () => {
	it('returns invalid when xIN is -1', () => {
		const [result, valid] = duplicate({ xIN: -1, out: { result: -1 } });
		expect(valid).toBe(false);
		expect(result).toHaveLength(0);
	});

	it('returns invalid when xIN is undefined', () => {
		const [result, valid] = duplicate({ out: { result: -1 } });
		expect(valid).toBe(false);
	});

	it('returns data from the input column in preview mode', () => {
		mockColumns[10] = { getData: () => [1, 2, 3], type: 'number' };
		const [result, valid] = duplicate({ xIN: 10, out: { result: -1 } });
		expect(valid).toBe(true);
		expect(result).toEqual([1, 2, 3]);
	});

	it('returns valid=false for an empty column', () => {
		mockColumns[10] = { getData: () => [], type: 'number' };
		const [, valid] = duplicate({ xIN: 10, out: { result: -1 } });
		expect(valid).toBe(false);
	});
});
