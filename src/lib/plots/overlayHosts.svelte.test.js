// @ts-nocheck
/**
 * Overlay hosts beyond the Scatterplot (overlays plan 2026-10-15, step 2, T2/T3): the
 * Periodogram and the Correlogram carry reference lines and shaded bands through the shared
 * plotbits (overlaySpec, Overlay, OverlayLayers, OverlaysTab). One parameterised suite, so the
 * next host (Histogram, QQ, Boxplot, MeanSEM, FFT, CWT) is one more table row.
 *
 * Per host: the contract and its declared capabilities; one line and one band drawn at the
 * pixel the host's own scales give; the layer order around the series; the domain widening
 * only on y (never the period or lag range, which are analysis settings); manual limits win;
 * the legend item; the JSON round trip (a disallowed form coerced, a disallowed kind dropped);
 * the undo of a delete; facet replication to every panel with distinct clip ids; the Overlays
 * tab; brush zoom keeping a line on its data value, and a brush that starts over a band; the
 * canvas drop port; and no overlay columns in the plot's computed data (decision Q5).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { OverlayClass } from '$lib/components/plotbits/Overlay.svelte';
import { assertOverlayHost } from '$lib/components/plotbits/overlayHost.js';
import { overlayRangeNote } from '$lib/components/plotbits/overlayDisplay.js';
import { panelsFor, projectPanel } from '$lib/core/facetPanels.svelte.js';
import {
	getCachedProcessNodeGraph,
	clearProcessNodeGraphCache,
	NEW_LINE_PORT
} from '$lib/core/ProcessNode.svelte.js';
import { applyOverlayWire } from '$lib/components/workflow/overlayWiring.js';
import { removeOverlayWithUndo } from './seriesDelete.js';
import { getZoomAdapter } from './zoomAdapters.js';
import Periodogram from './Periodogram/Periodogram.svelte';
import Correlogram from './Correlogram/Correlogram.svelte';

// happy-dom has no Web Animations; the Overlays tab's blocks slide in.
Element.prototype.animate ??= () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });

const HOURS = Array.from({ length: 96 }, (_, i) => i);
const WAVE = HOURS.map((t) => 10 + 5 * Math.cos((2 * Math.PI * t) / 24));

/** A deterministic spectrum, so the y range does not wait on the debounced calculation. */
function seedSpectrum(inner) {
	const x = [];
	const y = [];
	for (let p = 1; p <= 30; p += 0.5) {
		x.push(p);
		y.push(10 * Math.exp(-((p - 24) ** 2) / 4));
	}
	for (const d of inner.data) d.periodData = { x, y, threshold: [], pvalue: [] };
}

const HOSTS = {
	periodogram: {
		Component: Periodogram,
		caps: {
			line: ['vertical', 'horizontal'],
			band: ['vertical', 'horizontal', 'ribbon'],
			legend: true,
			xTime: false,
			domain: ['y']
		},
		xKey: 'periodlimsIN',
		xRange: (inner) => inner.periodlimsIN,
		seed: seedSpectrum,
		// a value inside the visible x range, a band inside it, and one far outside
		at: 24,
		band: [20, 28],
		far: 100,
		zoomTo: [20, 30]
	},
	correlogram: {
		Component: Correlogram,
		caps: {
			line: ['vertical', 'horizontal'],
			band: ['vertical', 'horizontal'],
			legend: true,
			xTime: false,
			domain: ['y']
		},
		xKey: 'laglimsIN',
		xRange: (inner) => inner.laglims,
		seed: () => {},
		at: 24,
		band: [20, 28],
		far: 1000,
		zoomTo: [10, 40]
	}
};

function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

/** A real Plot of `type` with two wired series (so a facet has two panels). */
function makePlot(type, { facet = false } = {}) {
	const t = mkCol('t', HOURS);
	const plot = new Plot({ type, name: type, width: 500, height: 300, facet, plot: { data: [] } });
	plot.plot.addData({ x: { refId: t }, y: { refId: mkCol('a', WAVE) } });
	plot.plot.addData({
		x: { refId: t },
		y: {
			refId: mkCol(
				'b',
				WAVE.map((v) => 20 - v)
			)
		}
	});
	HOSTS[type].seed(plot.plot);
	core.plots.push(plot);
	return plot;
}

function typedLine(inner, form, at) {
	const o = inner.addOverlay('line', form);
	o.setTyped('at', at);
	return o;
}
function typedBand(inner, form, a, b) {
	const o = inner.addOverlay('band', form);
	const [k0, k1] = form === 'vertical' ? ['start', 'end'] : ['lower', 'upper'];
	o.setTyped(k0, [a]);
	o.setTyped(k1, [b]);
	return o;
}

const num = (el, attr) => Number(el.getAttribute(attr));
const close = (a, b) => expect(a).toBeCloseTo(b, 6);

