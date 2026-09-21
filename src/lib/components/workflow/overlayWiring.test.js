// @ts-nocheck
// Wire-apply / disconnect for overlay ports (plan 2026-09-13, B4), and the undo
// route: an overlay wire is recorded through the same setPlotInner op series
// wiring uses (WorkflowEditor.recordPlotEdit), so one wire is one undo step.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
	applyOverlayWire,
	clearOverlayPort,
	removeOverlayWire,
	rerouteOverlayWire,
	overlayPortSelection
} from './overlayWiring.js';
import { OverlayClass } from '$lib/plots/Scatterplot/Overlay.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { mutationService as M } from '$lib/core/mutationService.js';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { NEW_LINE_PORT } from '$lib/core/ProcessNode.svelte.js';

// Mirrors ScatterPlotclass: an `overlays` array plus `addOverlay(kind, form)`.
function makeInner() {
	const inner = { data: [{ x: { refId: 1 }, y: { refId: 2 } }], overlays: [] };
	inner.addOverlay = (kind, form) => {
		const ov = new OverlayClass(inner, { kind, form });
		inner.overlays.push(ov);
		return ov;
	};
	return inner;
}
function addOverlay(inner, kind, form) {
	const ov = new OverlayClass(inner, { kind, form });
	inner.overlays.push(ov);
	return ov;
}
const port = (ov, key) => `ov${ov.id}_${key}`;

describe('applyOverlayWire', () => {
	it('a single channel takes the column as its ONE wire, replacing the previous one', () => {
		const inner = makeInner();
		const band = addOverlay(inner, 'band', 'ribbon');
		expect(applyOverlayWire(inner, port(band, 'lower'), 4)).toBe(true);
		expect(band.wiredRefIds('lower')).toEqual([4]);
		expect(applyOverlayWire(inner, port(band, 'lower'), 5)).toBe(true);
		expect(band.wiredRefIds('lower')).toEqual([5]); // replaced, not appended
		expect(band.wiredRefIds('upper')).toEqual([]); // other channels untouched
	});

	it('wiring a single channel clears its typed values (wired OR typed, never both)', () => {
		const inner = makeInner();
		const band = addOverlay(inner, 'band', 'horizontal');
		band.setTyped('lower', [10, 20]);
		applyOverlayWire(inner, port(band, 'lower'), 4);
		expect(band.channels.lower.typed).toEqual([]);
		expect(band.wiredRefIds('lower')).toEqual([4]);
	});

	it('a line `at` is single too: a second drop REPLACES the first (consistent with x ports)', () => {
		const inner = makeInner();
		const line = addOverlay(inner, 'line', 'vertical');
		applyOverlayWire(inner, port(line, 'at'), 3);
		expect(line.wiredRefIds('at')).toEqual([3]);
		applyOverlayWire(inner, port(line, 'at'), 4);
		expect(line.wiredRefIds('at')).toEqual([4]);
		applyOverlayWire(inner, port(line, 'at'), 3);
		expect(line.wiredRefIds('at')).toEqual([3]);
		expect(inner.overlays).toHaveLength(1); // never a second overlay from ov<id>_at
	});

	it('is a no-op (false) for a non-overlay port, a missing overlay, a foreign channel or a bad colId', () => {
		const inner = makeInner();
		const line = addOverlay(inner, 'line', 'vertical');
		expect(applyOverlayWire(inner, 'ys1', 3)).toBe(false);
		expect(applyOverlayWire(inner, `ov${line.id + 100}_at`, 3)).toBe(false);
		expect(applyOverlayWire(inner, port(line, 'lower'), 3)).toBe(false); // lines have no `lower`
		expect(applyOverlayWire(inner, port(line, 'at'), -1)).toBe(false);
		expect(line.wiredRefIds('at')).toEqual([]);
	});
});

