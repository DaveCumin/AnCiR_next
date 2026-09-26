// @ts-nocheck
// Plot references (plan 2026-09-26-facets-as-views, section 1.5): the three
// primitives every consumer switches to, plus what each formerly numeric-id helper
// does when handed a panel id (plan section 5, item 1) now that they resolve refs.
import { describe, it, expect, beforeEach } from 'vitest';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Plot, getPlotById } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { panelsFor, FacetPanel, projectPanel } from '$lib/core/facetPanels.svelte.js';
import {
	resolvePlotRef,
	renderables,
	selectedRefs,
	isPanelId,
	panelIdParts,
	refFromNodeId,
	ownerPlotOf,
	moveRefTo,
	deselectAllRefs
} from '$lib/core/plotRefs.js';
import {
	normalisePlotIds,
	saveDataAsCSV,
	showDataAsTable
} from '$lib/components/plotbits/helpers/save.svelte.js';
import { isZoomMode, toggleZoomMode, setZoomMode } from '$lib/plots/plotZoomMode.svelte.js';

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
	for (const name of ys) {
		plot.plot.addData({ x: { refId: x }, y: { refId: mkCol(name, [1, 2, 3, 4]) } });
	}
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

describe('isPanelId / panelIdParts', () => {
	it('recognises `<gen>:<role><ref>#<k>` and nothing else', () => {
		expect(isPanelId('7:y112#0')).toBe(true);
		expect(isPanelId('7:c241#12')).toBe(true);
		expect(isPanelId(7)).toBe(false);
		expect(isPanelId('7')).toBe(false);
		expect(isPanelId('plot7')).toBe(false);
		expect(isPanelId('7:z1#0')).toBe(false);
		expect(isPanelId('7:y1')).toBe(false);
		expect(isPanelId(null)).toBe(false);
		expect(isPanelId(undefined)).toBe(false);
	});
	it('splits a panel id into generator id and unit key', () => {
		expect(panelIdParts('7:y112#1')).toEqual({ generatorId: 7, unitKey: 'y112#1' });
		expect(panelIdParts('plot7')).toBeNull();
		expect(panelIdParts(7)).toBeNull();
	});
});

describe('resolvePlotRef', () => {
	it('a number resolves to the Plot in core.plots', () => {
		const p = makeScatter();
		expect(resolvePlotRef(p.id)).toBe(p);
		expect(resolvePlotRef(p.id + 1000)).toBeNull();
	});

	it('a panel id resolves to the SAME FacetPanel object panelsFor returns', () => {
		const gen = makeScatter({ facet: true });
		const panels = panelsFor(gen);
		expect(panels).toHaveLength(2);
		const ref = resolvePlotRef(panels[1].id);
		expect(ref).toBe(panels[1]);
		expect(ref).toBeInstanceOf(FacetPanel);
	});

	it('a panel id of a plot that is not a generator, a missing generator, or a missing unit is null', () => {
		const plain = makeScatter();
		const gen = makeScatter({ facet: true });
		const key = panelsFor(gen)[0].unitKey;
		expect(resolvePlotRef(`${plain.id}:${key}`)).toBeNull();
		expect(resolvePlotRef(`${gen.id + 1000}:${key}`)).toBeNull();
		expect(resolvePlotRef(`${gen.id}:y999999#0`)).toBeNull();
	});

	it('anything else is null', () => {
		makeScatter();
		expect(resolvePlotRef('plot0')).toBeNull();
		expect(resolvePlotRef('0')).toBeNull();
		expect(resolvePlotRef(null)).toBeNull();
		expect(resolvePlotRef(undefined)).toBeNull();
		expect(resolvePlotRef({})).toBeNull();
	});
});

