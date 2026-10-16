// @ts-nocheck
/**
 * Overlay hosts beyond the Scatterplot (overlays plan 2026-10-15, steps 2 to 4, T2/T3): the
 * Periodogram, Correlogram, Histogram, Q-Q plot, Boxplot, Mean ± SEM, FFT and wavelet (CWT)
 * carry reference lines and shaded bands through the shared plotbits (overlaySpec, Overlay,
 * OverlayLayers, OverlaysTab). One parameterised suite, so the next host is one more table row.
 *
 * Per host: the contract and its declared capabilities; one line and one band drawn at the
 * pixel the host's own scales give; the layer order around the series; the domain widening
 * only on the axes the host declares (never a periodogram's period range or a correlogram's
 * lag range, which are analysis settings; never a categorical x); manual limits win; the
 * legend item; the JSON round trip (a disallowed form coerced, a disallowed kind dropped);
 * the undo of a delete; facet replication to every panel with distinct clip ids (facetable
 * hosts); the Overlays tab; brush zoom keeping a line on its data value, and a brush that
 * starts over a band (hosts that zoom); the canvas drop port (a horizontal line where the x
 * axis is categorical); and no overlay columns in the plot's computed data (decision Q5).
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
import { getZoomAdapter, isZoomCapable } from './zoomAdapters.js';
import Periodogram from './Periodogram/Periodogram.svelte';
import Correlogram from './Correlogram/Correlogram.svelte';
import Histogram from './Histogram/Histogram.svelte';
import QQPlot from './QQPlot/QQPlot.svelte';
import Boxplot, { niceAxisLimit } from './Boxplot/Boxplot.svelte';
import MeanSEM from './MeanSEM/MeanSEM.svelte';
import FFT from './FFT/FFT.svelte';
import CWT, { periodToY } from './CWT/CWT.svelte';
import { logAxisDomain } from './logAxis.js';

// happy-dom has no Web Animations; the Overlays tab's blocks slide in.
Element.prototype.animate ??= () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });

const HOURS = Array.from({ length: 96 }, (_, i) => i);
const WAVE = HOURS.map((t) => 10 + 5 * Math.cos((2 * Math.PI * t) / 24));
// Three groups for the categorical hosts (Boxplot, Mean ± SEM).
const GROUPS = HOURS.map((t) => t % 3);

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

const FFT_X_NOTE =
	'Vertical positions are periods in hours, also when the x axis shows frequency (a line at 24 is drawn at 1/24 cycles per hour).';

const XY_ALL = {
	line: ['vertical', 'horizontal'],
	band: ['vertical', 'horizontal'],
	legend: true,
	xTime: false,
	domain: ['x', 'y']
};
const H_ONLY = {
	line: ['horizontal'],
	band: ['horizontal'],
	legend: true,
	xTime: false,
	domain: ['y']
};
// A time-and-values series (spectrum hosts), a single column (distribution hosts), or a
// category and a value (categorical hosts).
const timeValues = (t, y) => ({ x: { refId: t }, y: { refId: y } });
const oneColumn = (_t, y) => ({ column: { refId: y } });
const categoryValue = (_t, y) => ({ x: { refId: mkCol('group', GROUPS) }, y: { refId: y } });

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
		inputs: ['time', 'values'],
		series: timeValues,
		seriesSel: 'g[clip-path] > path[fill="none"]',
		xKey: 'periodlimsIN',
		xRange: (inner) => inner.periodlimsIN,
		seed: seedSpectrum,
		// a value inside the visible x range, a band inside it, and one far outside
		at: 24,
		band: [20, 28],
		far: 100,
		yAt: 2,
		facet: true,
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
		inputs: ['time', 'values'],
		series: timeValues,
		seriesSel: 'g[clip-path] > path[fill="none"]',
		xKey: 'laglimsIN',
		xRange: (inner) => inner.laglims,
		seed: () => {},
		at: 24,
		band: [20, 28],
		far: 1000,
		yAt: 0.5,
		facet: true,
		zoomTo: [10, 40]
	},
	histogram: {
		Component: Histogram,
		caps: XY_ALL,
		inputs: ['column'],
		series: oneColumn,
		seriesSel: 'g[style*="fill-opacity"] polyline',
		xKey: 'xlimsIN',
		xRange: (inner) => inner.xlims,
		seed: () => {},
		at: 10,
		band: [8, 12],
		far: 100,
		yAt: 2,
		facet: true
	},
	qqplot: {
		Component: QQPlot,
		caps: XY_ALL,
		inputs: ['column'],
		series: oneColumn,
		seriesSel: 'circle',
		xKey: 'xlimsIN',
		xRange: (inner) => inner.xlims,
		seed: () => {},
		at: 0,
		band: [-1, 1],
		far: 50,
		yAt: 10
	},
	boxplot: {
		Component: Boxplot,
		caps: H_ONLY,
		inputs: ['x', 'y'],
		series: categoryValue,
		seriesSel: 'g[clip-path] rect',
		xKey: 'xlimsIN',
		xRange: (inner) => inner.xlims,
		seed: () => {},
		yAt: 10
	},
	meansem: {
		Component: MeanSEM,
		caps: H_ONLY,
		inputs: ['x', 'y'],
		series: categoryValue,
		seriesSel: 'path[stroke="none"]',
		xKey: 'xlimsIN',
		xRange: (inner) => inner.xlims,
		seed: () => {},
		yAt: 10
	},
	fft: {
		Component: FFT,
		caps: {
			line: ['vertical', 'horizontal'],
			band: ['vertical', 'horizontal'],
			legend: true,
			xTime: false,
			domain: ['y'],
			xNote: FFT_X_NOTE
		},
		inputs: ['time', 'values'],
		series: timeValues,
		seriesSel: 'g[clip-path] > path[fill="none"]',
		xKey: 'xlimsIN',
		xRange: (inner) => inner.xlims,
		// The x axis as PERIOD here, so a typed 24 is drawn at 24; frequency mode has its own
		// suite below.
		seed: (inner) => {
			inner.showPeriod = true;
			inner.xlimsIN = [4, 48];
		},
		at: 24,
		band: [20, 28],
		far: 100,
		yAt: 2,
		facet: true,
		zoomTo: [20, 30]
	},
	cwt: {
		Component: CWT,
		caps: {
			line: ['horizontal'],
			band: ['horizontal'],
			legend: false,
			xTime: false,
			domain: []
		},
		inputs: ['x', 'y'],
		series: timeValues,
		// The power field is a canvas image (absent without a canvas); the cone of influence
		// is the first SVG mark drawn over it.
		seriesSel: 'polyline',
		xRange: (inner) => [inner.transform.times[0], inner.transform.times.at(-1)],
		yRange: (inner) => [inner.transform.periods[0], inner.transform.periods.at(-1)],
		seed: () => {},
		yAt: 24
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
	const H = HOSTS[type];
	const t = mkCol('t', HOURS);
	const plot = new Plot({ type, name: type, width: 500, height: 300, facet, plot: { data: [] } });
	plot.plot.addData(H.series(t, mkCol('a', WAVE)));
	plot.plot.addData(
		H.series(
			t,
			mkCol(
				'b',
				WAVE.map((v) => 20 - v)
			)
		)
	);
	H.seed(plot.plot);
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
	const [k0, k1] = bandKeys(form);
	o.setTyped(k0, [a]);
	o.setTyped(k1, [b]);
	return o;
}

const num = (el, attr) => Number(el.getAttribute(attr));
const close = (a, b) => expect(a).toBeCloseTo(b, 6);
/** The first element matching `sel` that is not part of an overlay layer. */
const seriesEl = (svg, sel) =>
	[...svg.querySelectorAll(sel)].find((el) => !el.closest('g[class^="overlay-"]'));
