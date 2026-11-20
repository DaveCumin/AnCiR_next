// @ts-nocheck
// A reorder is part of the graph's state: before this, graphPatch compared each entity's JSON
// by id and ignored where it sat, so dragging a group or plot to a new place made an empty
// patch and could not be undone.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { captureGraph, makePatch, applyPatch } from './graphPatch.js';
import { recordGraphMutation } from './operations.js';
import { history } from './opHistory.svelte.js';
import { core } from './core.svelte.js';

const ids = () => core.groups.map((g) => g.id);
const group = (id) => ({ id, name: id, sourceColumnIds: [] });
function move(id, to) {
	const from = core.groups.findIndex((g) => g.id === id);
	const [g] = core.groups.splice(from, 1);
	core.groups.splice(to, 0, g);
}

beforeAll(() => history.init());
beforeEach(() => {
	history.clear();
	core.groups = ['a', 'b', 'c', 'd'].map(group);
});

describe('graphPatch list order', () => {
	it('a patch with no reorder carries no order field (and applies as before)', () => {
		const before = captureGraph();
		core.groups[1].name = 'renamed';
		const patch = makePatch(before, captureGraph());
		expect(patch.groups.order).toBeUndefined();
		expect(patch.groups.update).toHaveLength(1);
		const after = captureGraph();
		applyPatch(makePatch(after, before));
		expect(core.groups[1].name).toBe('b');
		expect(ids()).toEqual(['a', 'b', 'c', 'd']);
	});

	it('a pure reorder makes a patch whose inverse restores the order, keeping identity', () => {
		const objs = [...core.groups];
		const before = captureGraph();
		move('a', 2);
		const after = captureGraph();
		const forward = makePatch(before, after);
		expect(forward.groups).toMatchObject({ remove: [], add: [], update: [] });
		expect(forward.groups.order).toEqual(['b', 'c', 'a', 'd']);
		applyPatch(makePatch(after, before));
		expect(ids()).toEqual(['a', 'b', 'c', 'd']);
		applyPatch(forward);
		expect(ids()).toEqual(['b', 'c', 'a', 'd']);
		// The same objects, only moved.
		for (const o of objs) expect(core.groups).toContain(o);
	});

	it('restores the exact order when entities were also added and removed', () => {
		const before = captureGraph();
		core.groups.splice(1, 1); // remove b
		move('d', 0);
		core.groups.splice(2, 0, group('e')); // add e
		const after = captureGraph();
		expect(ids()).toEqual(['d', 'a', 'e', 'c']);
		const forward = makePatch(before, after);
		const backward = makePatch(after, before);
		applyPatch(backward);
		expect(ids()).toEqual(['a', 'b', 'c', 'd']);
		applyPatch(forward);
		expect(ids()).toEqual(['d', 'a', 'e', 'c']);
	});

	it('an entity the order does not name keeps its slot', () => {
		const before = captureGraph();
		move('a', 3);
		const forward = makePatch(before, captureGraph());
		core.groups = ['a', 'b', 'x', 'c', 'd'].map(group);
		applyPatch(forward);
		expect(ids()).toEqual(['b', 'c', 'x', 'd', 'a']);
	});

	it('a reorder recorded as a graph mutation is one undo step, and redo replays it', () => {
		recordGraphMutation(() => move('c', 0));
		expect(ids()).toEqual(['c', 'a', 'b', 'd']);
		expect(history.undoCount).toBe(1);
		history.undo();
		expect(ids()).toEqual(['a', 'b', 'c', 'd']);
		history.redo();
		expect(ids()).toEqual(['c', 'a', 'b', 'd']);
	});

	it('a move that changes nothing records nothing', () => {
		recordGraphMutation(() => move('b', 1));
		expect(history.undoCount).toBe(0);
	});
});
