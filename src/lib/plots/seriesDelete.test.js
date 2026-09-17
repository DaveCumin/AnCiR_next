// Series deletion must be UNDOABLE and must say what it did.
//
// The trash button on a Data-tab series block used to call `theData.removeData(i)`
// directly in every plot: the one wiring edit that never reached the history system,
// and whose only feedback was a slide-out animation. `removeSeriesWithUndo` is the
// shared replacement: it records the deletion through the setPlotInner op (the same
// snapshot/revert/replay contract plot wiring uses) and raises a toast whose Undo
// targets exactly that entry — and hides once anything newer lands on the stack.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { history } from '$lib/core/opHistory.svelte.js';
import { mutationService as M } from '$lib/core/mutationService.js';
import { core, appConsts } from '$lib/core/core.svelte';
import { notifications } from '$lib/core/notifications.svelte.js';
import { pinAppearance, mappedColour } from './appearanceIdentity.js';
import { removeSeriesWithUndo, removeOverlayWithUndo } from './seriesDelete.js';

// Stub plot type whose inner data object mirrors the real per-series contract:
// a `data` array of series (each with wired refIds + styling), `removeData`,
// `parentBox`, and a toJSON/fromJSON round trip — exactly what op_setPlotInner
// and session save/load rely on.
function makeInner(parent, json) {
	return {
		parentBox: parent,
		data: (json?.data ?? []).map((d) => ({
			label: d.label ?? '',
			y: { refId: d.y?.refId ?? -1, name: d.y?.name ?? '' },
			style: { colour: d.style?.colour ?? null, width: d.style?.width ?? 1 }
		})),
		// Overlays mirror the scatterplot's contract: an id-keyed list + removeOverlay(id).
		overlays: (json?.overlays ?? []).map((o) => ({ ...o })),
		removeData(idx) {
			this.data.splice(idx, 1);
		},
		removeOverlay(id) {
			this.overlays = this.overlays.filter((o) => o.id !== id);
		},
		toJSON() {
			return { data: this.data, overlays: this.overlays };
		}
	};
}

beforeAll(() => {
	if (!appConsts.plotMap.has('stubseriesplot')) {
		appConsts.plotMap.set('stubseriesplot', {
			displayName: 'Stub series plot',
			data: { fromJSON: (parent, json) => makeInner(parent, json) }
		});
	}
	// A type WITHOUT a fromJSON contract, for the fallback path.
	if (!appConsts.plotMap.has('stubnofromjson')) {
		appConsts.plotMap.set('stubnofromjson', { displayName: 'No contract', data: {} });
	}
	history.init();
});

beforeEach(() => {
	history.clear();
	core.plots.length = 0;
	notifications.list.length = 0;
});

const TWO_SERIES = {
	data: [
		{ label: '', y: { refId: 7, name: 'activity' }, style: { colour: '#aa0000', width: 2 } },
		{ label: 'mine', y: { refId: 9, name: 'temp' }, style: { colour: '#00aa00', width: 3 } }
	]
};

function addStubPlot() {
	const plot = M.addPlot({ type: 'stubseriesplot', name: 'p', plot: TWO_SERIES });
	history.clear();
	notifications.list.length = 0;
	return plot;
}