describe('the trailing `Line` port (ovnew_line) creates an overlay', () => {
	it('a drop creates ONE vertical Line overlay with the column wired into `at`', () => {
		const inner = makeInner();
		expect(applyOverlayWire(inner, NEW_LINE_PORT, 3)).toBe(true);
		expect(inner.overlays).toHaveLength(1);
		const line = inner.overlays[0];
		expect(line).toMatchObject({ kind: 'line', form: 'vertical' });
		expect(line.wiredRefIds('at')).toEqual([3]);
	});

	it('a second drop creates a SECOND overlay rather than appending to the first', () => {
		const inner = makeInner();
		applyOverlayWire(inner, NEW_LINE_PORT, 3);
		applyOverlayWire(inner, NEW_LINE_PORT, 4);
		expect(inner.overlays).toHaveLength(2);
		expect(inner.overlays[0].wiredRefIds('at')).toEqual([3]);
		expect(inner.overlays[1].wiredRefIds('at')).toEqual([4]);
		expect(inner.overlays[1].id).not.toBe(inner.overlays[0].id);
		expect(inner.overlays.map((o) => o.name)).toEqual(['Line 1', 'Line 2']);
	});

	it('refuses a bad column id or an inner that cannot add overlays', () => {
		const inner = makeInner();
		expect(applyOverlayWire(inner, NEW_LINE_PORT, -1)).toBe(false);
		expect(applyOverlayWire(inner, NEW_LINE_PORT, 'x')).toBe(false);
		expect(inner.overlays).toHaveLength(0);
		expect(applyOverlayWire({ data: [] }, NEW_LINE_PORT, 3)).toBe(false);
		expect(applyOverlayWire({ data: [], overlays: [] }, NEW_LINE_PORT, 3)).toBe(false);
	});

	it('disconnect / remove / reroute are no-ops on it (nothing ever stays wired there)', () => {
		const inner = makeInner();
		applyOverlayWire(inner, NEW_LINE_PORT, 3);
		expect(clearOverlayPort(inner, NEW_LINE_PORT)).toBe(false);
		expect(removeOverlayWire(inner, NEW_LINE_PORT, 3)).toBe(false);
		expect(rerouteOverlayWire(inner, NEW_LINE_PORT, 3, 4)).toBe(false);
		expect(inner.overlays).toHaveLength(1);
		expect(inner.overlays[0].wiredRefIds('at')).toEqual([3]);
	});

	it('the picker sees it as an empty single-choice port (pick one, create, close)', () => {
		const inner = makeInner();
		applyOverlayWire(inner, NEW_LINE_PORT, 3);
		expect(overlayPortSelection(inner, NEW_LINE_PORT)).toEqual({ many: false, ids: [] });
		// Not an overlay port at all on an inner without overlays.
		expect(overlayPortSelection({ data: [] }, NEW_LINE_PORT)).toBeNull();
	});
});

describe('disconnect', () => {
	it('clearOverlayPort drops the wire on the channel', () => {
		const inner = makeInner();
		const line = addOverlay(inner, 'line', 'vertical');
		line.setWire('at', 3);
		expect(clearOverlayPort(inner, port(line, 'at'))).toBe(true);
		expect(line.wiredRefIds('at')).toEqual([]);
		expect(clearOverlayPort(inner, 'x1')).toBe(false);
	});

	it('removeOverlayWire drops the named wire only (a foreign colId leaves the wire alone)', () => {
		const inner = makeInner();
		const line = addOverlay(inner, 'line', 'vertical');
		line.setWire('at', 4);
		expect(removeOverlayWire(inner, port(line, 'at'), 3)).toBe(true); // not wired: nothing dropped
		expect(line.wiredRefIds('at')).toEqual([4]);
		expect(removeOverlayWire(inner, port(line, 'at'), 4)).toBe(true);
		expect(line.wiredRefIds('at')).toEqual([]);
		// single channel
		const band = addOverlay(inner, 'band', 'vertical');
		band.setWire('start', 7);
		removeOverlayWire(inner, port(band, 'start'), 7);
		expect(band.wiredRefIds('start')).toEqual([]);
	});

	it('rerouteOverlayWire swaps the wire and refuses when the old column is not wired', () => {
		const inner = makeInner();
		const line = addOverlay(inner, 'line', 'vertical');
		line.setWire('at', 4);
		expect(rerouteOverlayWire(inner, port(line, 'at'), 4, 9)).toBe(true);
		expect(line.wiredRefIds('at')).toEqual([9]);
		expect(rerouteOverlayWire(inner, port(line, 'at'), 4, 10)).toBe(false);
		expect(line.wiredRefIds('at')).toEqual([9]);
		const band = addOverlay(inner, 'band', 'ribbon');
		band.setWire('upper', 5);
		expect(rerouteOverlayWire(inner, port(band, 'upper'), 5, 6)).toBe(true);
		expect(band.wiredRefIds('upper')).toEqual([6]);
	});
});

