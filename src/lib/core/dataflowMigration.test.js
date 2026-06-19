// src/lib/core/dataflowMigration.test.js
// @ts-nocheck
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { appConsts, core } from './core.svelte.js';
import { Column } from './Column.svelte';
import { Process } from './Process.svelte';
import { add } from '$lib/processes/Add.svelte';
import { migrateAllInlineProcesses } from './dataflowMigration.js';

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

// The derived column produced by migrating `srcName`'s pipeline (by name).
function derivedNamed(name) {
	return core.data.find((c) => c.producerNodeId != null && c.name === name);
}

describe('Phase 4: migrate inline processes → nodes + producer columns', () => {
	it('keeps the column as the source and derives the processed result', () => {
		const c = rawColumn([1, 2, 3], 'hr');
		const id = c.id;
		c.processes.push(new Process({ name: 'Add', args: { value: 5 } }, c));

		const res = migrateAllInlineProcesses();
		expect(res.migrated).toBe(1);

		// The column keeps its id + raw identity, minus the inline pipeline.
		expect(c.id).toBe(id);
		expect(c.processes).toHaveLength(0);
		expect(c.producerNodeId).toBeNull();
		expect(c.getData()).toEqual([1, 2, 3]); // source is the raw value
		// The processed value lives in a derived column nested under it.
		const d = derivedNamed('hr → Add');
		expect(d).toBeTruthy();
		expect(d.getData()).toEqual([6, 7, 8]);
		expect(core.orphanProcesses).toHaveLength(1);
	});

	it('migrates a multi-process chain into one node per step', () => {
		const c = rawColumn([10, 20], 'x');
		c.processes.push(new Process({ name: 'Add', args: { value: 1 } }, c));
		c.processes.push(new Process({ name: 'Add', args: { value: 100 } }, c));

		migrateAllInlineProcesses();
		expect(core.orphanProcesses).toHaveLength(2);
		expect(c.getData()).toEqual([10, 20]); // source unchanged
		const final = derivedNamed('x → Add → Add');
		expect(final.getData()).toEqual([111, 121]);
	});

	it('repoints existing consumers to the final derived column', () => {
		const c = rawColumn([1, 2, 3], 'src');
		c.processes.push(new Process({ name: 'Add', args: { value: 10 } }, c));
		const ref = new Column({ refId: c.id, type: 'number' });
		core.data.push(ref);
		expect(ref.getData()).toEqual([11, 12, 13]);

		migrateAllInlineProcesses();
		// ref was repointed from c to the derived column; still the processed value.
		expect(ref.refId).not.toBe(c.id);
		expect(ref.getData()).toEqual([11, 12, 13]);
	});

	it('migrates a TP-output column (the deferred case is now handled)', () => {
		const tpOut = rawColumn([2, 4], 'result_0');
		tpOut.tableProcessGUId = 'grp_1';
		tpOut.processes.push(new Process({ name: 'Add', args: { value: 1 } }, tpOut));

		const res = migrateAllInlineProcesses();
		expect(res.migrated).toBe(1);
		expect(tpOut.tableProcessGUId).toBe('grp_1'); // still a TP output
		expect(tpOut.processes).toHaveLength(0);
		expect(derivedNamed('result_0 → Add').getData()).toEqual([3, 5]);
	});

	it('re-anchors a tap column to the producer column for its step', () => {
		const x = rawColumn([10, 20, 30], 'X');
		const p1 = new Process({ name: 'Add', args: { value: 1 } }, x);
		const p2 = new Process({ name: 'Add', args: { value: 100 } }, x);
		x.processes.push(p1, p2);
		// A tap onto X after the first process.
		const tap = new Column({ refId: x.id, refUpToProcessId: p1.id, type: 'number' });
		core.data.push(tap);
		expect(tap.getData()).toEqual([11, 21, 31]);

		migrateAllInlineProcesses();
		// Tap now references the producer column for step p1; value preserved.
		expect(tap.refUpToProcessId).toBeNull();
		expect(tap.isTap).toBe(false);
		expect(tap.getData()).toEqual([11, 21, 31]);
	});

	it('is a no-op for a session with no inline processes', () => {
		rawColumn([1, 2, 3], 'a');
		expect(migrateAllInlineProcesses()).toEqual({ migrated: 0 });
	});
});