beforeAll(async () => {
	appConsts.plotMap = await loadPlots();
	history.init();
});
beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	core.seriesAppearance = {};
	appState.gridSize = 15;
	history.clear();
	clearProcessNodeGraphCache();
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe.each(Object.keys(HOSTS))('%s as an overlay host', (type) => {
	const H = HOSTS[type];

	it('meets the host contract and declares its capabilities', () => {
		const plot = makePlot(type);
		expect(assertOverlayHost(plot.plot)).toBe(true);
		expect(plot.plot.constructor.overlayCapabilities).toEqual(H.caps);
		expect(plot.plot.overlays).toEqual([]);
	});

	it('new lines and bands start vertical; forms it does not allow are refused', () => {
		const inner = makePlot(type).plot;
		expect(inner.addOverlay('line').form).toBe('vertical');
		const band = inner.addOverlay('band');
		expect(band.form).toBe('vertical');
		band.setForm('repeating');
		expect(band.form).toBe('vertical');
		band.setForm('ribbon');
		expect(band.form).toBe(H.caps.band.includes('ribbon') ? 'ribbon' : 'vertical');
	});

	it("the overlay scales are the host's own axes", () => {
		const inner = makePlot(type).plot;
		const [x0, x1] = H.xRange(inner);
		expect(inner.overlayXScale.domain()).toEqual([x0, x1]);
		expect(inner.overlayXScale.range()).toEqual([0, inner.plotwidth]);
		expect(inner.overlayYScale.domain()).toEqual([inner.ylims[0], inner.ylims[1]]);
		expect(inner.overlayYScale.range()).toEqual([inner.plotheight, 0]);
	});

	it('draws a line and a band at the pixels its scales give, bands beneath the series and lines above', () => {
		const plot = makePlot(type);
		const inner = plot.plot;
		const v = typedLine(inner, 'vertical', [H.at]);
		v.label = 'reference';
		typedLine(inner, 'horizontal', [2]);
		typedBand(inner, 'vertical', H.band[0], H.band[1]);
		inner.legend.show = true;

		const { container } = render(H.Component, { props: { theData: plot, which: 'plot' } });
		const svg = container.querySelector('svg');
		const bandsLayer = svg.querySelector('g.overlay-bands-layer');
		const linesLayer = svg.querySelector('g.overlay-lines-layer');
		expect(bandsLayer).not.toBeNull();
		expect(linesLayer).not.toBeNull();

		const { left, top } = inner.padding;
		const [vRule, hRule] = linesLayer.querySelectorAll('line.overlay-rule');
		close(num(vRule, 'x1'), left + inner.overlayXScale(H.at));
		close(num(vRule, 'y1'), top);
		close(num(vRule, 'y2'), top + inner.plotheight);
		close(num(hRule, 'y1'), top + inner.overlayYScale(2));
		const rect = bandsLayer.querySelector('rect.band-rect');
		close(num(rect, 'x'), left + inner.overlayXScale(H.band[0]));
		close(num(rect, 'width'), inner.overlayXScale(H.band[1]) - inner.overlayXScale(H.band[0]));

		// Order: bands, then the first series path, then the lines, then the legend.
		const series = svg.querySelector('g[clip-path] > path[fill="none"]');
		const follows = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
		expect(follows(bandsLayer, series)).toBe(true);
		expect(follows(series, linesLayer)).toBe(true);
		const legendText = [...svg.querySelectorAll('text')].find(
			(t) => t.textContent.trim() === 'reference'
		);
		expect(legendText).toBeTruthy();
		expect(follows(linesLayer, legendText)).toBe(true);
	});

	it('every overlay clip id in the document is unique', () => {
		const plot = makePlot(type);
		typedLine(plot.plot, 'vertical', [H.at]);
		typedLine(plot.plot, 'horizontal', [2]);
		typedBand(plot.plot, 'vertical', H.band[0], H.band[1]);
		const { container } = render(H.Component, { props: { theData: plot, which: 'plot' } });
		const ids = [...container.querySelectorAll('g[class^="overlay-"] clipPath')].map((c) => c.id);
		expect(ids).toHaveLength(3);
		expect(new Set(ids).size).toBe(3);
	});

	it('widens the automatic y range only; the x range is never touched; manual y limits win', () => {
		const inner = makePlot(type).plot;
		const xBefore = [...H.xRange(inner)];
		const xInBefore = [...inner[H.xKey]];
		const yBefore = [...inner.ylims];

		const v = typedLine(inner, 'vertical', [H.far]);
		typedBand(inner, 'vertical', H.far, H.far + 10);
		expect(H.xRange(inner)).toEqual(xBefore);
		expect(inner[H.xKey]).toEqual(xInBefore);
		expect(inner.ylims).toEqual(yBefore);
		expect(overlayRangeNote(inner, v)).toMatch(/^Outside the visible x range/);

		const h = typedLine(inner, 'horizontal', [yBefore[1] + 50]);
		expect(inner.ylims[1]).toBeGreaterThanOrEqual(yBefore[1] + 50);
		expect(overlayRangeNote(inner, h)).toBeNull();
		const hb = typedBand(inner, 'horizontal', yBefore[0] - 30, yBefore[0] - 20);
		expect(inner.ylims[0]).toBeLessThanOrEqual(yBefore[0] - 30);
		expect(overlayRangeNote(inner, hb)).toBeNull();

		// A hidden overlay does not stretch anything.
		h.enabled = false;
		hb.enabled = false;
		expect(inner.ylims).toEqual(yBefore);

		// The user's limits are kept exactly, and the note says the mark is off-screen.
		h.enabled = true;
		inner.ylimsIN = [yBefore[0], yBefore[1]];
		expect(inner.ylims).toEqual([yBefore[0], yBefore[1]]);
		expect(overlayRangeNote(inner, h)).toMatch(/^Outside the visible y range/);
	});

	it('a labelled, enabled overlay is the last legend item', () => {
		const inner = makePlot(type).plot;
		const before = inner.getLegendItems.map((i) => i.label);
		const o = typedLine(inner, 'vertical', [H.at]);
		expect(inner.getLegendItems.map((i) => i.label)).toEqual(before);
		o.label = 'tau = 24 h';
		expect(inner.getLegendItems.map((i) => i.label)).toEqual([...before, 'tau = 24 h']);
		o.enabled = false;
		expect(inner.getLegendItems.map((i) => i.label)).toEqual(before);
	});

	it('round-trips overlays through toJSON / fromJSON, ids and wires intact', () => {
		const plot = makePlot(type);
		const inner = plot.plot;
		const wired = inner.addOverlay('line', 'vertical');
		wired.setWire('at', mkCol('crossing', [12, 36]));
		typedBand(inner, 'horizontal', 1, 2).label = 'band';
		const json = JSON.parse(JSON.stringify(inner.toJSON()));
		expect(json.overlays).toHaveLength(2);

		const back = appConsts.plotMap.get(type).data.fromJSON(plot, json);
		expect(back.overlays.map((o) => o.toJSON())).toEqual(json.overlays);
		expect(back.overlays.every((o) => o instanceof OverlayClass && o.parentPlot === back)).toBe(
			true
		);
		expect(back.overlays[0].values('at')).toEqual([12, 36]);
		// A session saved before overlays existed loads with none.
		delete json.overlays;
		expect(appConsts.plotMap.get(type).data.fromJSON(plot, json).overlays).toEqual([]);
	});

	it('a saved form it does not allow is coerced; a kind or form it cannot draw never appears', () => {
		const plot = makePlot(type);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const json = JSON.parse(JSON.stringify(plot.plot.toJSON()));
		json.overlays = [
			{ id: 900, kind: 'band', form: 'repeating', name: 'Night' },
			{ id: 901, kind: 'band', form: 'ribbon', name: 'Envelope' }
		];
		const back = appConsts.plotMap.get(type).data.fromJSON(plot, json);
		expect(back.overlays.map((o) => [o.id, o.form])).toEqual([
			[900, 'vertical'],
			[901, H.caps.band.includes('ribbon') ? 'ribbon' : 'vertical']
		]);
		expect(warn).not.toHaveBeenCalled();
	});

	it('deleting an overlay is one undo step', () => {
		const plot = makePlot(type);
		const o = typedLine(plot.plot, 'vertical', [H.at]);
		removeOverlayWithUndo(plot.plot, o.id);
		expect(plot.plot.overlays).toHaveLength(0);
		history.undo();
		expect(plot.plot.overlays.map((x) => [x.id, x.values('at')])).toEqual([[o.id, [H.at]]]);
	});

	it('a faceted plot draws its overlays on every panel, with clip ids that differ per panel', () => {
		const gen = makePlot(type, { facet: true });
		typedLine(gen.plot, 'vertical', [H.at]);
		typedBand(gen.plot, 'vertical', H.band[0], H.band[1]);
		const panels = panelsFor(gen);
		expect(panels).toHaveLength(2);
		panels.forEach((p) => projectPanel(p));
		const genJSON = gen.plot.overlays.map((o) => o.toJSON());
		for (const p of panels) {
			expect(p.plot.overlays.map((o) => o.toJSON())).toEqual(genJSON);
			expect(p.plot.overlays[0].parentPlot).toBe(p.plot);
		}
		// Both panels in ONE document, as on the canvas.
		const rendered = panels.map(
			(p) => render(H.Component, { props: { theData: p, which: 'plot' } }).container
		);
		for (const c of rendered) {
			expect(c.querySelectorAll('g.overlay-lines-layer line.overlay-rule')).toHaveLength(1);
			expect(c.querySelectorAll('g.overlay-bands-layer rect.band-rect')).toHaveLength(1);
		}
		const ids = [...document.querySelectorAll('g[class^="overlay-"] clipPath')].map((c) => c.id);
		expect(ids).toHaveLength(4);
		expect(new Set(ids).size).toBe(4);
	});

	it('the Overlays tab offers + Line and + Band and adds overlays in the default forms', async () => {
		const plot = makePlot(type);
		appState.currentControlTab = 'overlays';
		const { getByText } = render(H.Component, { props: { theData: plot.plot, which: 'controls' } });
		await fireEvent.click(getByText('+ Line'));
		await fireEvent.click(getByText('+ Band'));
		expect(plot.plot.overlays.map((o) => [o.kind, o.form])).toEqual([
			['line', 'vertical'],
			['band', 'vertical']
		]);
		appState.currentControlTab = 'properties';
	});

	it('a brush zoom keeps a line on its data value', () => {
		const plot = makePlot(type);
		typedLine(plot.plot, 'vertical', [H.at]);
		const { container } = render(H.Component, { props: { theData: plot, which: 'plot' } });
		const x1 = () => num(container.querySelector('line.overlay-rule'), 'x1');
		close(x1(), plot.plot.padding.left + plot.plot.overlayXScale(H.at));

		getZoomAdapter(plot)
			.axes.find((a) => a.orient === 'x')
			.set(H.zoomTo);
		flushSync();
		expect(plot.plot.overlayXScale.domain()).toEqual(H.zoomTo);
		const expected =
			plot.plot.padding.left +
			((H.at - H.zoomTo[0]) / (H.zoomTo[1] - H.zoomTo[0])) * plot.plot.plotwidth;
		close(x1(), expected);
	});

	it('a brush that starts over a band still starts (bands never take the pointer)', async () => {
		const plot = makePlot(type);
		const xIn = [...plot.plot[H.xKey]];
		const xBefore = [...H.xRange(plot.plot)];
		typedBand(plot.plot, 'vertical', xBefore[0], xBefore[1]); // covers the whole plot area
		const { container } = render(H.Component, {
			props: { theData: plot, which: 'plot', brushable: true, zoomMode: true }
		});
		const band = container.querySelector('g.overlay-band');
		expect(band.getAttribute('style')).toContain('pointer-events: none');
		const rect = band.querySelector('rect.band-rect');
		const { left, top } = plot.plot.padding;
		const at = (x, y) => ({ bubbles: true, button: 0, clientX: left + x, clientY: top + y });
		rect.dispatchEvent(new MouseEvent('pointerdown', at(40, 20)));
		window.dispatchEvent(new MouseEvent('pointermove', at(200, 120)));
		window.dispatchEvent(new MouseEvent('pointerup', at(200, 120)));
		await tick();
		expect(plot.plot[H.xKey]).not.toEqual(xIn);
	});

	it('the canvas drop port creates a vertical line wired to the dropped column', () => {
		const plot = makePlot(type);
		const fakeCore = {
			data: core.data,
			tableProcesses: [],
			plots: [plot],
			notes: [],
			groups: [],
			orphanProcesses: []
		};
		const fakeConsts = {
			processMap: new Map(),
			tableProcessMap: new Map(),
			plotMap: new Map([[type, { defaultInputs: ['time', 'values'] }]])
		};
		const graph = getCachedProcessNodeGraph(fakeCore, fakeConsts);
		const node = graph.nodes.find((n) => n.id === `plot_${plot.id}`);
		expect(node.ports.inputs.map((p) => p.name)).toContain(NEW_LINE_PORT);

		const col = mkCol('peak', [24.5]);
		expect(applyOverlayWire(plot.plot, NEW_LINE_PORT, col)).toBe(true);
		const [line] = plot.plot.overlays;
		expect([line.kind, line.form, line.wiredRefIds('at')]).toEqual(['line', 'vertical', [col]]);
	});

	it("adds no overlay columns to the plot's computed data (decision Q5)", () => {
		const inner = makePlot(type).plot;
		const before = JSON.parse(JSON.stringify(inner.getDownloadData()));
		typedLine(inner, 'vertical', [H.at]).label = 'x';
		typedBand(inner, 'horizontal', 1, 2);
		expect(JSON.parse(JSON.stringify(inner.getDownloadData()))).toEqual(before);
	});
});

describe('periodogram range hint', () => {
	it('says the period range is never widened for an overlay', () => {
		const inner = makePlot('periodogram').plot;
		const o = typedLine(inner, 'vertical', [40]);
		expect(overlayRangeNote(inner, o)).toBe(
			'Outside the visible x range (1 to 30), so it is not drawn. Overlays never widen the period range, because it is the range the periodogram is computed over; change it in Properties.'
		);
	});
});
