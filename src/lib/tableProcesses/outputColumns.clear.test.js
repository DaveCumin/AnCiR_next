// clearOutputColumns empties a failed node's outputs (ROB-11) so downstream consumers stop
// reading the previous inputs' results.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fakeCore } = vi.hoisted(() => ({
	fakeCore: { data: [], rawData: new Map(), tables: [], plots: [] }
}));
vi.mock('$lib/core/core.svelte', () => ({ core: fakeCore, appConsts: {}, appState: {} }));
vi.mock('$lib/core/core.svelte.js', () => ({ core: fakeCore, appConsts: {}, appState: {} }));

const columns = new Map();
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => columns.get(id) }));

const { writeOutputColumn, clearOutputColumns } = await import('./outputColumns.js');

beforeEach(() => {
	columns.clear();
	fakeCore.rawData.clear();
	for (const id of [10, 11, 12]) {
		columns.set(id, { id, data: null, type: 'number', tableProcessGUId: null });
		writeOutputColumn(id, [1, 2, 3], { processHash: 'old' });
	}
});

describe('clearOutputColumns', () => {
	it('empties every wired output, under one new stamp', () => {
		const n = clearOutputColumns(
			{ x: 10, y_1: 11, period: 12, unwired: -1, gone: 99 },
			{ processHash: 'new' }
		);
		expect(n).toBe(3);
		for (const id of [10, 11, 12]) expect(fakeCore.rawData.get(id)).toEqual([]);
		const stamps = new Set([10, 11, 12].map((id) => columns.get(id).tableProcessGUId));
		expect([...stamps]).toEqual(['new']);
	});

	it('tolerates a missing out map', () => {
		expect(clearOutputColumns(undefined)).toBe(0);
	});
});
