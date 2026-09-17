// @ts-nocheck
// Overlay ports on plot nodes (plan 2026-09-13, B4): one input port per channel
// of each overlay's (kind, form), named `ov<id>_<key>`, grouped under the
// overlay's name beneath the series groups, edges drawn from the wired columns,
// and NO passthrough outputs for overlay columns.
import { describe, it, expect, beforeEach } from 'vitest';
import {
	getCachedProcessNodeGraph,
	clearProcessNodeGraphCache,
	plotNodeSlots,
	overlayPortName,
	parseOverlayPort,
	resolveOverlayPort
} from './ProcessNode.svelte.js';
import { OverlayClass } from '$lib/plots/Scatterplot/Overlay.svelte';

function makeAppConsts() {
	return {
		processMap: new Map(),
		tableProcessMap: new Map(),
		plotMap: new Map([['scatterplot', { defaultInputs: ['x', 'y'] }]])
	};
}

function makeCore() {
	return {
		data: [
			{ id: 1, name: 'time', refId: null, processes: [] },
			{ id: 2, name: 'temp', refId: null, processes: [] },
			{ id: 3, name: 'crossing', refId: null, processes: [] },
			{ id: 4, name: 'lower limit', refId: null, processes: [] },
			{ id: 5, name: 'upper', refId: null, processes: [] }
		],
		tableProcesses: [],
		plots: [],
		notes: [],
		groups: [],
		orphanProcesses: []
	};
}

// A scatterplot-shaped inner: series data plus an `overlays` array of real
// OverlayClass instances (the other half of the feature adds the same array to
// ScatterPlotclass; the port emitter only reads it).
function makePlot(id = 9) {
	const inner = { data: [{ x: { refId: 1 }, y: { refId: 2 } }], overlays: [] };
	const plot = { id, name: 'P', type: 'scatterplot', plot: inner };
	return plot;
}

function addOverlay(plot, kind, form) {
	const ov = new OverlayClass(plot.plot, { kind, form });
	plot.plot.overlays.push(ov);
	return ov;
}

beforeEach(() => clearProcessNodeGraphCache());

describe('overlay port naming', () => {
	it('round-trips through overlayPortName / parseOverlayPort', () => {
		expect(overlayPortName(3, 'at')).toBe('ov3_at');
		expect(parseOverlayPort('ov3_at')).toEqual({ id: 3, key: 'at' });
		expect(parseOverlayPort('ov12_lower')).toEqual({ id: 12, key: 'lower' });
	});

	it('does not mistake series or other ports for overlay ports', () => {
		for (const name of ['x1', 'ys2', 'data', 'series', 'col_3', 'ov_at', 'ovx_at', '', null]) {
			expect(parseOverlayPort(name)).toBeNull();
		}
	});

	it('resolveOverlayPort finds the overlay and its channel spec, or null', () => {
		const plot = makePlot();
		const band = addOverlay(plot, 'band', 'ribbon');
		const r = resolveOverlayPort(plot.plot, `ov${band.id}_lower`);
		expect(r.overlay).toBe(band);
		expect(r.key).toBe('lower');
		expect(r.spec).toMatchObject({ key: 'lower', axis: 'y', dynamic: false });
		// a channel the current form lacks, an unknown overlay, a non-overlay port
		expect(resolveOverlayPort(plot.plot, `ov${band.id}_at`)).toBeNull();
		expect(resolveOverlayPort(plot.plot, `ov${band.id + 999}_lower`)).toBeNull();
		expect(resolveOverlayPort(plot.plot, 'x1')).toBeNull();
		expect(resolveOverlayPort(undefined, 'ov1_at')).toBeNull();
	});
});

