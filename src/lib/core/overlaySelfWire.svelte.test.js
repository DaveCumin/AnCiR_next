// @ts-nocheck
/**
 * A plot's own metric output driving its own overlay (overlays plan 2026-10-15, decision Q4):
 * a Periodogram's `peak_period` port wired into a vertical Line on the same Periodogram, so
 * the line follows the detected peak. Not a computational cycle (the line never feeds the
 * spectrum, and the Periodogram widens only its power axis for overlays), but the wire is an
 * edge from a node to ITSELF, which the plan required to be tested before it is allowed:
 *
 *   - the graph: the metric port and the overlay port both exist on the plot node, and the
 *     edge runs plot -> same plot;
 *   - the layout: the self-edge must not knock the plot (and everything downstream of it)
 *     out of the topological order;
 *   - the drawing: a self-edge is a loop over the node, not a bezier through its body;
 *   - the values: the line sits at the peak, follows it, and does not move the spectrum.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column, getColumnById } from '$lib/core/Column.svelte';
import {
	getCachedProcessNodeGraph,
	clearProcessNodeGraphCache,
	NEW_LINE_PORT,
	overlayPortName
} from './ProcessNode.svelte.js';
import { applyOverlayWire } from '$lib/components/workflow/overlayWiring.js';
import { computeNodeLayers } from '$lib/components/workflow/nodeLayers.js';
import { edgePath } from '$lib/components/workflow/edgePath.js';
import {
	syncPlotMetricColumns,
	writePlotMetricOutputs
} from '$lib/plots/plotMetricOutputs.svelte.js';

const HOURS = Array.from({ length: 96 }, (_, i) => i);

function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

function spectrum(peakAt) {
	const x = [];
	const y = [];
	for (let p = 1; p <= 30; p += 0.25) {
		x.push(p);
		y.push(10 * Math.exp(-((p - peakAt) ** 2) / 2));
	}
	return { x, y, threshold: [], pvalue: [] };
}

/** A periodogram with its metric columns minted and written, as its component would. */
function periodogramWithPeak(peakAt = 24) {
	const plot = new Plot({ type: 'periodogram', name: 'P', plot: { data: [] } });
	plot.plot.addData({ x: { refId: mkCol('t', HOURS) }, y: { refId: mkCol('y', HOURS) } });
	plot.plot.data[0].periodData = spectrum(peakAt);
	core.plots.push(plot);
	syncPlotMetricColumns(plot);
	writePlotMetricOutputs(plot);
	return plot;
}

beforeAll(async () => {
	appConsts.plotMap = await loadPlots();
});
beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	core.tableProcesses = [];
	core.seriesAppearance = {};
	appState.gridSize = 15;
	clearProcessNodeGraphCache();
});

describe("a periodogram's peak_period driving its own vertical line", () => {
	it('the line sits at the peak and follows it, without moving the spectrum or the axes', () => {
		const plot = periodogramWithPeak(24);
		const peakCol = plot.metricOut.peak_period;
		expect(getColumnById(peakCol).getData()).toEqual([24]);
		const ylims = [...plot.plot.ylims];
		const periodlims = [...plot.plot.periodlimsIN];

		// What the editor's connectColumnToInput does for a drop on the trailing Line port.
		expect(applyOverlayWire(plot.plot, NEW_LINE_PORT, peakCol)).toBe(true);
		const [line] = plot.plot.overlays;
		expect(line.values('at')).toEqual([24]);
		expect(plot.plot.ylims).toEqual(ylims);
		expect(plot.plot.periodlimsIN).toEqual(periodlims);

		// The spectrum changes; the metric is rewritten; the line follows.
		plot.plot.data[0].periodData = spectrum(25.5);
		writePlotMetricOutputs(plot);
		expect(line.values('at')).toEqual([25.5]);
	});

	it('the graph carries one edge from the plot to itself, metric port to overlay port', () => {
		const plot = periodogramWithPeak(24);
		const peakCol = plot.metricOut.peak_period;
		applyOverlayWire(plot.plot, NEW_LINE_PORT, peakCol);
		const ov = plot.plot.overlays[0];

		const graph = getCachedProcessNodeGraph(core, appConsts);
		const id = `plot_${plot.id}`;
		const node = graph.nodes.find((n) => n.id === id);
		expect(node.ports.outputs.map((p) => p.name)).toContain(`col_${peakCol}`);
		expect(node.ports.inputs.map((p) => p.name)).toContain(overlayPortName(ov.id, 'at'));
		const self = graph.connections.filter((c) => c.fromId === id && c.toId === id);
		expect(self).toEqual([
			{
				fromId: id,
				fromPort: `col_${peakCol}`,
				toId: id,
				toPort: overlayPortName(ov.id, 'at'),
				type: 'data-plot'
			}
		]);
		// The metric column is not a standalone data node anywhere.
		expect(graph.nodes.some((n) => n.id === `data_${peakCol}`)).toBe(false);
	});

	it('the layout ignores the self-edge: the plot and its downstream keep their layers', () => {
		const nodes = ['data_1', 'data_2', 'plot_9', 'tableprocess_4'].map((id) => ({ id }));
		const edges = [
			{ fromId: 'data_1', toId: 'plot_9' },
			{ fromId: 'data_2', toId: 'plot_9' },
			{ fromId: 'plot_9', toId: 'plot_9' }, // peak_period -> its own Line
			{ fromId: 'plot_9', toId: 'tableprocess_4' } // peak_period -> an analysis
		];
		const layers = computeNodeLayers(nodes, edges);
		expect(Object.fromEntries(layers)).toEqual({
			data_1: 0,
			data_2: 0,
			plot_9: 1,
			tableprocess_4: 2
		});
		// The same graph without the self-edge lays out identically.
		const without = computeNodeLayers(
			nodes,
			edges.filter((e) => e.fromId !== e.toId)
		);
		expect(Object.fromEntries(without)).toEqual(Object.fromEntries(layers));
	});

	it('a self-edge is drawn as a loop above the node, never through it', () => {
		// Output port on the right edge (x 500), overlay port on the left edge (x 200), node top 100.
		const d = edgePath({ x: 500, y: 180 }, { x: 200, y: 260 }, { loopTop: 100 });
		const ys = [...d.matchAll(/-?\d+(?:\.\d+)?,(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
		// Every point of the loop that is not an end point sits above the node's top edge.
		expect(Math.min(...ys)).toBeLessThan(100);
		expect(d.startsWith('M 500,180')).toBe(true);
		expect(d.endsWith('200,260')).toBe(true);
		// An ordinary edge keeps its bezier, exactly as before.
		expect(edgePath({ x: 0, y: 0 }, { x: 100, y: 50 })).toBe('M 0,0 C 50,0 50,50 100,50');
	});
});