describe('overlayPortSelection (right-click picker)', () => {
	it('is single for every channel (a line `at` included) and lists the wired column', () => {
		const inner = makeInner();
		const line = addOverlay(inner, 'line', 'horizontal');
		line.addWire('at', 3);
		line.addWire('at', 4); // replaced
		const band = addOverlay(inner, 'band', 'ribbon');
		band.setWire('lower', 4);
		expect(overlayPortSelection(inner, port(line, 'at'))).toEqual({ many: false, ids: [4] });
		expect(overlayPortSelection(inner, port(line, 'at')).many).toBe(false);
		expect(overlayPortSelection(inner, port(band, 'lower'))).toEqual({ many: false, ids: [4] });
		expect(overlayPortSelection(inner, port(band, 'upper'))).toEqual({ many: false, ids: [] });
		expect(overlayPortSelection(inner, 'ys1')).toBeNull();
	});
});

// ---- undo: the same setPlotInner route series wiring takes -------------------
//
// WorkflowEditor.recordPlotEdit snapshots plot.plot (via toJSON), runs the
// mutation, snapshots again, reverts through the plot class's fromJSON and
// replays the after-state through mutationService.setPlotInner. This mirrors
// that sequence against a stub plot type that serialises `overlays` the way
// ScatterPlotclass does (channels → { columns:[{refId}], typed }).
function stubInnerFromJSON(json) {
	const inner = makeInner();
	inner.data = [];
	inner.overlays = (json?.overlays ?? []).map((o) => OverlayClass.fromJSON(inner, o));
	inner.toJSON = () => ({ data: [], overlays: inner.overlays.map((o) => o.toJSON()) });
	return inner;
}

function recordPlotEdit(plotObj, mutate) {
	const serialize = (o) =>
		JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'function' ? undefined : v)));
	const entry = appConsts.plotMap.get(plotObj.type);
	const before = serialize(plotObj.plot);
	mutate();
	const after = serialize(plotObj.plot);
	if (JSON.stringify(before) === JSON.stringify(after)) return;
	plotObj.plot = entry.data.fromJSON(plotObj, before);
	M.setPlotInner(plotObj.id, after);
}

