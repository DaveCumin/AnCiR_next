// The invariant: an output column naming an input the node no longer has is orphaned.
//
// Reported 2026-07-29: delete the WIRE into a node and its output ports, columns and
// plotted data all stayed. disconnectInputPort cleared the port and returned without
// touching args.out; the node's own syncYColumns() could not cover it because that
// runs from an $effect, and a collapsed node never mounts its editor.
//
// These are pure-function tests on purpose — the whole point of centralising this is
// that the rule holds without any component being alive to run it.
import { describe, it, expect } from 'vitest';
import {
	liveInputIds,
	orphanedOutputKeys,
	reconcileOutputs,
	PER_INPUT_PREFIXES
} from './reconcileOutputs.js';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const tp = (args) => ({ id: 1, name: 'SmoothedData', args });

describe('liveInputIds', () => {
	it('reads scalar and array *IN ports', () => {
		expect([...liveInputIds(tp({ xIN: 3, yIN: [4, 5] }))].sort()).toEqual([3, 4, 5]);
	});

	it('reads the bespoke input arrays too', () => {
		// CollectColumns names its outputs col_<id> off colIds, not yIN. Missing this
		// would declare every one of its outputs orphaned.
		expect([...liveInputIds(tp({ colIds: [7], valueColIds: [8] }))].sort()).toEqual([7, 8]);
	});

	it('ignores unwired ports', () => {
		expect([...liveInputIds(tp({ xIN: -1, yIN: [] }))]).toEqual([]);
	});
});

describe('orphanedOutputKeys', () => {
	it('flags a per-Y output whose Y is gone — the reported case', () => {
		// After the wire is deleted, yIN is [] but the out key survives.
		const node = tp({ yIN: [], out: { smoothedy_12: 99, resid_12: 100 } });
		expect(orphanedOutputKeys(node).sort()).toEqual(['resid_12', 'smoothedy_12']);
	});

	it('leaves a per-Y output whose Y is still wired', () => {
		expect(orphanedOutputKeys(tp({ yIN: [12], out: { smoothedy_12: 99 } }))).toEqual([]);
	});

	it('removes only the departed Y, not its siblings', () => {
		const node = tp({ yIN: [13], out: { smoothedy_12: 99, smoothedy_13: 98 } });
		expect(orphanedOutputKeys(node)).toEqual(['smoothedy_12']);
	});

	it('never touches a shared output with no id in its key', () => {
		// smoothedx / time are shared across inputs; clearing them is the node's business.
		const node = tp({ yIN: [], out: { smoothedx: 5, time: 6 } });
		expect(orphanedOutputKeys(node)).toEqual([]);
	});

	it("does not mistake Split's <yId>_<segment> keys for per-Y outputs", () => {
		// Split names outputs the other way round, so "799_1" would otherwise read as
		// "column 1's output" and vanish whenever column 1 did — taking another
		// series' first segment with it.
		const node = tp({ yIN: [799], out: { '799_1': 50, '799_2': 51 } });
		expect(orphanedOutputKeys(node)).toEqual([]);
	});

	it('keeps CollectColumns outputs keyed off colIds', () => {
		expect(orphanedOutputKeys(tp({ colIds: [7], yIN: [], out: { col_7: 42 } }))).toEqual([]);
	});

	it('handles a node with no outputs at all', () => {
		expect(orphanedOutputKeys(tp({ yIN: [] }))).toEqual([]);
		expect(orphanedOutputKeys(undefined)).toEqual([]);
	});
});

describe('reconcileOutputs', () => {
	it('deletes the key and removes the column', () => {
		const node = tp({ yIN: [], out: { smoothedy_12: 99 } });
		const removed = [];
		expect(reconcileOutputs(node, (id) => removed.push(id))).toEqual([99]);
		expect(node.args.out.smoothedy_12).toBeUndefined();
		expect(removed).toEqual([99]);
	});

	it('is idempotent — a second pass finds nothing', () => {
		const node = tp({ yIN: [], out: { smoothedy_12: 99 } });
		reconcileOutputs(node, () => {});
		expect(reconcileOutputs(node, () => {})).toEqual([]);
	});

	it('drops the key even when the column id is unset', () => {
		// A -1 out key is still a stale key; it just has no column behind it.
		const node = tp({ yIN: [], out: { smoothedy_12: -1 } });
		const removed = [];
		reconcileOutputs(node, (id) => removed.push(id));
		expect(node.args.out.smoothedy_12).toBeUndefined();
		expect(removed).toEqual([]);
	});

	it('removes columns only after every key is gone', () => {
		// Removing a column re-enters this sweep, so the keys must already be clean or
		// the recursion sees work that is half-done.
		const node = tp({ yIN: [], out: { smoothedy_1: 10, smoothedy_2: 11 } });
		const seenDuringRemoval = [];
		reconcileOutputs(node, () => seenDuringRemoval.push(Object.keys(node.args.out).length));
		expect(seenDuringRemoval).toEqual([0, 0]);
	});
});

describe('the prefix list is closed, and stays in step with the nodes', () => {
	// Inferring "ends in _<digits>" from the key alone looked general and was wrong in
	// a way that destroys data. These pin both halves of the correction.
	it("does NOT touch LongToWide's category-keyed outputs", () => {
		// value_<category>, and categories are DATA. Numeric ones are entirely normal —
		// hive 1, 2, 3 — and the old shape rule read "value_1" as column 1's output,
		// found it was not an input, and deleted it.
		const node = {
			args: { categoryIN: 5, timeIN: 6, valueIN: 7, out: { value_1: 90, value_2: 91 } }
		};
		expect(orphanedOutputKeys(node)).toEqual([]);
	});

	it("still does not touch Split's <yId>_<segment> keys", () => {
		expect(orphanedOutputKeys({ args: { yIN: [], out: { '799_1': 50 } } })).toEqual([]);
	});

	it('ignores a key whose remainder is not purely an id', () => {
		const node = { args: { yIN: [], out: { resid_1_2: 5, smoothedy_12a: 6 } } };
		expect(orphanedOutputKeys(node)).toEqual([]);
	});

	it('every useMultiYTP prefix in the codebase is listed', () => {
		// The enumeration, rather than trusting anyone to remember. A node that gains a
		// per-Y output whose prefix is missing here would silently keep its orphans.
		const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tableProcesses');
		const used = new Set();
		for (const f of readdirSync(dir).filter((f) => f.endsWith('.svelte'))) {
			const src = readFileSync(join(dir, f), 'utf8');
			for (const m of src.matchAll(/useMultiYTP\(\s*p\s*,\s*'([^']+)'/g)) used.add(m[1]);
		}
		expect(used.size, 'found no useMultiYTP call sites — the scanner went blind').toBeGreaterThan(
			10
		);
		const missing = [...used].filter((p) => !PER_INPUT_PREFIXES.includes(p));
		expect(
			missing,
			`these per-Y prefixes are used by a node but missing from PER_INPUT_PREFIXES: ` +
				`${missing.join(', ')}. Their outputs would survive the input being removed.`
		).toEqual([]);
	});

	it('every listed prefix is still used by something', () => {
		// A stale entry is a licence to delete keys nothing produces any more.
		const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tableProcesses');
		const all = readdirSync(dir)
			.filter((f) => f.endsWith('.svelte'))
			.map((f) => readFileSync(join(dir, f), 'utf8'))
			.join('\n');
		const unused = PER_INPUT_PREFIXES.filter((p) => !all.includes(`'${p}'`));
		expect(unused, `listed but no node produces them: ${unused.join(', ')}`).toEqual([]);
	});
});
