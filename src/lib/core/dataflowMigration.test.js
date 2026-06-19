// src/lib/core/dataflowMigration.test.js
// @ts-nocheck
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { appConsts, core } from './core.svelte.js';
import { Column } from './Column.svelte';
import { Process } from './Process.svelte';
import { add } from '$lib/processes/Add.svelte';
import { migrateAllInlineProcesses, migrateColumnProcesses } from './dataflowMigration.js';

beforeAll(() => {
	if (!appConsts.processMap.has('Add')) {
		appConsts.processMap.set('Add', {
			displayName: 'Add',
			defaults: new Map([['value', { val: 0 }]]),
			func: add
		});
	}
});

beforeEach(() => {
	core.data.length = 0;
	core.orphanProcesses.length = 0;
	core.rawData.clear();
});

function rawColumn(values, name) {
	const col = new Column({ type: 'number' });
	core.rawData.set(col.id, values);
	col.data = col.id;
	if (name) col.customName = name;
	core.data.push(col);
	return col;
}

describe('Phase 4: migrate inline processes → nodes + producer columns', () => {
	it('migrates a raw column with one process, preserving id and value', () => {
		const c = rawColumn([1, 2, 3], 'hr');
		const id = c.id;
		c.processes.push(new Process({ name: 'Add', args: { value: 5 } }, c));
		expect(c.getData()).toEqual([6, 7, 8]);

		const res = migrateAllInlineProcesses();
		expect(res.migrated).toBe(1);

		// Same column object/id, now a producer with no inline processes.
		expect(c.id).toBe(id);
		expect(c.processes).toHaveLength(0);
		expect(c.producerNodeId).toMatch(/^process_\d+$/);
		// Value preserved exactly.
		expect(c.getData()).toEqual([6, 7, 8]);
		// A raw source sibling carries the original name; the column now derives one.
		expect(core.data.some((x) => x.customName === 'hr' && x.data != null)).toBe(true);
		expect(c.name).toBe('hr → Add');
		// Exactly one free node was created.
		expect(core.orphanProcesses).toHaveLength(1);
	});

	it('migrates a multi-process chain into one node per step', () => {
		const c = rawColumn([10, 20], 'x');
		c.processes.push(new Process({ name: 'Add', args: { value: 1 } }, c));
		c.processes.push(new Process({ name: 'Add', args: { value: 100 } }, c));
		expect(c.getData()).toEqual([111, 121]);

		migrateAllInlineProcesses();
		expect(core.orphanProcesses).toHaveLength(2);
		expect(c.getData()).toEqual([111, 121]);
		expect(c.name).toBe('x → Add → Add');
	});

	it('keeps downstream references valid (consumer sees the same final value)', () => {
		const c = rawColumn([1, 2, 3], 'src');
		c.processes.push(new Process({ name: 'Add', args: { value: 10 } }, c));
		// A ref column pointing at c (a downstream consumer).
		const ref = new Column({ refId: c.id, type: 'number' });
		core.data.push(ref);
		expect(ref.getData()).toEqual([11, 12, 13]);

		migrateAllInlineProcesses();
		// ref still points at c.id; c's value is unchanged → consumer unaffected.
		expect(ref.getData()).toEqual([11, 12, 13]);
	});

	it('defers TP-output and tap columns (left as inline)', () => {
		const tpOut = rawColumn([1, 2], 'out');
		tpOut.tableProcessGUId = 'grp_1';
		tpOut.processes.push(new Process({ name: 'Add', args: { value: 1 } }, tpOut));
		const tap = new Column({ refId: tpOut.id, refUpToProcessId: 999, type: 'number' });
		tap.processes.push(new Process({ name: 'Add', args: { value: 1 } }, tap));
		core.data.push(tap);

		const res = migrateAllInlineProcesses();
		expect(res.migrated).toBe(0);
		expect(res.deferred).toBe(2);
		// Still inline — nothing became invisible.
		expect(tpOut.processes).toHaveLength(1);
		expect(tap.processes).toHaveLength(1);
	});

	it('is a no-op for a session with no inline processes', () => {
		rawColumn([1, 2, 3], 'a');
		const res = migrateAllInlineProcesses();
		expect(res).toEqual({ migrated: 0, deferred: 0 });
	});
});