const bandKeys = (form) => (form === 'vertical' ? ['start', 'end'] : ['lower', 'upper']);

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
	// The forms a new overlay of each kind starts with: the host's first allowed form.
	const LINE = H.caps.line[0];
	const BAND = H.caps.band[0];
	const hasVertical = H.caps.line.includes('vertical');
	const widensX = H.caps.domain.includes('x');
	const widensY = H.caps.domain.includes('y');
	const hasLegend = H.caps.legend;
	const yRange = H.yRange ?? ((inner) => inner.ylims);
	// A typed value for the default line form and a pair for the default band form, inside the
	// visible range on the axis that form is read on.
	const lineAt = LINE === 'vertical' ? H.at : H.yAt;
	const bandAt = BAND === 'vertical' ? H.band : [H.yAt - 1, H.yAt + 1];

	it('meets the host contract and declares its capabilities', () => {
		const plot = makePlot(type);
		expect(assertOverlayHost(plot.plot)).toBe(true);
		expect(plot.plot.constructor.overlayCapabilities).toEqual(H.caps);
		expect(plot.plot.overlays).toEqual([]);
	});

	it("new lines and bands start in the host's first form; forms it does not allow are refused", () => {
		const inner = makePlot(type).plot;
		expect(inner.addOverlay('line').form).toBe(LINE);
		const band = inner.addOverlay('band');
		expect(band.form).toBe(BAND);
		band.setForm('repeating');
		expect(band.form).toBe(BAND);
		band.setForm('ribbon');
		expect(band.form).toBe(H.caps.band.includes('ribbon') ? 'ribbon' : BAND);
		// A categorical x axis takes no vertical marks at all.
		const line = inner.addOverlay('line', 'vertical');
		expect(line.form).toBe(hasVertical ? 'vertical' : 'horizontal');
		const vband = inner.addOverlay('band', 'vertical');
		expect(vband.form).toBe(H.caps.band.includes('vertical') ? 'vertical' : BAND);
	});

	it('mounting where nothing is laid out keeps the figure padding (no 0 / 0 measurements)', () => {
		const plot = makePlot(type);
		const before = { ...plot.plot.padding };
		render(H.Component, { props: { theData: plot, which: 'plot' } });
		expect({ ...plot.plot.padding }).toEqual(before);
		expect(Number.isFinite(plot.plot.plotwidth)).toBe(true);
	});

	it("the overlay scales are the host's own axes", () => {
		const inner = makePlot(type).plot;
		const [x0, x1] = H.xRange(inner);
		expect(inner.overlayXScale.domain()).toEqual([x0, x1]);
		expect(inner.overlayXScale.range()).toEqual([0, inner.plotwidth]);
		const [y0, y1] = yRange(inner);
		expect(inner.overlayYScale.domain()).toEqual([y0, y1]);
		expect(inner.overlayYScale.range()).toEqual([inner.plotheight, 0]);
	});

	it('draws a line and a band at the pixels its scales give, bands beneath the series and lines above', () => {
		const plot = makePlot(type);
		const inner = plot.plot;
		const first = typedLine(inner, LINE, [lineAt]);
		first.label = 'reference';
		typedLine(inner, 'horizontal', [H.yAt]);
		typedBand(inner, BAND, bandAt[0], bandAt[1]);
		if (hasLegend) inner.legend.show = true;

		const { container } = render(H.Component, { props: { theData: plot, which: 'plot' } });
		const svg = container.querySelector('svg');
		const bandsLayer = svg.querySelector('g.overlay-bands-layer');
		const linesLayer = svg.querySelector('g.overlay-lines-layer');
		expect(bandsLayer).not.toBeNull();
		expect(linesLayer).not.toBeNull();

		const { left, top } = inner.padding;
		const [firstRule, hRule] = linesLayer.querySelectorAll('line.overlay-rule');
		if (LINE === 'vertical') {
			close(num(firstRule, 'x1'), left + inner.overlayXScale(H.at));
			close(num(firstRule, 'y1'), top);
			close(num(firstRule, 'y2'), top + inner.plotheight);
		} else {
			// Across the whole plot width, at the typed value.
			close(num(firstRule, 'x1'), left);
			close(num(firstRule, 'x2'), left + inner.plotwidth);
			close(num(firstRule, 'y1'), top + inner.overlayYScale(H.yAt));
		}
		close(num(hRule, 'y1'), top + inner.overlayYScale(H.yAt));
		const rect = bandsLayer.querySelector('rect.band-rect');
		if (BAND === 'vertical') {
			close(num(rect, 'x'), left + inner.overlayXScale(bandAt[0]));
			close(num(rect, 'width'), inner.overlayXScale(bandAt[1]) - inner.overlayXScale(bandAt[0]));
		} else {
			close(num(rect, 'x'), left);
			close(num(rect, 'width'), inner.plotwidth);
			close(num(rect, 'y'), top + inner.overlayYScale(bandAt[1]));
			close(num(rect, 'height'), inner.overlayYScale(bandAt[0]) - inner.overlayYScale(bandAt[1]));
		}

		// Order: bands, then the first series mark, then the lines, then the legend.
		const series = seriesEl(svg, H.seriesSel);
		expect(series).toBeTruthy();
		const follows = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
		expect(follows(bandsLayer, series)).toBe(true);
		expect(follows(series, linesLayer)).toBe(true);
		const legendText = [...svg.querySelectorAll('text')].find(
			(t) => t.textContent.trim() === 'reference'
		);
		if (!hasLegend) {
			// No legend to carry a label: the label shows nowhere on the figure.
			expect(legendText).toBeUndefined();
			return;
		}
		expect(legendText).toBeTruthy();
		expect(follows(linesLayer, legendText)).toBe(true);
	});

	it('every overlay clip id in the document is unique', () => {
		const plot = makePlot(type);
		typedLine(plot.plot, LINE, [lineAt]);
		typedLine(plot.plot, 'horizontal', [H.yAt]);
		typedBand(plot.plot, BAND, bandAt[0], bandAt[1]);
		const { container } = render(H.Component, { props: { theData: plot, which: 'plot' } });
		const ids = [...container.querySelectorAll('g[class^="overlay-"] clipPath')].map((c) => c.id);
		expect(ids).toHaveLength(3);
		expect(new Set(ids).size).toBe(3);
	});

	if (!widensY) {
		it('never widens the y range, which is an analysis setting', () => {
			const inner = makePlot(type).plot;
			const xBefore = [...H.xRange(inner)];
			const yBefore = [...yRange(inner)];
			const h = typedLine(inner, 'horizontal', [yBefore[1] * 2 + 50]);
			typedBand(inner, 'horizontal', yBefore[1] * 2, yBefore[1] * 3);
			expect(yRange(inner)).toEqual(yBefore);
			expect(H.xRange(inner)).toEqual(xBefore);
			expect(inner.overlayYScale.domain()).toEqual(yBefore);
			expect(overlayRangeNote(inner, h)).toMatch(/^Outside the visible y range/);
		});
	}

	if (widensY) {
		it('widens the automatic y range; manual y limits win', () => {
			const inner = makePlot(type).plot;
			const xBefore = [...H.xRange(inner)];
			const yBefore = [...inner.ylims];

			const h = typedLine(inner, 'horizontal', [yBefore[1] + 50]);
			expect(inner.ylims[1]).toBeGreaterThanOrEqual(yBefore[1] + 50);
			expect(overlayRangeNote(inner, h)).toBeNull();
			const hb = typedBand(inner, 'horizontal', yBefore[0] - 30, yBefore[0] - 20);
			expect(inner.ylims[0]).toBeLessThanOrEqual(yBefore[0] - 30);
			expect(overlayRangeNote(inner, hb)).toBeNull();
			// Horizontal marks never move the x axis.
			expect(H.xRange(inner)).toEqual(xBefore);

			// A hidden overlay does not stretch anything.
			h.enabled = false;
			hb.enabled = false;
			expect(inner.ylims).toEqual(yBefore);

			// The user's limits are kept exactly, and the note says the mark is off-screen.
			h.enabled = true;
			inner.ylimsIN = [yBefore[0], yBefore[1]];
			expect(inner.ylims).toEqual([yBefore[0], yBefore[1]]);
			expect(overlayRangeNote(inner, h)).toMatch(/^Outside the visible y range/);
			expect(overlayRangeNote(inner, h)).toMatch(/fixed limits; reset them in Properties/);
		});
	}

	if (hasVertical && !widensX) {
		it('never widens the x range, which is an analysis setting', () => {
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
		});
	}

	if (widensX) {
		it('widens the automatic x range to fit a vertical mark; manual x limits win', () => {
			const inner = makePlot(type).plot;
			const xBefore = [...H.xRange(inner)];
			const yBefore = [...inner.ylims];
			const v = typedLine(inner, 'vertical', [H.far]);
			expect(H.xRange(inner)[1]).toBeGreaterThanOrEqual(H.far);
			// The automatic padding is a fraction of the span, so the far end may move out too.
			expect(H.xRange(inner)[0]).toBeLessThanOrEqual(xBefore[0]);
			expect(overlayRangeNote(inner, v)).toBeNull();
			const vb = typedBand(inner, 'vertical', xBefore[0] - 40, xBefore[0] - 30);
			expect(H.xRange(inner)[0]).toBeLessThanOrEqual(xBefore[0] - 40);
			expect(overlayRangeNote(inner, vb)).toBeNull();
			// Vertical marks never move the y axis.
			expect(inner.ylims).toEqual(yBefore);

			v.enabled = false;
			vb.enabled = false;
			expect(H.xRange(inner)).toEqual(xBefore);

			v.enabled = true;
			inner.xlimsIN = [xBefore[0], xBefore[1]];
			expect(H.xRange(inner)).toEqual(xBefore);
			expect(overlayRangeNote(inner, v)).toBe(
				`Outside the visible x range (${Number(xBefore[0].toPrecision(4))} to ${Number(
					xBefore[1].toPrecision(4)
				)}), so it is not drawn. The x axis has fixed limits; reset them in Properties to fit it.`
			);
		});
	}

	if (hasLegend) {
		it('a labelled, enabled overlay is the last legend item', () => {
			const inner = makePlot(type).plot;
			const before = inner.getLegendItems.map((i) => i.label);
			const o = typedLine(inner, LINE, [lineAt]);
			expect(inner.getLegendItems.map((i) => i.label)).toEqual(before);
			o.label = 'tau = 24 h';
			expect(inner.getLegendItems.map((i) => i.label)).toEqual([...before, 'tau = 24 h']);
			o.enabled = false;
			expect(inner.getLegendItems.map((i) => i.label)).toEqual(before);
		});
	}

	it('round-trips overlays through toJSON / fromJSON, ids and wires intact', () => {
		const plot = makePlot(type);
		const inner = plot.plot;
		const wired = inner.addOverlay('line', LINE);
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
			{ id: 901, kind: 'band', form: 'ribbon', name: 'Envelope' },
			{ id: 902, kind: 'line', form: 'vertical', name: 'Line 1' }
		];
		const back = appConsts.plotMap.get(type).data.fromJSON(plot, json);
		expect(back.overlays.map((o) => [o.id, o.form])).toEqual([
			[900, BAND],
			[901, H.caps.band.includes('ribbon') ? 'ribbon' : BAND],
			[902, LINE]
		]);
		expect(warn).not.toHaveBeenCalled();
	});

	it('deleting an overlay is one undo step', () => {
		const plot = makePlot(type);
		const o = typedLine(plot.plot, LINE, [lineAt]);
		removeOverlayWithUndo(plot.plot, o.id);
		expect(plot.plot.overlays).toHaveLength(0);
		history.undo();
		expect(plot.plot.overlays.map((x) => [x.id, x.values('at')])).toEqual([[o.id, [lineAt]]]);
	});

	if (H.facet) {
		it('a faceted plot draws its overlays on every panel, with clip ids that differ per panel', () => {
			const gen = makePlot(type, { facet: true });
			typedLine(gen.plot, LINE, [lineAt]);
			typedBand(gen.plot, BAND, bandAt[0], bandAt[1]);
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
	}

	it('the Overlays tab offers + Line and + Band and adds overlays in the default forms', async () => {
		const plot = makePlot(type);
		appState.currentControlTab = 'overlays';
		const { getByText, container } = render(H.Component, {
			props: { theData: plot.plot, which: 'controls' }
		});
		await fireEvent.click(getByText('+ Line'));
		await fireEvent.click(getByText('+ Band'));
		expect(plot.plot.overlays.map((o) => [o.kind, o.form])).toEqual([
			['line', LINE],
			['band', BAND]
		]);
		// A kind with a single allowed form shows it, but offers no choice.
		await tick();
		const selects = [...container.querySelectorAll('select.overlay-form')];
		expect(selects.map((s) => s.disabled)).toEqual([
			H.caps.line.length < 2,
			H.caps.band.length < 2
		]);
		appState.currentControlTab = 'properties';
	});

	if (H.zoomTo) {
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
	} else {
		it('has no brush zoom, so there is nothing for overlays to keep in step with', () => {
			expect(isZoomCapable(type)).toBe(false);
		});
	}

	it(`the canvas drop port creates a ${LINE} line wired to the dropped column`, () => {
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
			plotMap: new Map([[type, { defaultInputs: H.inputs }]])
		};
		const graph = getCachedProcessNodeGraph(fakeCore, fakeConsts);
		const node = graph.nodes.find((n) => n.id === `plot_${plot.id}`);
		expect(node.ports.inputs.map((p) => p.name)).toContain(NEW_LINE_PORT);

		const col = mkCol('peak', [24.5]);
		expect(applyOverlayWire(plot.plot, NEW_LINE_PORT, col)).toBe(true);
		const [line] = plot.plot.overlays;
		expect([line.kind, line.form, line.wiredRefIds('at')]).toEqual(['line', LINE, [col]]);
	});

	it("adds no overlay columns to the plot's computed data (decision Q5)", () => {
		const inner = makePlot(type).plot;
		const before = JSON.parse(JSON.stringify(inner.getDownloadData()));
		typedLine(inner, LINE, [lineAt]).label = 'x';
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

describe('periodogram: log power axis (display only)', () => {
	/** A chi-squared-shaped spectrum with a threshold, so the threshold line is drawn too. */
	function chiSpectrum(inner) {
		const x = [];
		const y = [];
		const threshold = [];
		for (let p = 1; p <= 30; p += 0.5) {
			x.push(p);
			y.push(0.005 + 400 * Math.exp(-((p - 24) ** 2) / 4));
			threshold.push(20 + p);
		}
		for (const d of inner.data) {
			d.method = 'Chi-squared';
			d.periodData = { x, y, threshold, pvalue: x.map(() => 0.5), df: x.map(() => 10) };
		}
	}

	it('a horizontal line, the series and the threshold all land on the log scale', async () => {
		const plot = makePlot('periodogram');
		const inner = plot.plot;
		chiSpectrum(inner);
		// Fewer decades than ticks asked for, so d3 adds the 2..9 minor ticks between decades.
		inner.yAxis.nticks = 10;
		typedLine(inner, 'horizontal', [100]);
		const { container } = render(Periodogram, { props: { theData: plot, which: 'plot' } });
		inner.logScale = true;
		flushSync();
		await tick();
		const ys = inner.overlayYScale;
		expect(typeof ys.base).toBe('function'); // a d3 log scale
		expect(ys).toBe(inner.yScale);
		// The lower end follows the smallest value drawn (0.005), not a 1e-6 floor.
		const [lo, hi] = ys.domain();
		expect(lo).toBeLessThan(0.005);
		expect(lo).toBeGreaterThan(0.002);
		expect(hi).toBe(inner.ylims[1]);
		const rule = container.querySelector('g.overlay-lines-layer line.overlay-rule');
		close(num(rule, 'y1'), inner.padding.top + ys(100));
		// 100 on a log axis from ~0.003 to ~500 sits in the top fifth; on the linear axis it
		// would be near the bottom fifth.
		expect(ys(100)).toBeLessThan(inner.plotheight / 5);
		// The left axis labels whole decades in plain numbers (no SI "100m").
		const labels = [...container.querySelectorAll('.axis-left .tick text')]
			.map((t) => t.textContent.trim())
			.filter(Boolean);
		expect(labels).toContain('100');
		expect(labels).toContain('0.01');
		expect(labels.some((l) => /[a-zµ]$/.test(l))).toBe(false);
		// Gridlines only at labelled ticks, not at each of the ~30 minor ones.
		const allTicks = container.querySelectorAll('.axis-left .tick').length;
		const grid = container.querySelectorAll('.axis-left .gridline').length;
		expect(allTicks).toBeGreaterThan(labels.length);
		expect(grid).toBeGreaterThan(0);
		expect(grid).toBeLessThanOrEqual(labels.length);
		const tick100 = [...container.querySelectorAll('.axis-left .tick')].find(
			(t) => t.textContent.trim() === '100'
		);
		expect(Math.abs(tickXY(tick100)[1] - ys(100))).toBeLessThanOrEqual(0.5);
		// No NaN coordinates anywhere in the series or threshold paths.
		for (const path of container.querySelectorAll('path')) {
			expect(path.getAttribute('d') ?? '').not.toMatch(/NaN|Infinity/);
		}
	});

	it('a non-positive value is a gap, not a NaN path, and a mark at or below 0 is not drawn', () => {
		const plot = makePlot('periodogram');
		const inner = plot.plot;
		chiSpectrum(inner);
		inner.data[0].periodData.y[3] = 0;
		inner.logScale = true;
		typedLine(inner, 'horizontal', [0, -1, 50]);
		const { container } = render(Periodogram, { props: { theData: plot, which: 'plot' } });
		expect(container.querySelectorAll('line.overlay-rule')).toHaveLength(1);
		for (const path of container.querySelectorAll('path')) {
			expect(path.getAttribute('d') ?? '').not.toMatch(/NaN|Infinity/);
		}
		expect(inner.drawableY(inner.data[0].periodData.y)[3]).toBeNaN();
	});

	it('a user minimum wins, and the log domain never reaches 0', () => {
		const inner = makePlot('periodogram').plot;
		chiSpectrum(inner);
		inner.logScale = true;
		inner.ylimsIN = [2, null];
		expect(inner.yScale.domain()[0]).toBe(2);
		inner.ylimsIN = [0, null];
		expect(inner.yScale.domain()[0]).toBeGreaterThan(0);
	});

	it('is saved, restored, and absent from an old session as off', () => {
		const inner = makePlot('periodogram').plot;
		expect(inner.logScale).toBe(false);
		inner.logScale = true;
		const json = JSON.parse(JSON.stringify(inner.toJSON()));
		expect(json.logScale).toBe(true);
		const Cls = inner.constructor;
		expect(Cls.fromJSON(inner.parentBox, json).logScale).toBe(true);
		delete json.logScale;
		expect(Cls.fromJSON(inner.parentBox, json).logScale).toBe(false);
	});

	it('brush zoom reads the log scale', () => {
		const plot = makePlot('periodogram');
		chiSpectrum(plot.plot);
		plot.plot.logScale = true;
		const yAxis = getZoomAdapter(plot).axes.find((a) => a.orient === 'y');
		expect(typeof yAxis.scale().base).toBe('function');
	});
});

describe.each(['boxplot', 'meansem'])('%s: horizontal marks on a categorical x axis', (type) => {
	it('a horizontal line typed above the data widens y to a nice limit and sits on that tick', async () => {
		const plot = makePlot(type);
		const inner = plot.plot;
		const top0 = inner.ylims[1];
		typedLine(inner, 'horizontal', [37]);
		expect(top0).toBeLessThan(37);
		// Merged before the nice rounding, so the axis ends on a round number above the line.
		expect(inner.ylims[1]).toBe(niceAxisLimit(37, 'ceil'));

		const { container } = render(HOSTS[type].Component, {
			props: { theData: plot, which: 'plot' }
		});
		await tick();
		const rule = container.querySelector('g.overlay-lines-layer line.overlay-rule');
		const y = num(rule, 'y1');
		close(y, inner.padding.top + inner.overlayYScale(37));
		// The y axis is drawn with the same scale: its 40 tick sits where 40 maps.
		const tick40 = [...container.querySelectorAll('.axis-left .tick')].find(
			(t) => t.textContent.trim() === '40'
		);
		expect(tick40).toBeTruthy();
		const ty = Number(/translate\([^,]+,\s*([^)]+)\)/.exec(tick40.getAttribute('transform'))[1]);
		// d3-axis shifts ticks by half a pixel for crisp 1 px strokes.
		expect(Math.abs(ty - inner.overlayYScale(40))).toBeLessThanOrEqual(0.5);
	});

	it('the x range stays the categories', () => {
		const inner = makePlot(type).plot;
		const before = [...inner.xlims];
		typedLine(inner, 'horizontal', [37]);
		typedBand(inner, 'horizontal', -5, 0);
		expect(inner.xlims).toEqual(before);
		expect(before).toEqual([-0.5, 2.5]);
	});
});

describe('boxplot overlays and significance bars', () => {
	it('the bracket headroom is added on top of the range the overlays widened', () => {
		const inner = makePlot('boxplot').plot;
		inner.showSigBars = true;
		inner.showNs = true; // every pair gets a bracket, significant or not
		expect(inner.sigBarLevels.length).toBeGreaterThan(0);
		typedLine(inner, 'horizontal', [-30]);
		const [lo, hi] = inner.ylims;
		expect(lo).toBeLessThanOrEqual(-30);
		// The brackets are drawn from the group maximum up, one step (10% of the axis span) per
		// level: the topmost must still be inside the axis.
		const { dataMax } = inner.sigBarResult;
		const step = (hi - lo) * 0.1 * inner.sigBarSpacing;
		const topLevel = Math.max(...inner.sigBarLevels.map((e) => e.level));
		expect(dataMax + step * (topLevel + 1)).toBeLessThanOrEqual(hi);
	});

	it('a single category-coloured series has no series legend, but a labelled overlay still shows', () => {
		const plot = makePlot('boxplot');
		plot.plot.removeData(1);
		expect(plot.plot.categoryColoured).toBe(true);
		expect(plot.plot.getLegendItems).toEqual([]);
		typedLine(plot.plot, 'horizontal', [10]).label = 'threshold';
		expect(plot.plot.getLegendItems.map((i) => i.label)).toEqual(['threshold']);
	});
});

/** The `[x, y]` translate of an axis tick. */
const tickXY = (t) =>
	/translate\(([^,]+),\s*([^)]+)\)/.exec(t.getAttribute('transform')).slice(1).map(Number);

describe('fft: vertical positions are periods, drawn at 1/p on a frequency axis (decision Q3)', () => {
	const fftPlot = () => makePlot('fft');

	it('overlayXTransform is the period in period mode and 1/p in frequency mode; p <= 0 has no place', () => {
		const inner = fftPlot().plot;
		expect(inner.overlayXTransform(24)).toBe(24);
		inner.showPeriod = false;
		expect(inner.overlayXTransform(24)).toBe(1 / 24);
		expect(inner.overlayXTransform(0.5)).toBe(2);
		for (const mode of [false, true]) {
			inner.showPeriod = mode;
			expect(inner.overlayXTransform(0)).toBeNull();
			expect(inner.overlayXTransform(-24)).toBeNull();
		}
	});

	it('a 24 h line sits on the 24 tick, moves to 1/24 in frequency mode and back, saved as 24 throughout', async () => {
		const plot = fftPlot();
		const inner = plot.plot;
		const line = typedLine(inner, 'vertical', [24]);
		const band = typedBand(inner, 'vertical', 20, 28);
		inner.xlimsIN = [18, 30]; // ticks every 2 h, so there is a 24 tick
		const { container } = render(FFT, { props: { theData: plot, which: 'plot' } });
		const rule = () => container.querySelector('g.overlay-lines-layer line.overlay-rule');
		const rect = () => container.querySelector('g.overlay-bands-layer rect.band-rect');
		const { left } = inner.padding;

		// Period mode: on the x axis's own 24 tick.
		const tick24 = [...container.querySelectorAll('.axis-bottom .tick')].find(
			(t) => t.textContent.trim() === '24'
		);
		expect(tick24).toBeTruthy();
		expect(Math.abs(num(rule(), 'x1') - left - tickXY(tick24)[0])).toBeLessThanOrEqual(0.5);
		close(num(rect(), 'x'), left + inner.overlayXScale(20));

		// Frequency mode: the same overlay is drawn at 1/24 cycles per hour, the band from 1/28
		// to 1/20, and nothing stored changes.
		inner.showPeriod = false;
		inner.xlimsIN = [0, 0.1];
		flushSync();
		await tick();
		expect(inner.overlayXScale.domain()).toEqual([0, 0.1]);
		close(num(rule(), 'x1'), left + inner.overlayXScale(1 / 24));
		close(num(rect(), 'x'), left + inner.overlayXScale(1 / 28));
		close(num(rect(), 'width'), inner.overlayXScale(1 / 20) - inner.overlayXScale(1 / 28));
		expect(line.values('at')).toEqual([24]);
		expect(line.toJSON().channels.at.typed).toEqual([24]);
		expect(band.toJSON().channels.start.typed).toEqual([20]);

		// And back.
		inner.showPeriod = true;
		inner.xlimsIN = [4, 48];
		flushSync();
		await tick();
		close(num(rule(), 'x1'), left + inner.overlayXScale(24));
	});

	it('the out-of-range note reads frequency units in frequency mode and never widens x', () => {
		const inner = fftPlot().plot;
		inner.showPeriod = false;
		inner.xlimsIN = [0.05, 0.5];
		const o = typedLine(inner, 'vertical', [24]); // 1/24 is below 0.05
		expect(inner.xlims).toEqual([0.05, 0.5]);
		expect(overlayRangeNote(inner, o)).toBe(
			'Outside the visible x range (0.05 to 0.5), so it is not drawn. Overlays never widen the period or frequency range; change the x limits in Properties.'
		);
	});

	it('log magnitude: a horizontal line lands on the log scale and survives the remount', async () => {
		const plot = fftPlot();
		const inner = plot.plot;
		typedLine(inner, 'horizontal', [2]);
		typedLine(inner, 'vertical', [24]);
		const { container } = render(FFT, { props: { theData: plot, which: 'plot' } });
		const layersBefore = [...container.querySelectorAll('g[class^="overlay-"]')];
		expect(layersBefore).toHaveLength(2);
		inner.logScale = true;
		flushSync();
		await tick();
		// Both layers sit inside the plot's {#key}: they remount with the axes.
		const layersAfter = [...container.querySelectorAll('g[class^="overlay-"]')];
		expect(layersAfter).toHaveLength(2);
		layersAfter.forEach((g, i) => expect(g).not.toBe(layersBefore[i]));
		const ys = inner.overlayYScale;
		// The Periodogram's log axis (plots/logAxis.js): from the smallest positive value drawn.
		expect(ys).toBe(inner.yScale);
		expect(ys.domain()).toEqual(logAxisDomain(null, inner.minPositiveY, inner.ylims[1]));
		expect(typeof ys.base).toBe('function'); // a d3 log scale
		const rules = container.querySelectorAll('g.overlay-lines-layer line.overlay-rule');
		expect(rules).toHaveLength(2);
		const h = [...rules].find((r) => num(r, 'y1') === num(r, 'y2'));
		close(num(h, 'y1'), inner.padding.top + ys(2));
		// The magnitude axis is drawn with the same scale.
		const tick2 = [...container.querySelectorAll('.axis-left .tick')].find(
			(t) => t.textContent.trim() === '2'
		);
		if (tick2) expect(Math.abs(tickXY(tick2)[1] - ys(2))).toBeLessThanOrEqual(0.5);
	});

	it('a horizontal mark at or below 0 on a log axis is not drawn (no NaN coordinates)', () => {
		const plot = fftPlot();
		const inner = plot.plot;
		inner.logScale = true;
		typedLine(inner, 'horizontal', [0, -1, 2]);
		typedBand(inner, 'horizontal', -1, 1);
		const { container } = render(FFT, { props: { theData: plot, which: 'plot' } });
		const rules = [...container.querySelectorAll('line.overlay-rule')];
		expect(rules).toHaveLength(1);
		for (const el of container.querySelectorAll(
			'g[class^="overlay-"] line, g[class^="overlay-"] rect'
		)) {
			for (const a of ['x', 'y', 'width', 'height', 'x1', 'x2', 'y1', 'y2']) {
				if (el.hasAttribute(a)) expect(Number.isFinite(num(el, a))).toBe(true);
			}
		}
	});

	it('the phase axis never carries overlays: they use the magnitude scale', () => {
		const inner = fftPlot().plot;
		inner.data[0].showPhase = true;
		expect(inner.overlayYScale.domain()).toEqual([inner.ylims[0], inner.ylims[1]]);
		expect(inner.overlayYScale.domain()).not.toEqual(inner.phaseYlims);
		const before = [...inner.phaseYlims];
		typedLine(inner, 'horizontal', [inner.ylims[1] + 40]);
		expect(inner.phaseYlims).toEqual(before);
	});

	it('the Overlays tab says vertical positions are periods, on blocks that read x only', async () => {
		const plot = fftPlot();
		plot.plot.showPeriod = false;
		typedLine(plot.plot, 'vertical', [24]);
		typedLine(plot.plot, 'horizontal', [2]);
		appState.currentControlTab = 'overlays';
		const { container } = render(FFT, { props: { theData: plot.plot, which: 'controls' } });
		await tick();
		const notes = [...container.querySelectorAll('.overlay-x-note')].map((n) =>
			n.textContent.trim()
		);
		expect(notes).toEqual([FFT_X_NOTE]);
		appState.currentControlTab = 'properties';
	});
});

// v82.9: the FFT's log magnitude axis is the Periodogram's (plots/logAxis.js). It used to run
// from max(0, 1e-6) (the linear lower end through the floor), leaving most of the height to
// decades below the data, and labelled ticks with SI prefixes ("10m").
describe('fft: log magnitude axis, as the periodogram', () => {
	/** A noisy 24 h rhythm on a DC offset: the smallest magnitude is well above 1e-6. */
	function noisyFft() {
		const t = mkCol('t', HOURS);
		const y = mkCol(
			'n',
			HOURS.map((h, i) => 10 + 5 * Math.cos((2 * Math.PI * h) / 24) + ((i * 7919) % 13) / 10)
		);
		const plot = new Plot({
			type: 'fft',
			name: 'fft',
			width: 500,
			height: 300,
			plot: { data: [] }
		});
		plot.plot.addData({ x: { refId: t }, y: { refId: y } });
		core.plots.push(plot);
		return plot;
	}

	it('starts at the smallest magnitude drawn, labels plain numbers, grids labelled ticks only', async () => {
		const plot = noisyFft();
		const inner = plot.plot;
		inner.yAxisMag.nticks = 10;
		inner.logScale = true;
		const { container } = render(FFT, { props: { theData: plot, which: 'plot' } });
		flushSync();
		await tick();
		const ys = inner.yScale;
		expect(typeof ys.base).toBe('function');
		const [lo, hi] = ys.domain();
		const minPos = inner.minPositiveY;
		expect(minPos).toBeGreaterThan(1e-3);
		expect(lo).toBeLessThan(minPos);
		expect(lo).toBeGreaterThan(minPos / 2);
		expect(hi).toBe(inner.ylims[1]);
		const labels = [...container.querySelectorAll('.axis-left .tick text')]
			.map((t) => t.textContent.trim())
			.filter(Boolean);
		expect(labels.length).toBeGreaterThan(1);
		expect(labels.some((l) => /[a-zµ]$/.test(l))).toBe(false);
		for (const l of labels) expect(Number.isFinite(Number(l))).toBe(true);
		const grid = container.querySelectorAll('.axis-left .gridline').length;
		expect(grid).toBeLessThanOrEqual(labels.length);
		for (const path of container.querySelectorAll('path')) {
			expect(path.getAttribute('d') ?? '').not.toMatch(/NaN|Infinity/);
		}
	});

	it('a zero magnitude is a gap, and a user minimum wins', () => {
		const inner = noisyFft().plot;
		inner.logScale = true;
		expect(inner.drawableY([0, -1, 2])).toEqual([NaN, NaN, 2]);
		inner.ylimsIN = [0.5, null];
		expect(inner.yScale.domain()[0]).toBe(0.5);
		inner.ylimsIN = [0, null];
		// 0 cannot be a log limit: back to the automatic end, not the 1e-6 floor.
		expect(inner.yScale.domain()[0]).toBeGreaterThan(inner.minPositiveY / 2);
	});

	it('brush zoom reads the scale the magnitudes are drawn with', () => {
		const plot = noisyFft();
		plot.plot.logScale = true;
		const yAxis = getZoomAdapter(plot).axes.find((a) => a.orient === 'y');
		expect(yAxis.scale()).toBe(plot.plot.yScale);
		expect(typeof yAxis.scale().base).toBe('function');
	});
});

describe('cwt: horizontal lines and bands on the period axis', () => {
	it.each([true, false])(
		'a 24 h line lands on periodToY(24) and the 24 tick (log axis: %s)',
		(log) => {
			const plot = makePlot('cwt');
			const inner = plot.plot;
			inner.logScale = log;
			typedLine(inner, 'horizontal', [24]);
			const { container } = render(CWT, { props: { theData: plot, which: 'plot' } });
			const { periods } = inner.transform;
			const H = inner.plotheight;
			const expected = periodToY(24, periods, H, log);
			close(inner.overlayYScale(24), expected);
			close(inner.overlayYScale(periods[0]), H);
			close(inner.overlayYScale(periods.at(-1)), 0);
			const rule = container.querySelector('g.overlay-lines-layer line.overlay-rule');
			close(num(rule, 'y1'), inner.padding.top + expected);
			// The period axis tick labelled 24 is drawn at the same height.
			const label = [...container.querySelectorAll('text')].find(
				(t) => t.textContent.trim() === '24'
			);
			expect(label).toBeTruthy();
			close(num(label, 'y'), expected);
			// Across the plot width.
			close(num(rule, 'x1'), inner.padding.left);
			close(num(rule, 'x2'), inner.padding.left + inner.plotwidth);
		}
	);

	it('the x scale is hours since the start across the plot width', () => {
		const inner = makePlot('cwt').plot;
		const { times } = inner.transform;
		expect(inner.overlayXScale.domain()).toEqual([times[0], times.at(-1)]);
		expect(inner.overlayXScale.range()).toEqual([0, inner.plotwidth]);
	});

	it('an overlay never changes the period range it is computed over, and says so', () => {
		const inner = makePlot('cwt').plot;
		const o = typedLine(inner, 'horizontal', [100]);
		expect([inner.periodMin, inner.periodMax]).toEqual([1, 48]);
		const [lo, hi] = inner.overlayYScale.domain();
		expect(overlayRangeNote(inner, o)).toBe(
			`Outside the visible y range (${Number(lo.toPrecision(4))} to ${Number(
				hi.toPrecision(4)
			)}), so it is not drawn. Overlays never widen the period range, because it is the range the scalogram is computed over; change Min and Max period in Properties.`
		);
	});

	it('bands sit over the power image and under the cone of influence; lines above everything', () => {
		const plot = makePlot('cwt');
		typedBand(plot.plot, 'horizontal', 20, 28);
		typedLine(plot.plot, 'horizontal', [24]);
		const { container } = render(CWT, { props: { theData: plot, which: 'plot' } });
		const svg = container.querySelector('svg');
		const bands = svg.querySelector('g.overlay-bands-layer');
		const lines = svg.querySelector('g.overlay-lines-layer');
		const coi = svg.querySelector('polyline');
		const frame = [...svg.querySelectorAll('rect')].find((r) => r.getAttribute('fill') === 'none');
		const follows = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
		expect(follows(bands, coi)).toBe(true);
		expect(follows(frame, lines)).toBe(true);
	});

	it('the Overlays tab has no Label field (the scalogram has no series legend)', async () => {
		const plot = makePlot('cwt');
		typedLine(plot.plot, 'horizontal', [24]);
		appState.currentControlTab = 'overlays';
		const { container } = render(CWT, { props: { theData: plot.plot, which: 'controls' } });
		await tick();
		expect(container.querySelector('.overlay-form')).toBeTruthy();
		expect(container.querySelector('input[placeholder="shown in legend when set"]')).toBeNull();
		appState.currentControlTab = 'properties';
	});

	it('no overlays without a signal: the plot shows its prompt and nothing else', () => {
		const plot = new Plot({
			type: 'cwt',
			name: 'cwt',
			width: 500,
			height: 300,
			plot: { data: [] }
		});
		core.plots.push(plot);
		typedLine(plot.plot, 'horizontal', [24]);
		const { container } = render(CWT, { props: { theData: plot, which: 'plot' } });
		expect(container.querySelector('line.overlay-rule')).toBeNull();
		expect(container.textContent).toContain('Wire a time column and a value column.');
	});
});
