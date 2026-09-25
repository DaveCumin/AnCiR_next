// @ts-nocheck
// Reordering a scatterplot's series through the real class + real op path
// reorders the LEGEND (getLegendItems walks `data`), keeps every series' colour,
// and undo restores the previous legend. Also: a facet generator's children
// follow the new order on the next reconcile.
import { describe, it, expect, beforeEach } from 'vitest';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Plot, syncFacetChildren } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { reorderSeriesWithUndo } from '$lib/plots/seriesReorder.js';
import { pinAllSeriesAppearance, resolveColour } from '$lib/plots/appearanceIdentity.js';

function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

function makeScatter({ facet = false } = {}) {
	const x = mkCol('t', [0, 1, 2, 3]);
	const plot = new Plot({ type: 'scatterplot', facet, plot: { data: [] } });
	plot.plot.addData({ x: { refId: x }, y: { refId: mkCol('a', [1, 2, 3, 4]) } });
	plot.plot.addData({ x: { refId: x }, y: { refId: mkCol('b', [4, 3, 2, 1]) } });
	plot.plot.addData({ x: { refId: x }, y: { refId: mkCol('c', [2, 2, 2, 2]) } });
	core.plots.push(plot);
	return plot;
}

const legendLabels = (plot) => plot.plot.getLegendItems.map((i) => i.label);
const legendColours = (plot) =>
	Object.fromEntries(plot.plot.getLegendItems.map((i) => [i.label, i.elements[0]?.color]));

beforeEach(async () => {
	appConsts.plotMap = await loadPlots();
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	core.seriesAppearance = {};
	appState.gridSize = 15;
	history.init();
	history.clear();
});

describe('Scatterplot series reorder → legend', () => {
	it('legend order follows data order; moving series 3 to the top reorders the legend', () => {
		const plot = makeScatter();
		// The app shell (+page.svelte) pins every wired column's identity from an
		// effect; headless, that step is ours. Without it colour falls back to the
		// palette INDEX and would follow position (see the next test).
		pinAllSeriesAppearance(core.plots);
		expect(legendLabels(plot)).toEqual(['a', 'b', 'c']);
		const coloursBefore = legendColours(plot);

		expect(reorderSeriesWithUndo(plot.plot, 2, 0)).toBe(true);
		expect(legendLabels(plot)).toEqual(['c', 'a', 'b']);
		// Colour identity is per column: the same label resolves the same colour.
		expect(legendColours(plot)).toEqual(coloursBefore);
		expect(new Set(Object.values(coloursBefore)).size).toBe(3); // three distinct colours

		history.undo();
		expect(legendLabels(plot)).toEqual(['a', 'b', 'c']);
		expect(legendColours(plot)).toEqual(coloursBefore);
	});

	it('an UNPINNED (column-less) series is the only one whose colour follows position', () => {
		// resolveColour's third tier is the palette index: a series with no wired
		// column has no identity to pin, so its colour is positional. Such a series
		// draws nothing, so a reorder cannot visibly recolour anything.
		expect(resolveColour(null, null, 0)).not.toBe(resolveColour(null, null, 1));
		const plot = makeScatter();
		pinAllSeriesAppearance(core.plots);
		const wired = plot.plot.data[0];
		const colId = wired.y.refId;
		expect(resolveColour(null, colId, 0)).toBe(resolveColour(null, colId, 2));
	});

	it('the canvas node series groups renumber with the order but wires still resolve by refId', async () => {
		const { groupPlotData } = await import('$lib/core/ProcessNode.svelte.js');
		const plot = makeScatter();
		const refsBefore = groupPlotData(plot.plot.data)[0].dataPoints.map((d) => d.y.refId);
		reorderSeriesWithUndo(plot.plot, 2, 0);
		const after = groupPlotData(plot.plot.data);
		expect(after).toHaveLength(1); // one x → still one (x1, ys1) group
		expect(after[0].dataPoints.map((d) => d.y.refId)).toEqual([
			refsBefore[2],
			refsBefore[0],
			refsBefore[1]
		]);
	});

	it('a facet generator re-syncs its children in the new order', () => {
		const gen = makeScatter({ facet: true });
		syncFacetChildren(gen);
		const names = () =>
			core.plots
				.filter((p) => p.facetParent === gen.id)
				.sort((p, q) => p.facetKey.localeCompare(q.facetKey))
				.map((p) => p.name);
		expect(names()).toEqual(['a', 'b', 'c']);

		reorderSeriesWithUndo(gen.plot, 2, 0);
		syncFacetChildren(gen);
		expect(names()).toEqual(['c', 'a', 'b']);
		expect(core.plots.filter((p) => p.facetParent === gen.id)).toHaveLength(3);
	});
});