describe('removeSeriesWithUndo', () => {
	it('deletes the series as ONE history step and undo restores it EXACTLY', () => {
		const plot = addStubPlot();
		const before = JSON.parse(JSON.stringify(plot.plot.toJSON()));

		removeSeriesWithUndo(plot.plot, 0);

		expect(plot.plot.data.length).toBe(1);
		expect(plot.plot.data[0].y.refId).toBe(9); // the survivor, not a renumbered copy
		expect(history.undoCount).toBe(1);

		history.undo();
		// Exact round trip: wiring (refIds), styling, label, and position all back.
		expect(JSON.parse(JSON.stringify(plot.plot.toJSON()))).toEqual(before);
		expect(plot.plot.data[0].y.refId).toBe(7);
		expect(plot.plot.data[0].style.colour).toBe('#aa0000');

		history.redo();
		expect(plot.plot.data.length).toBe(1);
		expect(plot.plot.data[0].y.refId).toBe(9);
	});

	it('names the deleted series in the toast and offers a working Undo action', () => {
		const plot = addStubPlot();
		removeSeriesWithUndo(plot.plot, 0);

		expect(notifications.list.length).toBe(1);
		const toast = notifications.list[0];
		expect(toast.message).toBe('Series "activity" removed'); // wired column name
		expect(toast.type).toBe('info');
		expect(toast.action?.label).toBe('Undo');
		expect(toast.action.enabled()).toBe(true);

		toast.action.run();
		expect(plot.plot.data.length).toBe(2); // undone
		expect(history.redoCount).toBe(1);
	});

	it('prefers the user label over the column name in the toast', () => {
		const plot = addStubPlot();
		removeSeriesWithUndo(plot.plot, 1);
		expect(notifications.list[0].message).toBe('Series "mine" removed');
	});

	it("the toast's Undo hides and no-ops once a newer op tops the stack", () => {
		const plot = addStubPlot();
		removeSeriesWithUndo(plot.plot, 0);
		const toast = notifications.list[0];

		// A later, unrelated op buries the delete.
		M.setPlotProperty(plot.id, 'name', 'renamed');
		expect(toast.action.enabled()).toBe(false);

		// Clicking anyway must NOT undo the rename (linear history stays honest).
		toast.action.run();
		expect(plot.name).toBe('renamed');
		expect(plot.plot.data.length).toBe(1); // delete still applied
		expect(history.undoCount).toBe(2);
	});

	it('undo → redo of the delete round-trips through the SAME entry (no duplicates)', () => {
		const plot = addStubPlot();
		removeSeriesWithUndo(plot.plot, 0);
		history.undo();
		history.redo();
		history.undo();
		expect(plot.plot.data.length).toBe(2);
		expect(history.undoCount).toBe(0);
		expect(history.redoCount).toBe(1);
	});

	it('never touches colour pinning: the identity record survives delete AND undo', () => {
		// Colour pinning lives in core.seriesAppearance keyed by COLUMN id, outside
		// the plot inner the op snapshots. Deleting must not release it (the toast
		// offers an undo, so the identity must still be there to resolve to), and
		// undo must find the restored refId mapping to the same colour.
		core.seriesAppearance = {};
		const plot = addStubPlot();
		pinAppearance(7, 0);
		const pinned = mappedColour(7);
		expect(pinned).toBeTruthy();

		removeSeriesWithUndo(plot.plot, 0);
		expect(mappedColour(7)).toBe(pinned); // record intact while deleted

		history.undo();
		expect(plot.plot.data[0].y.refId).toBe(7); // wiring back…
		expect(mappedColour(7)).toBe(pinned); // …and it resolves to the same colour
	});

	it('falls back to a plain removal (no history entry) when the type has no fromJSON', () => {
		// A wrapper whose type has no registered round-trip contract.
		const parent = { id: 999, type: 'stubnofromjson', plot: null };
		const inner = makeInner(parent, TWO_SERIES);
		parent.plot = inner;
		removeSeriesWithUndo(inner, 0);
		expect(inner.data.length).toBe(1);
		expect(history.undoCount).toBe(0);
	});

	it('ignores an out-of-range index', () => {
		const plot = addStubPlot();
		removeSeriesWithUndo(plot.plot, 5);
		expect(plot.plot.data.length).toBe(2);
		expect(history.undoCount).toBe(0);
		expect(notifications.list.length).toBe(0);
	});
});

// Overlays (scatterplot reference lines / bands) delete through the same
// mechanism, so they get the same one-step undo and the same toast.
describe('removeOverlayWithUndo', () => {
	const WITH_OVERLAYS = {
		...TWO_SERIES,
		overlays: [
			{ id: 3, kind: 'line', name: 'Line 1', colour: '#333333' },
			{ id: 8, kind: 'band', name: 'Night', fill: '#2C2C2C30' }
		]
	};

	function addOverlayPlot() {
		const plot = M.addPlot({ type: 'stubseriesplot', name: 'p', plot: WITH_OVERLAYS });
		history.clear();
		notifications.list.length = 0;
		return plot;
	}

	it('deletes by id as ONE history step; undo restores the overlay exactly', () => {
		const plot = addOverlayPlot();
		const before = JSON.parse(JSON.stringify(plot.plot.toJSON()));

		removeOverlayWithUndo(plot.plot, 8);
		expect(plot.plot.overlays.map((o) => o.id)).toEqual([3]);
		expect(plot.plot.data.length).toBe(2); // series untouched
		expect(history.undoCount).toBe(1);

		history.undo();
		expect(JSON.parse(JSON.stringify(plot.plot.toJSON()))).toEqual(before);
		expect(plot.plot.overlays[1].fill).toBe('#2C2C2C30');
	});

	it('names the kind and the overlay in the toast, with a working Undo', () => {
		const plot = addOverlayPlot();
		removeOverlayWithUndo(plot.plot, 3);
		expect(notifications.list[0].message).toBe('Line "Line 1" removed');
		removeOverlayWithUndo(plot.plot, 8);
		expect(notifications.list[1].message).toBe('Band "Night" removed');
		notifications.list[1].action.run();
		expect(plot.plot.overlays.map((o) => o.id)).toEqual([8]);
	});

	it('ignores an unknown id', () => {
		const plot = addOverlayPlot();
		removeOverlayWithUndo(plot.plot, 42);
		expect(plot.plot.overlays.length).toBe(2);
		expect(history.undoCount).toBe(0);
		expect(notifications.list.length).toBe(0);
	});
});
