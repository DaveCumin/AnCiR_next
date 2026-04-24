import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/core/Column.svelte', () => ({ Column: vi.fn(), getColumnById: vi.fn() }));
vi.mock('$lib/core/Plot.svelte', () => ({ Plot: vi.fn() }));
vi.mock('$lib/core/Table.svelte', () => ({ Table: vi.fn() }));

import {
	core,
	appConsts,
	replaceColumnRefs,
	swapColumnRefs,
	swapColumnRefsBulk
} from '$lib/core/core.svelte';

// ── helpers ──────────────────────────────────────────────────────────
function seedCore({ data = [], tables = [], plots = [] } = {}) {
	core.data.length = 0;
	data.forEach((d) => core.data.push(d));
	core.tables.length = 0;
	tables.forEach((t) => core.tables.push(t));
	core.plots.length = 0;
	plots.forEach((p) => core.plots.push(p));

	// Seed a minimal tableProcessMap so the ref-rewriting helpers know
	// which arg fields hold column IDs (replaces the old hardcoded lists).
	appConsts.tableProcessMap.clear();
	appConsts.tableProcessMap.set('fake', {
		definition: {
			columnIdFields: { scalar: ['xIN', 'yIN'], array: ['xsIN'] }
		}
	});
}

beforeEach(() => seedCore());

// ── replaceColumnRefs ────────────────────────────────────────────────
describe('replaceColumnRefs', () => {
	it('does nothing when newColId === oldColId', () => {
		seedCore({ data: [{ id: 1, refId: 1 }] });
		replaceColumnRefs(1, 1);
		expect(core.data[0].refId).toBe(1);
	});

	it('replaces refId in core.data', () => {
		seedCore({
			data: [
				{ id: 1, refId: 10 },
				{ id: 2, refId: 20 }
			]
		});
		replaceColumnRefs(99, 10);
		expect(core.data[0].refId).toBe(99);
		expect(core.data[1].refId).toBe(20);
	});

	it('replaces columnRefs in tables', () => {
		seedCore({
			tables: [{ columnRefs: [10, 20, 10], processes: [] }]
		});
		replaceColumnRefs(99, 10);
		expect(core.tables[0].columnRefs).toEqual([99, 20, 99]);
	});

	it('replaces xIN, yIN, xsIN, and out in table processes', () => {
		seedCore({
			tables: [
				{
					columnRefs: [],
					processes: [
						{
							args: { xIN: 10, yIN: 20, xsIN: [10, 30], out: { a: 10, b: 40 } }
						}
					]
				}
			]
		});
		replaceColumnRefs(99, 10);
		const args = core.tables[0].processes[0].args;
		expect(args.xIN).toBe(99);
		expect(args.yIN).toBe(20);
		expect(args.xsIN).toEqual([99, 30]);
		expect(args.out.a).toBe(99);
		expect(args.out.b).toBe(40);
	});

	it('replaces columnRefs in tableplot plots', () => {
		seedCore({
			plots: [{ type: 'tableplot', plot: { columnRefs: [10, 20] } }]
		});
		replaceColumnRefs(99, 10);
		expect(core.plots[0].plot.columnRefs).toEqual([99, 20]);
	});

	it('replaces axis refIds in non-tableplot plots', () => {
		seedCore({
			plots: [
				{
					type: 'scatter',
					plot: {
						data: [{ x: { refId: 10 }, y: { refId: 20 }, z: { refId: 10 } }]
					}
				}
			]
		});
		replaceColumnRefs(99, 10);
		const d = core.plots[0].plot.data[0];
		expect(d.x.refId).toBe(99);
		expect(d.y.refId).toBe(20);
		expect(d.z.refId).toBe(99);
	});
});

// ── swapColumnRefs ───────────────────────────────────────────────────
describe('swapColumnRefs', () => {
	it('does nothing when both IDs are the same', () => {
		seedCore({ data: [{ id: 1, refId: 1 }] });
		swapColumnRefs(1, 1);
		expect(core.data[0].refId).toBe(1);
	});

	it('swaps two column refIds', () => {
		seedCore({
			data: [
				{ id: 1, refId: 10 },
				{ id: 2, refId: 20 }
			],
			tables: [{ columnRefs: [10, 20], processes: [] }]
		});
		swapColumnRefs(10, 20);
		expect(core.data[0].refId).toBe(20);
		expect(core.data[1].refId).toBe(10);
		expect(core.tables[0].columnRefs).toEqual([20, 10]);
	});

	it('handles swap when only one ID is present', () => {
		seedCore({
			data: [
				{ id: 1, refId: 10 },
				{ id: 2, refId: 30 }
			]
		});
		swapColumnRefs(10, 20);
		expect(core.data[0].refId).toBe(20);
		expect(core.data[1].refId).toBe(30);
	});
});

// ── swapColumnRefsBulk ───────────────────────────────────────────────
describe('swapColumnRefsBulk', () => {
	it('does nothing with an empty array', () => {
		seedCore({ data: [{ id: 1, refId: 10 }] });
		swapColumnRefsBulk([]);
		expect(core.data[0].refId).toBe(10);
	});

	it('filters out invalid pairs (same id, negative ids)', () => {
		seedCore({ data: [{ id: 1, refId: 10 }] });
		swapColumnRefsBulk([
			[5, 5],
			[-1, 10],
			[10, -2]
		]);
		expect(core.data[0].refId).toBe(10);
	});

	it('swaps a single pair (same as swapColumnRefs)', () => {
		seedCore({
			data: [
				{ id: 1, refId: 10 },
				{ id: 2, refId: 20 }
			],
			tables: [{ columnRefs: [10, 20], processes: [] }]
		});
		swapColumnRefsBulk([[10, 20]]);
		expect(core.data[0].refId).toBe(20);
		expect(core.data[1].refId).toBe(10);
		expect(core.tables[0].columnRefs).toEqual([20, 10]);
	});

	it('swaps multiple independent pairs simultaneously', () => {
		seedCore({
			data: [
				{ id: 1, refId: 10 },
				{ id: 2, refId: 20 },
				{ id: 3, refId: 30 },
				{ id: 4, refId: 40 }
			],
			tables: [{ columnRefs: [10, 20, 30, 40], processes: [] }]
		});
		swapColumnRefsBulk([
			[10, 20],
			[30, 40]
		]);
		expect(core.data[0].refId).toBe(20);
		expect(core.data[1].refId).toBe(10);
		expect(core.data[2].refId).toBe(40);
		expect(core.data[3].refId).toBe(30);
		expect(core.tables[0].columnRefs).toEqual([20, 10, 40, 30]);
	});

	it('swaps across tables, processes, and plots together', () => {
		seedCore({
			data: [
				{ id: 1, refId: 10 },
				{ id: 2, refId: 20 }
			],
			tables: [
				{
					columnRefs: [10, 20],
					processes: [{ args: { xIN: 10, yIN: 20, out: { a: 10 } } }]
				}
			],
			plots: [
				{
					type: 'scatter',
					plot: { data: [{ x: { refId: 10 }, y: { refId: 20 } }] }
				}
			]
		});
		swapColumnRefsBulk([[10, 20]]);

		expect(core.tables[0].columnRefs).toEqual([20, 10]);
		const args = core.tables[0].processes[0].args;
		expect(args.xIN).toBe(20);
		expect(args.yIN).toBe(10);
		expect(args.out.a).toBe(20);
		const d = core.plots[0].plot.data[0];
		expect(d.x.refId).toBe(20);
		expect(d.y.refId).toBe(10);
	});
});