describe('overlay port emission', () => {
	it('emits one port per channel of each overlay, named ov<id>_<key>, in channel order', () => {
		const core = makeCore();
		const plot = makePlot();
		const line = addOverlay(plot, 'line', 'vertical');
		const band = addOverlay(plot, 'band', 'ribbon');
		core.plots.push(plot);

		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		const node = graph.nodes.find((n) => n.id === 'plot_9');
		const names = node.ports.inputs.map((p) => p.name);
		// Series ports first (set 1 + the trailing empty pair), then the overlays in
		// the order they were added, each with its channels in table order.
		expect(names).toEqual([
			'x1',
			'ys1',
			'x2',
			'ys2',
			`ov${line.id}_at`,
			`ov${band.id}_x`,
			`ov${band.id}_lower`,
			`ov${band.id}_upper`
		]);
	});

	it('each port carries the display, the dynamic flag from the table, and the group tag', () => {
		const core = makeCore();
		const plot = makePlot();
		const line = addOverlay(plot, 'line', 'horizontal');
		const band = addOverlay(plot, 'band', 'vertical');
		core.plots.push(plot);

		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		const node = graph.nodes.find((n) => n.id === 'plot_9');
		const byName = Object.fromEntries(node.ports.inputs.map((p) => [p.name, p]));

		const at = byName[`ov${line.id}_at`];
		expect(at).toMatchObject({
			direction: 'input',
			artifactKind: 'column',
			dynamic: true,
			display: 'at (y)',
			channel: 'at',
			overlay: { id: line.id, name: 'Line 1' }
		});
		expect(at.axis).toBeUndefined(); // never a series port
		expect(at.series).toBeUndefined();

		const start = byName[`ov${band.id}_start`];
		expect(start).toMatchObject({
			dynamic: false,
			display: 'start (x)',
			overlay: { id: band.id, name: 'Band 1' }
		});
		expect(byName[`ov${band.id}_end`]).toMatchObject({ dynamic: false, display: 'end (x)' });
	});

	it('a repeating band has no channels and therefore no ports; no trailing empty overlay group', () => {
		const core = makeCore();
		const plot = makePlot();
		addOverlay(plot, 'band', 'repeating');
		core.plots.push(plot);

		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		const node = graph.nodes.find((n) => n.id === 'plot_9');
		expect(node.ports.inputs.filter((p) => p.overlay)).toEqual([]);
		expect(node.ports.inputs.map((p) => p.name)).toEqual(['x1', 'ys1', 'x2', 'ys2']);
	});

	it('changing an overlay form swaps its ports (the graph cache is invalidated)', () => {
		const core = makeCore();
		const plot = makePlot();
		const band = addOverlay(plot, 'band', 'ribbon');
		core.plots.push(plot);

		let node = getCachedProcessNodeGraph(core, makeAppConsts()).nodes.find(
			(n) => n.id === 'plot_9'
		);
		expect(node.ports.inputs.map((p) => p.name)).toContain(`ov${band.id}_x`);

		band.setForm('horizontal');
		node = getCachedProcessNodeGraph(core, makeAppConsts()).nodes.find((n) => n.id === 'plot_9');
		const names = node.ports.inputs.map((p) => p.name);
		expect(names).not.toContain(`ov${band.id}_x`);
		expect(names).toContain(`ov${band.id}_lower`);
		expect(names).toContain(`ov${band.id}_upper`);
	});

	it('does NOT emit passthrough outputs for overlay columns', () => {
		const core = makeCore();
		const plot = makePlot();
		const line = addOverlay(plot, 'line', 'vertical');
		line.addWire('at', 3);
		const band = addOverlay(plot, 'band', 'ribbon');
		band.setWire('x', 1); // also the series x: passthrough exists for the SERIES use only
		band.setWire('lower', 4);
		band.setWire('upper', 5);
		core.plots.push(plot);

		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		const node = graph.nodes.find((n) => n.id === 'plot_9');
		const outNames = node.ports.outputs.map((p) => p.name);
		expect(outNames).toEqual(['col_1', 'col_2']); // series x/y only
		expect(outNames).not.toContain('col_3');
		expect(outNames).not.toContain('col_4');
		expect(outNames).not.toContain('col_5');
		expect(node.outputColumns.map((c) => c.colId)).toEqual([1, 2]);
	});
});

