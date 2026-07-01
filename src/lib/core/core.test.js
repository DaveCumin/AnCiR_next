import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/core/Column.svelte', () => ({ Column: vi.fn(), getColumnById: vi.fn() }));
vi.mock('$lib/core/Plot.svelte', () => ({ Plot: vi.fn() }));

import {
	core,
	appConsts,
	replaceColumnRefs,
	swapColumnRefs,
	swapColumnRefsBulk,
	createGroup,
	createComposite,
	createNote,
	syncNodeIdCounters
} from '$lib/core/core.svelte';

// ── helpers ──────────────────────────────────────────────────────────
function seedCore({ data = [], tableProcesses = [], plots = [] } = {}) {
	core.data.length = 0;
	data.forEach((d) => core.data.push(d));
	core.tableProcesses.length = 0;
	tableProcesses.forEach((tp) => core.tableProcesses.push(tp));
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

// ── syncNodeIdCounters (session-load id-collision guard) ──────────────
describe('syncNodeIdCounters', () => {
	it('advances the group counter past a loaded id so createGroup cannot collide', () => {
		core.groups.length = 0;
		core.groups.push({ id: 'group_5' }); // as if rehydrated from a session
		syncNodeIdCounters();
		const id = createGroup();
		expect(id).not.toBe('group_5');
		expect(Number(id.replace('group_', ''))).toBeGreaterThan(5);
		// The new group is genuinely unique (didn't overwrite the loaded one).
		expect(core.groups.filter((g) => g.id === id)).toHaveLength(1);
	});

	it('ignores legacy group_legacy_<n> ids (separate namespace)', () => {
		core.groups.length = 0;
		core.groups.push({ id: 'group_legacy_99' });
		syncNodeIdCounters();
		const id = createGroup();
		// A legacy id must not push the plain `group_<n>` counter to 100.
		expect(Number(id.replace('group_', ''))).toBeLessThan(99);
	});

	it('advances the composite counter past a loaded id', () => {
		core.composites.length = 0;
		core.composites.push({ id: 'composite_8' });
		syncNodeIdCounters();
		const id = createComposite({ memberIds: [] });
		expect(id).not.toBe('composite_8');
		expect(Number(id.replace('composite_', ''))).toBeGreaterThan(8);
	});

	it('advances the note counter past a loaded id', () => {
		core.notes.length = 0;
		core.notes.push({ id: 'note_12' });
		syncNodeIdCounters();
		const id = createNote();
		expect(id).not.toBe('note_12');
		expect(Number(id.replace('note_', ''))).toBeGreaterThan(12);
	});

	it('is idempotent and never rewinds the counter', () => {
		core.groups.length = 0;
		const first = createGroup(); // e.g. group_N
		syncNodeIdCounters();
		syncNodeIdCounters();
		const second = createGroup();
		expect(Number(second.replace('group_', ''))).toBeGreaterThan(
			Number(first.replace('group_', ''))
		);
	});
});

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

	it('replaces xIN, yIN, xsIN, and out in free table processes', () => {
		seedCore({
			tableProcesses: [{ args: { xIN: 10, yIN: 20, xsIN: [10, 30], out: { a: 10, b: 40 } } }]
		});
		replaceColumnRefs(99, 10);
		const args = core.tableProcesses[0].args;
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
			tableProcesses: [{ args: { xIN: 10, yIN: 20, out: {} } }]
		});
		swapColumnRefs(10, 20);
		expect(core.data[0].refId).toBe(20);
		expect(core.data[1].refId).toBe(10);
		expect(core.tableProcesses[0].args.xIN).toBe(20);
		expect(core.tableProcesses[0].args.yIN).toBe(10);
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
			tableProcesses: [{ args: { xIN: 10, yIN: 20, out: {} } }]
		});
		swapColumnRefsBulk([[10, 20]]);
		expect(core.data[0].refId).toBe(20);
		expect(core.data[1].refId).toBe(10);
		expect(core.tableProcesses[0].args.xIN).toBe(20);
		expect(core.tableProcesses[0].args.yIN).toBe(10);
	});

	it('swaps multiple independent pairs simultaneously', () => {
		seedCore({
			data: [
				{ id: 1, refId: 10 },
				{ id: 2, refId: 20 },
				{ id: 3, refId: 30 },
				{ id: 4, refId: 40 }
			],
			tableProcesses: [{ args: { xIN: 10, yIN: 30, xsIN: [20, 40], out: {} } }]
		});
		swapColumnRefsBulk([
			[10, 20],
			[30, 40]
		]);
		expect(core.data[0].refId).toBe(20);
		expect(core.data[1].refId).toBe(10);
		expect(core.data[2].refId).toBe(40);
		expect(core.data[3].refId).toBe(30);
		const args = core.tableProcesses[0].args;
		expect(args.xIN).toBe(20);
		expect(args.yIN).toBe(40);
		expect(args.xsIN).toEqual([10, 30]);
	});

	it('swaps across tableProcesses and plots together', () => {
		seedCore({
			data: [
				{ id: 1, refId: 10 },
				{ id: 2, refId: 20 }
			],
			tableProcesses: [{ args: { xIN: 10, yIN: 20, out: { a: 10 } } }],
			plots: [
				{
					type: 'scatter',
					plot: { data: [{ x: { refId: 10 }, y: { refId: 20 } }] }
				}
			]
		});
		swapColumnRefsBulk([[10, 20]]);

		const args = core.tableProcesses[0].args;
		expect(args.xIN).toBe(20);
		expect(args.yIN).toBe(10);
		expect(args.out.a).toBe(20);
		const d = core.plots[0].plot.data[0];
		expect(d.x.refId).toBe(20);
		expect(d.y.refId).toBe(10);
	});
});
