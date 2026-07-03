import { describe, it, expect, vi, beforeEach } from 'vitest';

// Registry of columns by id + an id counter for newly-created output columns.
const { mockColumns, state, coreMock, pushObjMock } = vi.hoisted(() => {
	const mockColumns = {};
	return {
		mockColumns,
		state: { nextId: 100 },
		coreMock: {
			tableProcesses: [{ id: 1 }], // makes isCommitted() true for p.id === 1
			rawData: { delete: () => {} },
			data: []
		},
		pushObjMock: (col) => {
			mockColumns[col.id] = col;
		}
	};
});

vi.mock('$lib/core/core.svelte', () => ({ core: coreMock, pushObj: pushObjMock }));
vi.mock('$lib/core/core.svelte.js', () => ({ core: coreMock, pushObj: pushObjMock }));
vi.mock('$lib/core/Column.svelte', () => ({
	getColumnById: (id) => mockColumns[id],
	removeColumn: vi.fn(),
	Column: class {
		constructor() {
			this.id = state.nextId++;
			this.name = '';
		}
	}
}));

import { useMultiYTP } from './useMultiYTP.svelte.js';
import { removeColumn } from '$lib/core/Column.svelte';

beforeEach(() => {
	for (const k of Object.keys(mockColumns)) delete mockColumns[k];
	state.nextId = 100;
	removeColumn.mockClear();
	// Seed the input columns A(10), B(11), C(12).
	mockColumns[10] = { id: 10, name: 'A' };
	mockColumns[11] = { id: 11, name: 'B' };
	mockColumns[12] = { id: 12, name: 'C' };
});

function makeP(yIN) {
	return { id: 1, parent: null, args: { yIN: [...yIN], out: {} } };
}

describe('useMultiYTP.syncYColumns', () => {
	it('creates one output column per Y via initYColumns', () => {
		const p = makeP([10]);
		const { initYColumns } = useMultiYTP(p, 'y_', 'out_');
		const changed = initYColumns();
		expect(changed).toBe(true);
		expect(p.args.out.y_10).toBe(100);
		expect(mockColumns[100].name).toBe('out_A');
	});

	it('REUSES the output column id when a Y input is swapped in place', () => {
		const p = makeP([10]);
		const { initYColumns, syncYColumns } = useMultiYTP(p, 'y_', 'out_');
		initYColumns();
		const originalId = p.args.out.y_10; // 100

		// Swap the single Y from A(10) → B(11), as an upstream splice would.
		p.args.yIN = [11];
		const changed = syncYColumns();

		expect(changed).toBe(true);
		// Same column id, now keyed under the new Y, renamed — NOT destroyed.
		expect(p.args.out.y_10).toBeUndefined();
		expect(p.args.out.y_11).toBe(originalId);
		expect(mockColumns[originalId].name).toBe('out_B');
		expect(removeColumn).not.toHaveBeenCalled();
	});

	it('creates a new column when a Y is ADDED (no reuse source)', () => {
		const p = makeP([11]);
		const { initYColumns, syncYColumns } = useMultiYTP(p, 'y_', 'out_');
		initYColumns();
		const bId = p.args.out.y_11;

		p.args.yIN = [11, 12];
		syncYColumns();

		expect(p.args.out.y_11).toBe(bId); // unchanged
		expect(p.args.out.y_12).toBeGreaterThanOrEqual(100);
		expect(p.args.out.y_12).not.toBe(bId);
		expect(removeColumn).not.toHaveBeenCalled();
	});

	it('deletes the column when a Y is REMOVED (no reuse target)', () => {
		const p = makeP([11, 12]);
		const { initYColumns, syncYColumns } = useMultiYTP(p, 'y_', 'out_');
		initYColumns();
		const cId = p.args.out.y_12;

		p.args.yIN = [11];
		syncYColumns();

		expect(p.args.out.y_12).toBeUndefined();
		expect(removeColumn).toHaveBeenCalledWith(cId);
	});

	it('does not materialise columns for an uncommitted (preview) process', () => {
		const p = { id: 999, parent: null, args: { yIN: [10], out: {} } }; // id not in core.tableProcesses
		const { initYColumns } = useMultiYTP(p, 'y_', 'out_');
		expect(initYColumns()).toBe(false);
		expect(p.args.out.y_10).toBeUndefined();
	});
});
