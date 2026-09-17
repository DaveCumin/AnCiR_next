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

function makeInner() {
	return { data: [{ x: { refId: 1 }, y: { refId: 2 } }], overlays: [] };
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

	it('a dynamic channel (line `at`) appends, ignoring a duplicate', () => {
		const inner = makeInner();
		const line = addOverlay(inner, 'line', 'vertical');
		applyOverlayWire(inner, port(line, 'at'), 3);
		applyOverlayWire(inner, port(line, 'at'), 4);
		applyOverlayWire(inner, port(line, 'at'), 3);
		expect(line.wiredRefIds('at')).toEqual([3, 4]);
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

describe('disconnect', () => {
	it('clearOverlayPort drops every wire on the channel', () => {
		const inner = makeInner();
		const line = addOverlay(inner, 'line', 'vertical');
		line.addWire('at', 3);
		line.addWire('at', 4);
		expect(clearOverlayPort(inner, port(line, 'at'))).toBe(true);
		expect(line.wiredRefIds('at')).toEqual([]);
		expect(clearOverlayPort(inner, 'x1')).toBe(false);
	});

	it('removeOverlayWire drops one wire and keeps the rest', () => {
		const inner = makeInner();
		const line = addOverlay(inner, 'line', 'vertical');
		line.addWire('at', 3);
		line.addWire('at', 4);
		expect(removeOverlayWire(inner, port(line, 'at'), 3)).toBe(true);
		expect(line.wiredRefIds('at')).toEqual([4]);
		// single channel
		const band = addOverlay(inner, 'band', 'vertical');
		band.setWire('start', 7);
		removeOverlayWire(inner, port(band, 'start'), 7);
		expect(band.wiredRefIds('start')).toEqual([]);
	});

	it('rerouteOverlayWire swaps one wire in place and refuses when the old column is not wired', () => {
		const inner = makeInner();
		const line = addOverlay(inner, 'line', 'vertical');
		line.addWire('at', 3);
		line.addWire('at', 4);
		line.addWire('at', 5);
		expect(rerouteOverlayWire(inner, port(line, 'at'), 4, 9)).toBe(true);
		expect(line.wiredRefIds('at')).toEqual([3, 9, 5]); // position kept
		expect(rerouteOverlayWire(inner, port(line, 'at'), 4, 10)).toBe(false);
		expect(line.wiredRefIds('at')).toEqual([3, 9, 5]);
		const band = addOverlay(inner, 'band', 'ribbon');
		band.setWire('upper', 5);
		expect(rerouteOverlayWire(inner, port(band, 'upper'), 5, 6)).toBe(true);
		expect(band.wiredRefIds('upper')).toEqual([6]);
	});
});

describe('overlayPortSelection (right-click picker)', () => {
	it('is many only for a dynamic channel and lists the wired columns', () => {
		const inner = makeInner();
		const line = addOverlay(inner, 'line', 'horizontal');
		line.addWire('at', 3);
		line.addWire('at', 4);
		const band = addOverlay(inner, 'band', 'ribbon');
		band.setWire('lower', 4);
		expect(overlayPortSelection(inner, port(line, 'at'))).toEqual({ many: true, ids: [3, 4] });
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
	const inner = { data: [], overlays: [] };
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

	it('records, undoes and redoes a dynamic-channel wire', () => {
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

	it('the port name survives the setPlotInner rebuild, so a second toggle in the open picker still lands', () => {
		// The right-click picker is opened once on `ov<id>_at` and keeps that name
		// while the user ticks several columns. Each tick goes through recordPlotEdit,
		// which rebuilds plot.plot from JSON twice; if fromJSON re-minted overlay ids
		// the SECOND tick would address an overlay that no longer exists and the
		// picker would read as stale (this was the reported symptom).
		const plot = M.addPlot({
			type: 'stuboverlayplot',
			name: 'p',
			plot: { overlays: [{ kind: 'line', form: 'vertical' }] }
		});
		history.clear();
		const portName = `ov${overlaysOf(plot)[0].id}_at`;

		recordPlotEdit(plot, () => applyOverlayWire(plot.plot, portName, 3));
		expect(overlaysOf(plot)[0].id).toBe(Number(portName.slice(2, -3)));
		expect(overlayPortSelection(plot.plot, portName)).toEqual({ many: true, ids: [3] });

		recordPlotEdit(plot, () => applyOverlayWire(plot.plot, portName, 4));
		expect(overlayPortSelection(plot.plot, portName)).toEqual({ many: true, ids: [3, 4] });
		recordPlotEdit(plot, () => removeOverlayWire(plot.plot, portName, 3));
		expect(overlayPortSelection(plot.plot, portName)).toEqual({ many: true, ids: [4] });
		expect(history.undoCount).toBe(3);

		history.undo();
		history.undo();
		expect(overlayPortSelection(plot.plot, portName)).toEqual({ many: true, ids: [3] });
	});

	it('a wire that changes nothing (duplicate on a dynamic channel) records no step', () => {
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
