// @ts-nocheck
/**
 * Golden tests for scatterplot overlays (overlays plan 2026-10-15, T1).
 *
 * Written against v81.13, BEFORE the overlay code was extracted into
 * components/plotbits (step 1, v81.14), and required to pass UNCHANGED after it: the
 * extraction must not move a pixel, a saved byte, a legend item, a CSV column or a port.
 * Do not update these expectations to make a refactor pass; a difference here is a
 * user-visible change and needs its own decision.
 *
 * Deliberate changes since v81.13, each decided in the plan:
 *   - v82.1 (step 2, "Duplicate clip ids"): every overlay clip-path id gained a
 *     `p<plotId>-ov<overlayId>-` prefix (a facet panel's id made url-safe, `p500_y2_0-`), so
 *     two overlays, or two same-size plots, no longer write one id twice into a document.
 *     Only the ids moved; every coordinate, colour and element is as it was.
 *
 * Each fixture in __fixtures__/ is a scatterplot inner JSON plus the raw data of the columns
 * it reads. For each one this pins:
 *   - toJSON after fromJSON (the saved shape, including legacy migrations);
 *   - the outerHTML of both overlay layers (bands beneath the series, lines above);
 *   - xlims, ylimsLeft and ylimsRight (overlays widen the automatic domain);
 *   - getLegendItems and getDownloadData;
 *   - the plot node's ports on the workflow canvas.
 * And, once, the scatterplot entry of the generated MCP catalogue.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { panelsFor, projectPanel } from '$lib/core/facetPanels.svelte.js';
import {
	getCachedProcessNodeGraph,
	clearProcessNodeGraphCache
} from '$lib/core/ProcessNode.svelte.js';
import Scatterplot from './Scatterplot.svelte';

const FIXTURES = join(process.cwd(), 'src/lib/plots/Scatterplot/__fixtures__');
const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));

beforeEach(async () => {
	appConsts.plotMap = await loadPlots();
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	appState.gridSize = 15;
	clearProcessNodeGraphCache();
});
afterEach(() => cleanup());

/** Register the fixture's columns (fixed ids, real Column instances, raw data in core). */
function loadColumns(columns) {
	for (const c of columns) {
		const col = new Column({ type: c.type, data: c.id }, c.id);
		col.customName = c.name;
		core.rawData.set(c.id, c.values);
		core.data.push(col);
	}
}

/** The plot node's ports on the canvas, as the editor reads them. */
function portsOf(plot) {
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
		plotMap: new Map([['scatterplot', { defaultInputs: ['x', 'y'] }]])
	};
	const graph = getCachedProcessNodeGraph(fakeCore, fakeConsts);
	const node = graph.nodes.find((n) => n.id === `plot_${plot.id}`);
	return {
		inputs: node.ports.inputs.map((p) => ({
			name: p.name,
			display: p.display ?? null,
			channel: p.channel ?? null,
			overlay: p.overlay ?? null,
			dynamic: !!p.dynamic
		})),
		outputs: node.ports.outputs.map((p) => p.name),
		edges: graph.connections
			.filter((c) => c.toId === node.id)
			.map((c) => JSON.parse(JSON.stringify(c)))
	};
}

/** Everything the model exposes that the extraction must keep. */
function modelOf(inner) {
	return JSON.parse(
		JSON.stringify({
			json: inner.toJSON(),
			limits: { xlims: inner.xlims, ylimsLeft: inner.ylimsLeft, ylimsRight: inner.ylimsRight },
			legend: inner.getLegendItems,
			download: inner.getDownloadData()
		})
	);
}

/** Render a plot wrapper (a Plot or a facet panel) and return both overlay layers. */
function layersOf(theData) {
	const { container, unmount } = render(Scatterplot, { props: { theData, which: 'plot' } });
	const out = {
		bands: container.querySelector('g.overlay-bands-layer')?.outerHTML ?? null,
		lines: container.querySelector('g.overlay-lines-layer')?.outerHTML ?? null
	};
	unmount();
	return out;
}

