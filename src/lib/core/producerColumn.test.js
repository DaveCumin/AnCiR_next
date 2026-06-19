// src/lib/core/producerColumn.test.js
// @ts-nocheck
//
// Foundation slice for the "columns are just node outputs" model. Proves that a
// Column can source its value from a free process node (living in
// core.orphanProcesses) via producerNodeId/producerPort, instead of owning a
// processes[] chain — and that the producer fields round-trip through JSON.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { appConsts, core } from './core.svelte.js';
import { Column } from './Column.svelte';
import { Process } from './Process.svelte';
import { add } from '$lib/processes/Add.svelte';

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

/** Make a raw numeric source column holding `values`. */
function makeSourceColumn(values) {
	const col = new Column({ type: 'number' });
	core.rawData.set(col.id, values);
	col.data = col.id;
	core.data.push(col);
	return col;
}

/** Make a free Add process node that consumes `inputCol` and adds `value`. */
function makeFreeAdd(inputCol, value) {
	const proc = new Process({ name: 'Add', args: { value, inIN: inputCol.id } }, null);
	core.orphanProcesses.push(proc);
	return proc;
}

/** Make a producer-sourced output column fed by `proc`. */
function makeProducerColumn(proc) {
	return new Column({
		type: 'number',
		producerNodeId: `process_${proc.id}`,
		producerPort: 'output',
		producerArtifactKind: 'column'
	});
}

describe('producer-sourced columns (dataflow model)', () => {
	it('computes its value as the output of a free process node', () => {
		const input = makeSourceColumn([10, 20, 30]);
		const proc = makeFreeAdd(input, 5);
		const out = makeProducerColumn(proc);
		core.data.push(out);

		expect(input.getData()).toEqual([10, 20, 30]);
		expect(out.getData()).toEqual([15, 25, 35]);
		// The operation lives free, not on the output column.
		expect(out.processes).toHaveLength(0);
		expect(core.orphanProcesses).toHaveLength(1);
	});

	it('re-derives when the producing node\'s arg changes (cache busts)', () => {
		const input = makeSourceColumn([1, 2, 3]);
		const proc = makeFreeAdd(input, 1);
		const out = makeProducerColumn(proc);
		core.data.push(out);

		expect(out.getData()).toEqual([2, 3, 4]);
		proc.args.value = 100;
		expect(out.getData()).toEqual([101, 102, 103]);
	});

	it('re-derives when the upstream input column changes', () => {
		const input = makeSourceColumn([0, 0]);
		const proc = makeFreeAdd(input, 7);
		const out = makeProducerColumn(proc);
		core.data.push(out);

		expect(out.getData()).toEqual([7, 7]);
		core.rawData.set(input.id, [1, 2, 3]);
		input.rawDataVersion++; // signal a direct rawData mutation, as the app does
		expect(out.getData()).toEqual([8, 9, 10]);
	});

	it('round-trips the producer fields through toJSON/fromJSON and still resolves', () => {
		const input = makeSourceColumn([10, 20, 30]);
		const proc = makeFreeAdd(input, 5);
		const out = makeProducerColumn(proc);

		const json = out.toJSON();
		expect(json.producerNodeId).toBe(`process_${proc.id}`);
		expect(json.producerPort).toBe('output');
		expect(json.producerArtifactKind).toBe('column');
		expect(json.data ?? null).toBeNull(); // not a raw-data column

		const rebuilt = Column.fromJSON(json);
		expect(rebuilt.producerNodeId).toBe(`process_${proc.id}`);
		core.data.push(rebuilt);
		// Same orphan process + input column still in core, so it resolves.
		expect(rebuilt.getData()).toEqual([15, 25, 35]);
	});

	it('degrades to [] for a broken producer reference', () => {
		const out = new Column({
			type: 'number',
			producerNodeId: 'process_9999',
			producerPort: 'output',
			producerArtifactKind: 'column'
		});
		core.data.push(out);
		expect(out.getData()).toEqual([]);
	});

	it('does not disturb legacy raw + processes[] columns', () => {
		// A normal column with an owned Add process still works exactly as before.
		const col = makeSourceColumn([1, 2, 3]);
		const p = new Process({ name: 'Add', args: { value: 10 } }, col);
		col.processes.push(p);
		expect(col.getData()).toEqual([11, 12, 13]);
		expect(col.producerNodeId).toBeNull();
	});
});
