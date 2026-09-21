// Series reorder must be ONE undoable step, must never recolour, and must be a
// pure position change (the same series objects, in a new order).
//
// The Data tab's drag handle (SeriesBlockHeader) and its Alt+Arrow keyboard path
// both land here. Legend order and draw order follow `inner.data`, so this is
// also the legend-order edit.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { history } from '$lib/core/opHistory.svelte.js';
import { mutationService as M } from '$lib/core/mutationService.js';
import { core, appConsts } from '$lib/core/core.svelte';
import { pinAppearance, mappedColour, resolveColour } from './appearanceIdentity.js';
import { reorderSeries, reorderSeriesWithUndo, moveSeriesWithUndo } from './seriesReorder.js';

function makeInner(parent, json) {
	return {
		parentBox: parent,
		data: (json?.data ?? []).map((d) => ({
			label: d.label ?? '',
			y: { refId: d.y?.refId ?? -1, name: d.y?.name ?? '' },
			style: { colour: d.style?.colour ?? null }
		})),
		removeData(idx) {
			this.data.splice(idx, 1);
		},
		toJSON() {
			return { data: this.data };
		}
	};
}

beforeAll(() => {
	if (!appConsts.plotMap.has('stubreorderplot')) {
		appConsts.plotMap.set('stubreorderplot', {
			displayName: 'Stub reorder plot',
			data: { fromJSON: (parent, json) => makeInner(parent, json) }
		});
	}
	if (!appConsts.plotMap.has('stubnofromjson')) {
		appConsts.plotMap.set('stubnofromjson', { displayName: 'No contract', data: {} });
	}
	history.init();
});

beforeEach(() => {
	history.clear();
	core.plots.length = 0;
});

const THREE = {
	data: [
		{ y: { refId: 7, name: 'a' }, style: { colour: '#aa0000' } },
		{ y: { refId: 8, name: 'b' }, style: { colour: null } },
		{ y: { refId: 9, name: 'c' }, style: { colour: '#0000aa' } }
	]
};
const refs = (plot) => plot.plot.data.map((d) => d.y.refId);

function addStubPlot() {
	const plot = M.addPlot({ type: 'stubreorderplot', name: 'p', plot: THREE });
	history.clear();
	return plot;
}

describe('reorderSeries (pure)', () => {
	it('moves an item down and up, to the target POSITION (not "after target")', () => {
		expect(reorderSeries([7, 8, 9], 0, 2)).toEqual([8, 9, 7]);
		expect(reorderSeries([7, 8, 9], 2, 0)).toEqual([9, 7, 8]);
		expect(reorderSeries([7, 8, 9], 1, 0)).toEqual([8, 7, 9]);
	});
	it('returns null for a no-op or out-of-range move', () => {
		expect(reorderSeries([7, 8, 9], 1, 1)).toBeNull();
		expect(reorderSeries([7, 8, 9], 3, 0)).toBeNull();
		expect(reorderSeries([7, 8, 9], 0, 3)).toBeNull();
		expect(reorderSeries([7, 8, 9], -1, 0)).toBeNull();
		expect(reorderSeries([7, 8, 9], 0, -1)).toBeNull();
		expect(reorderSeries([7, 8, 9], 0.5, 1)).toBeNull();
		expect(reorderSeries(null, 0, 1)).toBeNull();
	});
	it('does not mutate its input', () => {
		const arr = [7, 8, 9];
		reorderSeries(arr, 0, 2);
		expect(arr).toEqual([7, 8, 9]);
	});
});