/** Load a non-faceted fixture: the model is snapshotted here, the layers are returned. */
function golden(name) {
	const fx = fixture(name);
	loadColumns(fx.columns);
	const { id, name: plotName, width, height, inner } = fx.plot;
	const plot = new Plot({ type: 'scatterplot', name: plotName, width, height, plot: inner }, id);
	core.plots.push(plot);
	expect(modelOf(plot.plot)).toMatchSnapshot('model');
	expect(portsOf(plot)).toMatchSnapshot('ports');
	return layersOf(plot);
}

describe('scatterplot overlay goldens (v81.13)', () => {
	it('demo-tp-crossing', () => {
		const { bands, lines } = golden('demo-tp-crossing');
		expect(bands).toMatchInlineSnapshot(`"<g class="overlay-bands-layer"><!----><!----></g>"`);
		expect(lines).toMatchInlineSnapshot(
			`"<g class="overlay-lines-layer"><!----><!----><!----><!----><!----><!----><clipPath id="p106-ov0-rules-30-15-460-255"><rect x="30" y="15" width="460" height="255"></rect></clipPath><g clip-path="url(#p106-ov0-rules-30-15-460-255)"><!----><line class="overlay-rule" style="pointer-events: none;" x1="30" x2="490" y1="235.125" y2="235.125" stroke="#BE796B" stroke-width="1.5" stroke-dasharray="5, 5"></line></g><!----><!----><!----><!----><!----><!----><clipPath id="p106-ov1-rules-30-15-460-255"><rect x="30" y="15" width="460" height="255"></rect></clipPath><g clip-path="url(#p106-ov1-rules-30-15-460-255)"><!----><line class="overlay-rule" style="pointer-events: none;" x1="43.22448979591836" x2="43.22448979591836" y1="15" y2="270" stroke="#C0392B" stroke-width="1.5" stroke-dasharray="5, 5"></line><!----><line class="overlay-rule" style="pointer-events: none;" x1="246.16326530612244" x2="246.16326530612244" y1="15" y2="270" stroke="#C0392B" stroke-width="1.5" stroke-dasharray="5, 5"></line><!----><line class="overlay-rule" style="pointer-events: none;" x1="467.5510204081633" x2="467.5510204081633" y1="15" y2="270" stroke="#C0392B" stroke-width="1.5" stroke-dasharray="5, 5"></line></g></g>"`
		);
	});

	it('legacy nightBands (repeating, custom in both shapes) on a time x axis', () => {
		const { bands, lines } = golden('legacy-nightbands-time');
		expect(bands).toMatchInlineSnapshot(
			`"<g class="overlay-bands-layer"><!----><!----><!----><!----><!----><clipPath id="p500-ov2-band-2-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g class="overlay-band" style="pointer-events: none;" clip-path="url(#p500-ov2-band-2-40-15-410-255)"><!----><rect class="band-rect" x="44.00000080950768" y="15" width="66.99999998865177" height="255" fill="#2C2C2C30"></rect><!----><rect class="band-rect" x="178.0000007868112" y="15" width="66.99999998865175" height="255" fill="#2C2C2C30"></rect><!----><rect class="band-rect" x="312.0000007641147" y="15" width="66.99999998865178" height="255" fill="#2C2C2C30"></rect><!----><rect class="band-rect" x="446.0000007414182" y="15" width="3.9999999992094786" height="255" fill="#2C2C2C30"></rect><!----><!----></g><!----><!----><!----><!----><!----><clipPath id="p500-ov3-band-3-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g class="overlay-band" style="pointer-events: none;" clip-path="url(#p500-ov3-band-3-40-15-410-255)"><!----><rect class="band-rect" x="99.83333413338414" y="15" width="27.916666661938237" height="255" fill="#00000040"></rect><!----><!----></g><!----><!----><!----><!----><!----><clipPath id="p500-ov4-band-4-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g class="overlay-band" style="pointer-events: none;" clip-path="url(#p500-ov4-band-4-40-15-410-255)"><!----><rect class="band-rect" x="323.16666742889004" y="15" width="27.916666661938223" height="255" fill="#33006640"></rect><!----><!----></g></g>"`
		);
		expect(lines).toMatchInlineSnapshot(
			`"<g class="overlay-lines-layer"><!----><!----><!----></g>"`
		);
	});

	it('legacy multi-column `at` splits into one Line per column', () => {
		const { bands, lines } = golden('legacy-multi-at');
		expect(bands).toMatchInlineSnapshot(
			`"<g class="overlay-bands-layer"><!----><!----><!----><!----></g>"`
		);
		expect(lines).toMatchInlineSnapshot(
			`"<g class="overlay-lines-layer"><!----><!----><!----><!----><!----><!----><clipPath id="p500-ov0-rules-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g clip-path="url(#p500-ov0-rules-40-15-410-255)"><!----><line class="overlay-rule" style="pointer-events: none;" x1="40" x2="450" y1="100.98930302523816" y2="100.98930302523816" stroke="#2C2C2C" stroke-width="1.5" stroke-dasharray="5, 5"></line></g><!----><!----><!----><!----><!----><!----><clipPath id="p500-ov1-rules-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g clip-path="url(#p500-ov1-rules-40-15-410-255)"><!----><line class="overlay-rule" style="pointer-events: none;" x1="84.2" x2="84.2" y1="15" y2="270" stroke="#2980B9" stroke-width="2"></line><!----><line class="overlay-rule" style="pointer-events: none;" x1="124.39999999999999" x2="124.39999999999999" y1="15" y2="270" stroke="#2980B9" stroke-width="2"></line></g><!----><!----><!----><!----><!----><!----><clipPath id="p500-ov5-rules-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g clip-path="url(#p500-ov5-rules-40-15-410-255)"><!----><line class="overlay-rule" style="pointer-events: none;" x1="224.9" x2="224.9" y1="15" y2="270" stroke="#2980B9" stroke-width="2"></line></g><!----><!----><!----><!----><!----><!----><clipPath id="p500-ov6-rules-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g clip-path="url(#p500-ov6-rules-40-15-410-255)"><!----><line class="overlay-rule" style="pointer-events: none;" x1="345.5" x2="345.5" y1="15" y2="270" stroke="#2980B9" stroke-width="2"></line><!----><line class="overlay-rule" style="pointer-events: none;" x1="385.7" x2="385.7" y1="15" y2="270" stroke="#2980B9" stroke-width="2"></line></g></g>"`
		);
	});

	it('ribbon wired to three columns', () => {
		const { bands, lines } = golden('ribbon-three-columns');
		expect(bands).toMatchInlineSnapshot(
			`"<g class="overlay-bands-layer"><!----><!----><!----><!----><!----><clipPath id="p500-ov0-band-0-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g class="overlay-band" style="pointer-events: none;" clip-path="url(#p500-ov0-band-0-40-15-410-255)"><path class="band-ribbon" stroke="none" d="M44,117.8L77.5,93.1L161.25,68.4L245,43.7L328.75,68.4L446,19L446,266L328.75,241.3L245,216.6L161.25,228.95L77.5,241.3L44,266Z" fill="#1F77B433"></path><!----><!----></g></g>"`
		);
		expect(lines).toMatchInlineSnapshot(`"<g class="overlay-lines-layer"><!----></g>"`);
	});

	it('typed horizontal band', () => {
		const { bands, lines } = golden('typed-h-band');
		expect(bands).toMatchInlineSnapshot(
			`"<g class="overlay-bands-layer"><!----><!----><!----><!----><!----><clipPath id="p500-ov0-band-0-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g class="overlay-band" style="pointer-events: none;" clip-path="url(#p500-ov0-band-0-40-15-410-255)"><!----><rect class="band-rect" x="40" y="167.2444733420026" width="410" height="74.1222366710013" fill="#27AE6040"></rect><!----><line class="band-edge" x1="40" y1="241.3667100130039" x2="450" y2="241.3667100130039" stroke="#27AE60" stroke-width="1.5"></line><line class="band-edge" x1="40" y1="167.2444733420026" x2="450" y2="167.2444733420026" stroke="#27AE60" stroke-width="1.5"></line><!----><rect class="band-rect" x="40" y="18.999999999999957" width="410" height="74.1222366710013" fill="#27AE6040"></rect><!----><line class="band-edge" x1="40" y1="93.12223667100126" x2="450" y2="93.12223667100126" stroke="#27AE60" stroke-width="1.5"></line><line class="band-edge" x1="40" y1="18.999999999999957" x2="450" y2="18.999999999999957" stroke="#27AE60" stroke-width="1.5"></line><!----><!----></g></g>"`
		);
		expect(lines).toMatchInlineSnapshot(`"<g class="overlay-lines-layer"><!----></g>"`);
	});

	it('wired vertical band on a time x axis', () => {
		const { bands, lines } = golden('wired-v-band');
		expect(bands).toMatchInlineSnapshot(
			`"<g class="overlay-bands-layer"><!----><!----><!----><!----><!----><clipPath id="p500-ov0-band-0-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g class="overlay-band" style="pointer-events: none;" clip-path="url(#p500-ov0-band-0-40-15-410-255)"><!----><rect class="band-rect" x="74.15000053297001" y="15" width="60.30000005821648" height="255" fill="#F1C40F40"></rect><!----><rect class="band-rect" x="194.75000064940295" y="15" width="60.300000058216455" height="255" fill="#F1C40F40"></rect><!----><rect class="band-rect" x="315.35000076583583" y="15" width="130.65000012613575" height="255" fill="#F1C40F40"></rect><!----><!----></g></g>"`
		);
		expect(lines).toMatchInlineSnapshot(`"<g class="overlay-lines-layer"><!----></g>"`);
	});

	it('disabled overlays', () => {
		const { bands, lines } = golden('disabled-overlay');
		expect(bands).toMatchInlineSnapshot(
			`"<g class="overlay-bands-layer"><!----><!----><!----></g>"`
		);
		expect(lines).toMatchInlineSnapshot(
			`"<g class="overlay-lines-layer"><!----><!----><!----><!----><!----><!----><!----><!----><clipPath id="p500-ov2-rules-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g clip-path="url(#p500-ov2-rules-40-15-410-255)"><!----><line class="overlay-rule" style="pointer-events: none;" x1="40" x2="450" y1="142.27293999665721" y2="142.27293999665721" stroke="#C0392B" stroke-width="1.5" stroke-dasharray="5, 5"></line></g></g>"`
		);
	});

	it('labelled overlays with the legend on', () => {
		const { bands, lines } = golden('labelled-legend');
		expect(bands).toMatchInlineSnapshot(
			`"<g class="overlay-bands-layer"><!----><!----><!----><!----><!----><!----><clipPath id="p500-ov1-band-1-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g class="overlay-band" style="pointer-events: none;" clip-path="url(#p500-ov1-band-1-40-15-410-255)"><!----><rect class="band-rect" x="124.39999999999999" y="15" width="80.40000000000002" height="255" fill="#2980B933"></rect><!----><line class="band-edge" x1="124.39999999999999" y1="15" x2="124.39999999999999" y2="270" stroke="#2980B9" stroke-width="1"></line><line class="band-edge" x1="204.8" y1="15" x2="204.8" y2="270" stroke="#2980B9" stroke-width="1"></line><!----><!----></g><!----><!----><!----><!----><!----><clipPath id="p500-ov2-band-2-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g class="overlay-band" style="pointer-events: none;" clip-path="url(#p500-ov2-band-2-40-15-410-255)"><!----><rect class="band-rect" x="40" y="230.64357286000575" width="410" height="35.35642713999425" fill="#27AE6033"></rect><!----><!----></g><!----></g>"`
		);
		expect(lines).toMatchInlineSnapshot(
			`"<g class="overlay-lines-layer"><!----><!----><!----><!----><!----><!----><clipPath id="p500-ov0-rules-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g clip-path="url(#p500-ov0-rules-40-15-410-255)"><!----><line class="overlay-rule" style="pointer-events: none;" x1="40" x2="450" y1="53.86143716003432" y2="53.86143716003432" stroke="#C0392B" stroke-width="2" stroke-dasharray="2, 2"></line></g><!----><!----><!----><!----><!----><!----><!----><!----><clipPath id="p500-ov3-rules-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g clip-path="url(#p500-ov3-rules-40-15-410-255)"><!----><line class="overlay-rule" style="pointer-events: none;" x1="285.2" x2="285.2" y1="15" y2="270" stroke="#C0392B" stroke-width="1.5" stroke-dasharray="5, 5"></line></g></g>"`
		);
	});

	it('right-axis-only scatter', () => {
		const { bands, lines } = golden('right-axis-only');
		expect(bands).toMatchInlineSnapshot(
			`"<g class="overlay-bands-layer"><!----><!----><!----><!----><!----><!----><clipPath id="p500-ov1-band-1-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g class="overlay-band" style="pointer-events: none;" clip-path="url(#p500-ov1-band-1-40-15-410-255)"><!----><rect class="band-rect" x="40" y="243.54545454545453" width="410" height="22.454545454545467" fill="#2C2C2C30"></rect><!----><!----></g><!----></g>"`
		);
		expect(lines).toMatchInlineSnapshot(
			`"<g class="overlay-lines-layer"><!----><!----><!----><!----><!----><!----><clipPath id="p500-ov0-rules-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g clip-path="url(#p500-ov0-rules-40-15-410-255)"><!----><line class="overlay-rule" style="pointer-events: none;" x1="40" x2="450" y1="19.000000000000014" y2="19.000000000000014" stroke="#2C2C2C" stroke-width="1.5" stroke-dasharray="5, 5"></line></g><!----><!----><!----><!----><!----><!----><!----><clipPath id="p500-ov2-rules-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g clip-path="url(#p500-ov2-rules-40-15-410-255)"><!----><line class="overlay-rule" style="pointer-events: none;" x1="446" x2="446" y1="15" y2="270" stroke="#C0392B" stroke-width="1.5" stroke-dasharray="5, 5"></line></g></g>"`
		);
	});

	it('faceted scatter: every panel carries the overlays', () => {
		const fx = fixture('faceted-scatter');
		loadColumns(fx.columns);
		const { id, name: plotName, width, height, inner, facet } = fx.plot;
		const gen = new Plot(
			{ type: 'scatterplot', name: plotName, width, height, facet, plot: inner },
			id
		);
		core.plots.push(gen);
		expect(modelOf(gen.plot)).toMatchSnapshot('generator model');
		expect(portsOf(gen)).toMatchSnapshot('generator ports');

		const panels = panelsFor(gen);
		expect(panels).toHaveLength(2);
		for (const p of panels) projectPanel(p);
		expect(panels.map((p) => modelOf(p.plot))).toMatchSnapshot('panel models');

		const [p0, p1] = panels.map((p) => layersOf(p));
		expect(p0.bands).toMatchInlineSnapshot(
			`"<g class="overlay-bands-layer"><!----><!----><!----><!----><!----><!----><clipPath id="p500_y2_0-ov1-band-1-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g class="overlay-band" style="pointer-events: none;" clip-path="url(#p500_y2_0-ov1-band-1-40-15-410-255)"><!----><rect class="band-rect" x="40" y="100.98930302523816" width="410" height="82.56727394283807" fill="#2C2C2C30"></rect><!----><!----></g><!----><!----><!----><!----><!----><clipPath id="p500_y2_0-ov2-band-2-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g class="overlay-band" style="pointer-events: none;" clip-path="url(#p500_y2_0-ov2-band-2-40-15-410-255)"><!----><rect class="band-rect" x="44" y="15" width="60.3" height="255" fill="#2C2C2C30"></rect><!----><rect class="band-rect" x="204.8" y="15" width="60.30000000000001" height="255" fill="#2C2C2C30"></rect><!----><rect class="band-rect" x="365.6" y="15" width="60.299999999999955" height="255" fill="#2C2C2C30"></rect><!----><!----></g></g>"`
		);
		expect(p0.lines).toMatchInlineSnapshot(
			`"<g class="overlay-lines-layer"><!----><!----><!----><!----><!----><!----><clipPath id="p500_y2_0-ov0-rules-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g clip-path="url(#p500_y2_0-ov0-rules-40-15-410-255)"><!----><line class="overlay-rule" style="pointer-events: none;" x1="104.3" x2="104.3" y1="15" y2="270" stroke="#2C2C2C" stroke-width="1.5" stroke-dasharray="5, 5"></line><!----><line class="overlay-rule" style="pointer-events: none;" x1="265.1" x2="265.1" y1="15" y2="270" stroke="#2C2C2C" stroke-width="1.5" stroke-dasharray="5, 5"></line></g><!----><!----></g>"`
		);
		expect(p1.bands).toMatchInlineSnapshot(
			`"<g class="overlay-bands-layer"><!----><!----><!----><!----><!----><!----><clipPath id="p500_y3_0-ov1-band-1-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g class="overlay-band" style="pointer-events: none;" clip-path="url(#p500_y3_0-ov1-band-1-40-15-410-255)"><!----><rect class="band-rect" x="40" y="142.50000000000003" width="410" height="61.74999999999997" fill="#2C2C2C30"></rect><!----><!----></g><!----><!----><!----><!----><!----><clipPath id="p500_y3_0-ov2-band-2-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g class="overlay-band" style="pointer-events: none;" clip-path="url(#p500_y3_0-ov2-band-2-40-15-410-255)"><!----><rect class="band-rect" x="44" y="15" width="60.3" height="255" fill="#2C2C2C30"></rect><!----><rect class="band-rect" x="204.8" y="15" width="60.30000000000001" height="255" fill="#2C2C2C30"></rect><!----><rect class="band-rect" x="365.6" y="15" width="60.299999999999955" height="255" fill="#2C2C2C30"></rect><!----><!----></g></g>"`
		);
		expect(p1.lines).toMatchInlineSnapshot(
			`"<g class="overlay-lines-layer"><!----><!----><!----><!----><!----><!----><clipPath id="p500_y3_0-ov0-rules-40-15-410-255"><rect x="40" y="15" width="410" height="255"></rect></clipPath><g clip-path="url(#p500_y3_0-ov0-rules-40-15-410-255)"><!----><line class="overlay-rule" style="pointer-events: none;" x1="104.3" x2="104.3" y1="15" y2="270" stroke="#2C2C2C" stroke-width="1.5" stroke-dasharray="5, 5"></line><!----><line class="overlay-rule" style="pointer-events: none;" x1="265.1" x2="265.1" y1="15" y2="270" stroke="#2C2C2C" stroke-width="1.5" stroke-dasharray="5, 5"></line></g><!----><!----></g>"`
		);
	});
});

describe('MCP catalogue (generated schema)', () => {
	it('the scatterplot entry of session-schema.generated.json', () => {
		const schema = JSON.parse(
			readFileSync(join(process.cwd(), 'mcp/src/emit/session-schema.generated.json'), 'utf8')
		);
		expect(schema.plots.scatterplot).toMatchSnapshot();
	});
});
