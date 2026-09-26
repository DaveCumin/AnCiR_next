// @ts-nocheck
// Selection spans plots AND facet panels (plan 2026-09-26-facets-as-views, section 1.5 and
// risk 3): the Plot.svelte helpers the plot lists and the workspace background call must
// clear and set both, or a stale panel selection unions with a fresh plot click.
import { describe, it, expect, beforeEach } from 'vitest';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Plot, selectPlot, selectAllPlots, deselectAllPlots } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { panelsFor } from '$lib/core/facetPanels.svelte.js';
import { selectedRefs } from '$lib/core/plotRefs.js';

function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}
function makeScatter({ facet = false, ys = ['a', 'b'] } = {}) {
	const x = mkCol('t', [0, 1, 2, 3]);
	const plot = new Plot({ type: 'scatterplot', facet, plot: { data: [] } });
	for (const name of ys)
		plot.plot.addData({ x: { refId: x }, y: { refId: mkCol(name, [1, 2, 3, 4]) } });
	core.plots.push(plot);
	return plot;
}

beforeEach(async () => {
	appConsts.plotMap = await loadPlots();
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	appState.canvasMultiSelectedNodeIds = [];
	appState.view = 'plots';
});

describe('selectPlot across plots and panels', () => {
	it('a plain select of a panel deselects every plot and every other panel', () => {
		const plain = makeScatter();
		const gen = makeScatter({ facet: true });
		const [p0, p1] = panelsFor(gen);
		plain.selected = true;
		p0.selected = true;
		selectPlot({ altKey: false }, p1.id);
		expect(selectedRefs()).toEqual([p1]);
		expect(plain.selected).toBe(false);
		expect(p0.selected).toBe(false);
	});

	it('a plain select of a plot deselects the panels', () => {
		const plain = makeScatter();
		const gen = makeScatter({ facet: true });
		const [p0] = panelsFor(gen);
		p0.selected = true;
		selectPlot({ altKey: false }, plain.id);
		expect(selectedRefs()).toEqual([plain]);
	});

	it('alt toggles one panel and leaves the rest alone', () => {
		const plain = makeScatter();
		const gen = makeScatter({ facet: true });
		const [p0, p1] = panelsFor(gen);
		plain.selected = true;
		selectPlot({ altKey: true }, p1.id);
		expect(selectedRefs()).toEqual([plain, p1]);
		selectPlot({ altKey: true }, p1.id);
		expect(selectedRefs()).toEqual([plain]);
		expect(p0.selected).toBe(false);
	});
});

describe('selectAllPlots / deselectAllPlots', () => {
	it('select all selects every plot and every panel, never the generator itself', () => {
		const plain = makeScatter();
		const gen = makeScatter({ facet: true, ys: ['a', 'b', 'c'] });
		selectAllPlots();
		expect(selectedRefs()).toEqual([plain, ...panelsFor(gen)]);
		expect(gen.selected).toBe(false);
	});

	it('deselect all clears plots, generators and panels', () => {
		const plain = makeScatter();
		const gen = makeScatter({ facet: true });
		plain.selected = true;
		gen.selected = true;
		for (const p of panelsFor(gen)) p.selected = true;
		deselectAllPlots();
		expect(selectedRefs()).toEqual([]);
		expect(gen.selected).toBe(false);
	});
});