describe('reorderSeriesWithUndo', () => {
	it('moves series 3 to the top as ONE history step; undo restores the order exactly', () => {
		const plot = addStubPlot();
		const before = JSON.parse(JSON.stringify(plot.plot.toJSON()));

		expect(reorderSeriesWithUndo(plot.plot, 2, 0)).toBe(true);
		expect(refs(plot)).toEqual([9, 7, 8]);
		expect(history.undoCount).toBe(1);

		history.undo();
		expect(refs(plot)).toEqual([7, 8, 9]);
		expect(JSON.parse(JSON.stringify(plot.plot.toJSON()))).toEqual(before);

		history.redo();
		expect(refs(plot)).toEqual([9, 7, 8]);
	});

	it('moves a series down (drop on a later block takes that position)', () => {
		const plot = addStubPlot();
		reorderSeriesWithUndo(plot.plot, 0, 2);
		expect(refs(plot)).toEqual([8, 9, 7]);
	});

	it('is a no-op (no history entry, returns false) for same index or out of range', () => {
		const plot = addStubPlot();
		expect(reorderSeriesWithUndo(plot.plot, 1, 1)).toBe(false);
		expect(reorderSeriesWithUndo(plot.plot, 0, 3)).toBe(false);
		expect(reorderSeriesWithUndo(plot.plot, 5, 0)).toBe(false);
		expect(reorderSeriesWithUndo(plot.plot, -1, 0)).toBe(false);
		expect(reorderSeriesWithUndo(null, 0, 1)).toBe(false);
		expect(refs(plot)).toEqual([7, 8, 9]);
		expect(history.undoCount).toBe(0);
	});

	it('carries each series’ explicit colour with it and never touches the identity map', () => {
		// Colour identity is keyed by COLUMN id (core.seriesAppearance), so moving a
		// series must resolve the same colour for the same column, and an explicit
		// per-series override must travel with its series, not with its slot.
		core.seriesAppearance = {};
		const plot = addStubPlot();
		pinAppearance(7, 0);
		pinAppearance(8, 1);
		pinAppearance(9, 2);
		const pinnedBefore = [7, 8, 9].map((id) => mappedColour(id));
		expect(pinnedBefore.every(Boolean)).toBe(true);
		const resolvedBefore = new Map(
			plot.plot.data.map((d, i) => [d.y.refId, resolveColour(d.style.colour, d.y.refId, i)])
		);

		reorderSeriesWithUndo(plot.plot, 2, 0);

		expect([7, 8, 9].map((id) => mappedColour(id))).toEqual(pinnedBefore);
		for (const [i, d] of plot.plot.data.entries()) {
			expect(resolveColour(d.style.colour, d.y.refId, i)).toBe(resolvedBefore.get(d.y.refId));
		}
		// The explicit override moved with its series: it now sits at index 0.
		expect(plot.plot.data[0].style.colour).toBe('#0000aa');
		expect(plot.plot.data[1].style.colour).toBe('#aa0000');

		history.undo();
		expect([7, 8, 9].map((id) => mappedColour(id))).toEqual(pinnedBefore);
		expect(plot.plot.data[0].style.colour).toBe('#aa0000');
	});

	it('falls back to a plain in-place reorder (no history entry) when the type has no fromJSON', () => {
		const parent = { id: 998, type: 'stubnofromjson', plot: null };
		const inner = makeInner(parent, THREE);
		parent.plot = inner;
		expect(reorderSeriesWithUndo(inner, 2, 0)).toBe(true);
		expect(inner.data.map((d) => d.y.refId)).toEqual([9, 7, 8]);
		expect(history.undoCount).toBe(0);
	});
});

describe('moveSeriesWithUndo (keyboard step)', () => {
	it('moves one step up / down and returns the new index', () => {
		const plot = addStubPlot();
		expect(moveSeriesWithUndo(plot.plot, 1, +1)).toBe(2);
		expect(refs(plot)).toEqual([7, 9, 8]);
		expect(moveSeriesWithUndo(plot.plot, 2, -1)).toBe(1);
		expect(refs(plot)).toEqual([7, 8, 9]);
		expect(history.undoCount).toBe(2);
	});
	it('refuses to step past either end (returns null, no history entry)', () => {
		const plot = addStubPlot();
		expect(moveSeriesWithUndo(plot.plot, 0, -1)).toBeNull();
		expect(moveSeriesWithUndo(plot.plot, 2, +1)).toBeNull();
		expect(refs(plot)).toEqual([7, 8, 9]);
		expect(history.undoCount).toBe(0);
	});
});