describe('overlay edges', () => {
	it('draws one edge per wired column from the column owner to ov<id>_<key>', () => {
		const core = makeCore();
		const plot = makePlot();
		const line = addOverlay(plot, 'line', 'vertical');
		line.addWire('at', 3);
		line.addWire('at', 4);
		const band = addOverlay(plot, 'band', 'horizontal');
		band.setWire('lower', 4);
		core.plots.push(plot);

		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		const into = graph.connections.filter((c) => c.toId === 'plot_9');
		const pick = (toPort) => into.filter((c) => c.toPort === toPort).map((c) => c.fromId);
		expect(pick(`ov${line.id}_at`)).toEqual(['data_3', 'data_4']);
		expect(pick(`ov${band.id}_lower`)).toEqual(['data_4']);
		expect(pick(`ov${band.id}_upper`)).toEqual([]); // unwired channel: no edge
		// Series edges are untouched.
		expect(pick('x1')).toEqual(['data_1']);
		expect(pick('ys1')).toEqual(['data_2']);
	});

	it('emits no edge for a wire to a missing column or a typed channel', () => {
		const core = makeCore();
		const plot = makePlot();
		const line = addOverlay(plot, 'line', 'vertical');
		line.addWire('at', 999); // no such column
		const band = addOverlay(plot, 'band', 'horizontal');
		band.setTyped('lower', 10);
		band.setTyped('upper', 20);
		core.plots.push(plot);

		const graph = getCachedProcessNodeGraph(core, makeAppConsts());
		const into = graph.connections.filter((c) => c.toId === 'plot_9' && parseOverlayPort(c.toPort));
		expect(into).toEqual([]);
	});

	it('wiring a channel invalidates the graph cache so the edge appears', () => {
		const core = makeCore();
		const plot = makePlot();
		const line = addOverlay(plot, 'line', 'vertical');
		core.plots.push(plot);
		const before = getCachedProcessNodeGraph(core, makeAppConsts());
		expect(before.connections.some((c) => c.toPort === `ov${line.id}_at`)).toBe(false);

		line.addWire('at', 3);
		const after = getCachedProcessNodeGraph(core, makeAppConsts());
		expect(after).not.toBe(before);
		expect(after.connections.some((c) => c.toPort === `ov${line.id}_at`)).toBe(true);
	});
});

describe('plotNodeSlots with overlay groups', () => {
	it('lays each overlay out as a header (the overlay name) plus its ports, after the series', () => {
		const inputs = [
			{ name: 'x1', axis: 'x', series: 1 },
			{ name: 'ys1', axis: 'y', series: 1 },
			{ name: 'x2', axis: 'x', series: 2, newSeries: true },
			{ name: 'ys2', axis: 'y', series: 2, newSeries: true },
			{ name: 'ov0_at', overlay: { id: 0, name: 'Line 1' }, channel: 'at', dynamic: true },
			{ name: 'ov1_lower', overlay: { id: 1, name: 'Band 1' }, channel: 'lower' },
			{ name: 'ov1_upper', overlay: { id: 1, name: 'Band 1' }, channel: 'upper' }
		];
		const outputs = [
			{ name: 'col_1', series: 1, axis: 'x' },
			{ name: 'col_2', series: 1, axis: 'y' },
			{ name: 'col_18', metric: true }
		];
		const { inputRows, outputRows, totalSlots } = plotNodeSlots(inputs, outputs);

		// Series: header(0) x1(1) ys1(2) header(3) x2(4) ys2(5)
		// Overlays: header "Line 1"(6) ov0_at(7) header "Band 1"(8) lower(9) upper(10)
		const headers = inputRows.filter((r) => r.kind === 'header');
		expect(headers.map((h) => [h.slot, h.label])).toEqual([
			[0, 'Series 1'],
			[3, 'Series 2'],
			[6, 'Line 1'],
			[8, 'Band 1']
		]);
		const inSlot = (name) => inputRows.find((r) => r.kind === 'port' && r.port.name === name)?.slot;
		expect(inSlot('ov0_at')).toBe(7);
		expect(inSlot('ov1_lower')).toBe(9);
		expect(inSlot('ov1_upper')).toBe(10);

		// Nothing on the output side of overlay rows; metrics trail everything.
		const outSlot = (name) => outputRows.find((r) => r.port.name === name)?.slot;
		expect(outSlot('col_1')).toBe(1);
		expect(outSlot('col_18')).toBe(11);
		expect(totalSlots).toBe(12);
	});

	it('an overlay-only port list still groups (no series ports needed)', () => {
		const inputs = [
			{ name: 'ov4_start', overlay: { id: 4, name: 'Band 1' }, channel: 'start' },
			{ name: 'ov4_end', overlay: { id: 4, name: 'Band 1' }, channel: 'end' }
		];
		const { inputRows, totalSlots } = plotNodeSlots(inputs, []);
		expect(inputRows.map((r) => (r.kind === 'header' ? `H:${r.label}` : r.port.name))).toEqual([
			'H:Band 1',
			'ov4_start',
			'ov4_end'
		]);
		expect(totalSlots).toBe(3);
	});
});
