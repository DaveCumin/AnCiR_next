// @ts-nocheck
/**
 * A faceted Periodogram with a Line wired from its own `peak_period` port. The metric column
 * holds one value per series (generator data order), so before this fix every panel drew
 * every series' peak. Each panel now reads only its own series' rows of its generator's
 * per-series metric (components/plotbits/overlayFacetRows.js); the unfaceted plot, typed
 * values and columns from anywhere else read every row as before.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { NEW_LINE_PORT } from './ProcessNode.svelte.js';
import { applyOverlayWire } from '$lib/components/workflow/overlayWiring.js';
import { panelsFor, projectPanel } from './facetPanels.svelte.js';
import { facetPanelOverlayRows } from '$lib/components/plotbits/overlayFacetRows.js';
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

/** A periodogram with series peaking at `peaks`, metric columns written, Line self-wired. */
function periodogramWithPeaks(peaks) {
	const plot = new Plot({ type: 'periodogram', name: 'P', plot: { data: [] } });
	const t = mkCol('t', HOURS);
	peaks.forEach((pk, i) => {
		plot.plot.addData({ x: { refId: t }, y: { refId: mkCol(`y${i}`, HOURS) } });
		plot.plot.data[i].periodData = spectrum(pk);
	});
	core.plots.push(plot);
	syncPlotMetricColumns(plot);
	writePlotMetricOutputs(plot);
	applyOverlayWire(plot.plot, NEW_LINE_PORT, plot.metricOut.peak_period);
	return plot;
}

const panelLines = (gen) =>
	panelsFor(gen).map((panel) => {
		projectPanel(panel);
		return panel.plot.overlays.map((o) => o.positions('at'));
	});

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
});

describe('faceted plot: an overlay wired to its own per-series metric', () => {
	it('each panel marks only its own series peak', () => {
		const plot = periodogramWithPeaks([22, 27]);
		plot.facet = true;
		expect(panelLines(plot)).toEqual([[[22]], [[27]]]);
	});

	it('the unfaceted plot still marks every series peak', () => {
		const plot = periodogramWithPeaks([22, 27]);
		expect(plot.plot.overlays[0].positions('at')).toEqual([22, 27]);
	});

	it('panels follow the metric when a peak moves', () => {
		const plot = periodogramWithPeaks([22, 27]);
		plot.facet = true;
		panelLines(plot);
		plot.plot.data[1].periodData = spectrum(25.5);
		writePlotMetricOutputs(plot);
		expect(panelsFor(plot).map((p) => p.plot.overlays[0].positions('at'))).toEqual([[22], [25.5]]);
	});

	it('a column from elsewhere and a typed value still give every panel every value', () => {
		const plot = periodogramWithPeaks([22, 27]);
		const other = mkCol('marks', [12, 24]);
		applyOverlayWire(plot.plot, NEW_LINE_PORT, other);
		plot.plot.addOverlay('line', 'vertical');
		plot.plot.overlays.at(-1).setTyped('at', [6]);
		plot.facet = true;
		expect(panelLines(plot)).toEqual([
			[[22], [12, 24], [6]],
			[[27], [12, 24], [6]]
		]);
	});

	it("another plot's metric reads every row (only the generator's own metric is narrowed)", () => {
		const a = periodogramWithPeaks([22, 27]);
		const b = periodogramWithPeaks([18, 20]);
		b.facet = true;
		const [p0] = panelsFor(b);
		projectPanel(p0);
		expect(facetPanelOverlayRows(p0.plot, a.metricOut.peak_period)).toBeNull();
		expect(facetPanelOverlayRows(p0.plot, b.metricOut.peak_period)).toEqual([0]);
		expect(facetPanelOverlayRows(b.plot, b.metricOut.peak_period)).toBeNull();
	});
});
