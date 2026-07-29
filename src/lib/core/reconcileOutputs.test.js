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
import { liveInputIds, orphanedOutputKeys, reconcileOutputs } from './reconcileOutputs.js';

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