describe('renderables', () => {
	it('is the non-facet plots plus every generator panel, generators themselves excluded', () => {
		const plain = makeScatter();
		const gen = makeScatter({ facet: true, ys: ['a', 'b', 'c'] });
		const list = renderables();
		expect(list).toHaveLength(1 + 3);
		expect(list[0]).toBe(plain);
		expect(list.slice(1)).toEqual(panelsFor(gen));
		expect(list).not.toContain(gen);
	});

	it('a generator with facet off contributes nothing', () => {
		const gen = makeScatter({ facet: true });
		expect(renderables()).toHaveLength(2);
		gen.facet = false;
		// Not a renderable as a panel set, but now an ordinary plot.
		expect(renderables()).toEqual([gen]);
	});
});

describe('selectedRefs (matches ControlDisplay.rawSelectedPlots, plus panels)', () => {
	it('collects selected plots, selected panels and canvas `plot_<id>` entries, deduped', () => {
		const plain = makeScatter();
		const gen = makeScatter({ facet: true });
		const [p0, p1] = panelsFor(gen);
		plain.selected = true;
		p1.selected = true;
		expect(selectedRefs()).toEqual([plain, p1]);
		expect(selectedRefs()).not.toContain(p0);

		// Canvas multi-select only counts in the canvas view (ControlDisplay.activeCanvasMultiIds).
		appState.canvasMultiSelectedNodeIds = [`plot_${gen.id}`, `plot_${plain.id}`, 'process_3'];
		expect(selectedRefs()).toEqual([plain, p1]);
		appState.view = 'canvas';
		// The canvas node of a generator selects the GENERATOR (its own controls); `plain` dedupes.
		expect(selectedRefs()).toEqual([plain, p1, gen]);
	});

	it('a generator selected through Plot.selected is included (today rawSelectedPlots includes it)', () => {
		const gen = makeScatter({ facet: true });
		gen.selected = true;
		expect(selectedRefs()).toEqual([gen]);
	});

	it('a canvas entry naming a panel id resolves through the same resolver', () => {
		const gen = makeScatter({ facet: true });
		const [, p1] = panelsFor(gen);
		appState.view = 'canvas';
		appState.canvasMultiSelectedNodeIds = [`plot_${p1.id}`];
		expect(selectedRefs()).toEqual([p1]);
	});
});

