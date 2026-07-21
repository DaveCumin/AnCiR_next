// A table process whose output column throws on getData() must be reported as valid:false with
// the failing key + original error — not silently downgraded to an empty output (which hid a
// broken process chain from the agent, returning valid:true with missing/empty outputs).
import { beforeEach, describe, expect, it } from 'vitest';
import { finalizeTableProcessOutputs } from '../src/engine/session.js';
import { core, pushObj } from '$lib/core/core.svelte.js';
import { Column, getColumnById } from '$lib/core/Column.svelte';

function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	pushObj(c);
	return c;
}

beforeEach(() => {
	core.data.length = 0;
	core.tableProcesses.length = 0;
	core.plots.length = 0;
	core.rawData.clear();
});

describe('finalizeTableProcessOutputs — failed output reads', () => {
	it('surfaces a throwing output column as valid:false with the key + original error', () => {
		const good = mkCol('good', [1, 2, 3]);
		const bad = mkCol('bad', [4, 5, 6]);
		// Simulate a broken process chain: reading this output throws.
		bad.getData = () => {
			throw new Error('broken producer chain');
		};
		const tp = { id: 4242, args: { out: { good: good.id, bad: bad.id } } };

		const res = finalizeTableProcessOutputs(tp, 'BrokenProc');

		expect(res.valid).toBe(false);
		expect(res.outputs).toEqual([]);
		expect(res.failedOutputs.map((f) => f.key)).toEqual(['bad']);
		expect(res.failedOutputs[0].columnId).toBe(bad.id);
		expect(res.error).toContain('"bad"');
		expect(res.error).toContain('broken producer chain');
		// The broken node is discarded so it can't pollute the export.
		expect(core.tableProcesses.find((t) => t.id === 4242)).toBeUndefined();
	});

	it('prunes empty columns and serialises the rest on success (getData never throws)', () => {
		const filled = mkCol('filled', [1, 2, 3, 4]);
		const empty = mkCol('empty', []);
		const tp = { id: 7, args: { out: { filled: filled.id, empty: empty.id } } };

		const res = finalizeTableProcessOutputs(tp, 'OkProc');

		expect(res.valid).toBe(true);
		expect(res.outputs.map((o) => o.key)).toEqual(['filled']); // empty column pruned
		expect(tp.args.out.empty).toBeUndefined();
		expect(res.outputs[0].preview).toEqual([1, 2, 3, 4]);
		expect(res.outputs[0].length).toBe(4);
	});

	it('attaches fit / stats to a successful result', () => {
		const filled = mkCol('c', [1, 2]);
		const tp = { id: 9, args: { out: { c: filled.id } } };
		const res = finalizeTableProcessOutputs(tp, 'FitProc', { fit: { period: 24 }, stats: { comparisons: {} } });
		expect(res.valid).toBe(true);
		expect(res.fit).toEqual({ period: 24 });
		expect(res.stats).toEqual({ comparisons: {} });
	});
});