describe('an overlay wire is one undoable step', () => {
	beforeAll(() => {
		if (!appConsts.plotMap.has('stuboverlayplot')) {
			appConsts.plotMap.set('stuboverlayplot', {
				displayName: 'Stub overlay plot',
				data: { fromJSON: (_parent, json) => stubInnerFromJSON(json) }
			});
		}
		history.init();
	});
	beforeEach(() => {
		history.clear();
		core.plots.length = 0;
	});

	const overlaysOf = (plot) => plot.plot.overlays;
	const wiredAt = (plot) => overlaysOf(plot)[0].wiredRefIds('at');

	it('records, undoes and redoes a line `at` wire', () => {
		const plot = M.addPlot({
			type: 'stuboverlayplot',
			name: 'p',
			plot: { overlays: [{ kind: 'line', form: 'vertical' }] }
		});
		history.clear();

		const line = overlaysOf(plot)[0];
		recordPlotEdit(plot, () => applyOverlayWire(plot.plot, `ov${line.id}_at`, 3));
		expect(wiredAt(plot)).toEqual([3]);
		expect(history.undoCount).toBe(1);

		history.undo();
		expect(wiredAt(plot)).toEqual([]);
		history.redo();
		expect(wiredAt(plot)).toEqual([3]);
	});

	it('records a single-channel wire, a clear and a reroute as separate steps', () => {
		const plot = M.addPlot({
			type: 'stuboverlayplot',
			name: 'p',
			plot: { overlays: [{ kind: 'band', form: 'ribbon' }] }
		});
		history.clear();
		const lower = (p) => overlaysOf(p)[0].wiredRefIds('lower');
		const portOf = (p) => `ov${overlaysOf(p)[0].id}_lower`;

		recordPlotEdit(plot, () => applyOverlayWire(plot.plot, portOf(plot), 4));
		recordPlotEdit(plot, () => rerouteOverlayWire(plot.plot, portOf(plot), 4, 5));
		recordPlotEdit(plot, () => clearOverlayPort(plot.plot, portOf(plot)));
		expect(history.undoCount).toBe(3);
		expect(lower(plot)).toEqual([]);

		history.undo();
		expect(lower(plot)).toEqual([5]);
		history.undo();
		expect(lower(plot)).toEqual([4]);
		history.undo();
		expect(lower(plot)).toEqual([]);
	});

	it('the port name survives the setPlotInner rebuild, so a second pick on the same port still lands', () => {
		// The right-click picker is opened on `ov<id>_at` and keeps that name. Each
		// pick goes through recordPlotEdit, which rebuilds plot.plot from JSON twice;
		// if fromJSON re-minted overlay ids the SECOND pick would address an overlay
		// that no longer exists and the picker would read as stale (this was the
		// reported symptom). Since 2026-09-18 the second pick REPLACES the wire.
		const plot = M.addPlot({
			type: 'stuboverlayplot',
			name: 'p',
			plot: { overlays: [{ kind: 'line', form: 'vertical' }] }
		});
		history.clear();
		const portName = `ov${overlaysOf(plot)[0].id}_at`;

		recordPlotEdit(plot, () => applyOverlayWire(plot.plot, portName, 3));
		expect(overlaysOf(plot)[0].id).toBe(Number(portName.slice(2, -3)));
		expect(overlayPortSelection(plot.plot, portName)).toEqual({ many: false, ids: [3] });

		recordPlotEdit(plot, () => applyOverlayWire(plot.plot, portName, 4));
		expect(overlayPortSelection(plot.plot, portName)).toEqual({ many: false, ids: [4] });
		recordPlotEdit(plot, () => removeOverlayWire(plot.plot, portName, 4));
		expect(overlayPortSelection(plot.plot, portName)).toEqual({ many: false, ids: [] });
		expect(history.undoCount).toBe(3);

		history.undo();
		history.undo();
		expect(overlayPortSelection(plot.plot, portName)).toEqual({ many: false, ids: [3] });
	});

	it('a drop on ovnew_line creates the overlay AND its wire as ONE undo step', async () => {
		const plot = M.addPlot({ type: 'stuboverlayplot', name: 'p', plot: { overlays: [] } });
		history.clear();
		expect(overlaysOf(plot)).toHaveLength(0);

		recordPlotEdit(plot, () => applyOverlayWire(plot.plot, NEW_LINE_PORT, 3));
		expect(history.undoCount).toBe(1);
		expect(overlaysOf(plot)).toHaveLength(1);
		expect(overlaysOf(plot)[0]).toMatchObject({ kind: 'line', form: 'vertical' });
		expect(wiredAt(plot)).toEqual([3]);
		// The rebuilt overlay keeps the id it was minted with, so its ov<id>_at
		// port name is stable across the setPlotInner replay.
		const id = overlaysOf(plot)[0].id;
		expect(overlayPortSelection(plot.plot, `ov${id}_at`)).toEqual({ many: false, ids: [3] });

		history.undo();
		expect(overlaysOf(plot)).toHaveLength(0); // overlay AND wire gone together
		history.redo();
		expect(overlaysOf(plot)).toHaveLength(1);
		expect(overlaysOf(plot)[0].id).toBe(id);
		expect(wiredAt(plot)).toEqual([3]);
		// A second drop (after the restore window has closed, as any real user
		// gesture would be) is its own step and its own overlay.
		await Promise.resolve();
		recordPlotEdit(plot, () => applyOverlayWire(plot.plot, NEW_LINE_PORT, 4));
		expect(history.undoCount).toBe(2);
		expect(overlaysOf(plot).map((o) => o.wiredRefIds('at'))).toEqual([[3], [4]]);
		history.undo();
		expect(overlaysOf(plot).map((o) => o.wiredRefIds('at'))).toEqual([[3]]);
	});

	it('a wire that changes nothing (re-wiring the already-wired column) records no step', () => {
		const plot = M.addPlot({
			type: 'stuboverlayplot',
			name: 'p',
			plot: {
				overlays: [
					{ kind: 'line', form: 'vertical', channels: { at: { columns: [{ refId: 3 }] } } }
				]
			}
		});
		history.clear();
		const line = overlaysOf(plot)[0];
		recordPlotEdit(plot, () => applyOverlayWire(plot.plot, `ov${line.id}_at`, 3));
		expect(history.undoCount).toBe(0);
		expect(wiredAt(plot)).toEqual([3]);
	});
});