// The numeric-id helpers plan section 5 item 1 listed, handed a panel id AFTER the
// integration step: each resolves the panel through resolvePlotRef (or keys by value).
describe('numeric-id helpers handed a panel id', () => {
	it('normalisePlotIds keeps a panel id (as its string) beside numeric plot ids, deduped', () => {
		const gen = makeScatter({ facet: true });
		const [p0] = panelsFor(gen);
		expect(normalisePlotIds(p0.id)).toEqual([p0.id]);
		expect(normalisePlotIds([gen.id, p0.id, p0.id, 'plot' + p0.id])).toEqual([gen.id, p0.id]);
		// The svg id form (`plot<id>`) still resolves for both kinds.
		expect(normalisePlotIds('plot' + gen.id)).toEqual([gen.id]);
		expect(normalisePlotIds('nonsense')).toEqual([]);
	});

	it('getPlotById is for core.plots only; resolvePlotRef is the panel-aware lookup', () => {
		const gen = makeScatter({ facet: true });
		const [p0] = panelsFor(gen);
		expect(getPlotById(p0.id)).toBeUndefined();
		expect(resolvePlotRef(p0.id)).toBe(p0);
	});

	it('plotZoomMode keys on any id, so a string panel id already works', () => {
		const gen = makeScatter({ facet: true });
		const [p0] = panelsFor(gen);
		expect(isZoomMode(p0.id)).toBe(false);
		toggleZoomMode(p0.id);
		expect(isZoomMode(p0.id)).toBe(true);
		setZoomMode(p0.id, false);
		expect(isZoomMode(p0.id)).toBe(false);
	});

	it('showDataAsTable on a panel id opens a data view sourced from that panel', () => {
		const gen = makeScatter({ facet: true });
		const [p0] = panelsFor(gen);
		projectPanel(p0);
		const before = core.plots.length;
		showDataAsTable(p0.id);
		expect(core.plots.length).toBe(before + 1);
		const view = core.plots[core.plots.length - 1];
		expect(view.type).toBe('dataview');
		expect(view.plot.sourcePlotId).toBe(p0.id);
		expect(view.name).toBe('Data: ' + p0.name);
		// The view resolves its source to the panel's projected instance (one series, not two).
		expect(view.plot.sourcePlot).toBe(p0);
		expect(p0.plot.data).toHaveLength(1);
	});

	it('saveDataAsCSV on a panel id reads the panel instance and downloads its name', () => {
		const gen = makeScatter({ facet: true });
		const [, p1] = panelsFor(gen);
		projectPanel(p1);
		const clicks = [];
		const origClick = HTMLAnchorElement.prototype.click;
		HTMLAnchorElement.prototype.click = function () {
			clicks.push(this.download);
		};
		const origUrl = URL.createObjectURL;
		URL.createObjectURL = () => 'blob:x';
		const origRevoke = URL.revokeObjectURL;
		URL.revokeObjectURL = () => {};
		try {
			saveDataAsCSV(p1.id);
		} finally {
			HTMLAnchorElement.prototype.click = origClick;
			URL.createObjectURL = origUrl;
			URL.revokeObjectURL = origRevoke;
		}
		expect(clicks).toEqual([p1.name + '.csv']);
	});

	it('refFromNodeId parses `plot_<n>` to the plot (a generator included) and `plot_<panel id>` to the panel', () => {
		const gen = makeScatter({ facet: true });
		const [p0] = panelsFor(gen);
		expect(refFromNodeId(`plot_${gen.id}`)).toBe(gen);
		expect(refFromNodeId(`plot_${p0.id}`)).toBe(p0);
		expect(refFromNodeId('process_3')).toBeNull();
		expect(refFromNodeId(`plot_${gen.id + 100}`)).toBeNull();
	});

	it('invisiblePlotIds and nodeNotes are keyed by value, so a panel id already works', () => {
		const gen = makeScatter({ facet: true });
		const [p0] = panelsFor(gen);
		appState.invisiblePlotIds = [p0.id];
		expect(appState.invisiblePlotIds.includes(p0.id)).toBe(true);
		appState.invisiblePlotIds = [];
		core.nodeNotes[`plot_${p0.id}`] = 'note';
		expect(core.nodeNotes[`plot_${p0.id}`]).toBe('note');
		delete core.nodeNotes[`plot_${p0.id}`];
	});
});

describe('ownerPlotOf / moveRefTo / deselectAllRefs', () => {
	it('ownerPlotOf is the generator for a panel and the plot itself otherwise', () => {
		const plain = makeScatter();
		const gen = makeScatter({ facet: true });
		const [p0] = panelsFor(gen);
		expect(ownerPlotOf(plain)).toBe(plain);
		expect(ownerPlotOf(p0)).toBe(gen);
		expect(ownerPlotOf(null)).toBeNull();
	});

	it('moveRefTo moves a plot to the point and a panel by moving its generator the same delta', () => {
		appState.gridSize = 15;
		const gen = makeScatter({ facet: true, ys: ['a', 'b'] });
		gen.x = 60;
		gen.y = 60;
		const [, p1] = panelsFor(gen);
		const before = { x: p1.x, y: p1.y, gx: gen.x, gy: gen.y };
		moveRefTo(p1, before.x + 30, before.y + 45);
		expect(gen.x).toBe(before.gx + 30);
		expect(gen.y).toBe(before.gy + 45);
		expect(p1.x).toBe(before.x + 30);
		expect(p1.y).toBe(before.y + 45);
		moveRefTo(gen, 0, 15);
		expect([gen.x, gen.y]).toEqual([0, 15]);
	});

	it('deselectAllRefs clears plots, generators and panels', () => {
		const plain = makeScatter();
		const gen = makeScatter({ facet: true });
		const [p0] = panelsFor(gen);
		plain.selected = true;
		gen.selected = true;
		p0.selected = true;
		deselectAllRefs();
		expect(selectedRefs()).toEqual([]);
		expect(gen.selected).toBe(false);
	});
});
