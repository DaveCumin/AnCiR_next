/**
 * The Actogram's shared series legend.
 *
 * Driven over the REAL shipped free-running demo session (the same harness the
 * PhaseMarker drag tests use), so the series, the wired columns and the phase
 * marker blocks are the ones a user actually sees rather than synthetic stubs.
 *
 * What is pinned here:
 *   1. one entry per DRAWN series, labelled and coloured as the bars are;
 *   2. one entry per phase-marker block that draws something, with the swatch
 *      reflecting which of line / markers that block actually draws;
 *   3. light bands NEVER appear (they have no name, so nothing honest to label);
 *   4. a heatmap series is not claimed to be drawn in its series colour;
 *   5. a user-typed series `label` survives a save/load round trip, which is the
 *      bug that made the legend revert to the column name;
 *   6. the legend defaults OFF, including for a session saved before it existed.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup } from '@testing-library/svelte';
import { core, appConsts, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { colormapRGB, DEFAULT_COLORMAP } from './colormaps.js';
import Actogram, { Actogramclass } from './Actogram.svelte';

const SESSION = join(
	process.cwd(),
	'static',
	'sessions',
	'demos',
	'demo-workflow-free-running.json'
);

/** An onset block: draws both its markers and its fitted line. */
const ONSET = {
	name: 'onsets',
	type: 'onset',
	centileThreshold: 50,
	templateHrsBefore: 3,
	templateHrsAfter: 3,
	colour: '#234154',
	showLine: true,
	showMarkers: true,
	lineWidth: 2,
	markerSize: 5,
	manualMarkers: []
};

function actogramFromDemo({ markers = [] } = {}) {
	const session = JSON.parse(readFileSync(SESSION, 'utf8'));
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.groups = [];
	core.storedValues = {};
	core.rawData = new Map(Object.entries(session.rawData ?? {}).map(([k, v]) => [+k, v]));
	for (const cd of session.data ?? []) pushObj(Column.fromJSON(cd));

	const plotJson = session.plots.find((p) => p.type === 'actogram');
	plotJson.plot.data[0].phaseMarkers = markers;
	const plot = Plot.fromJSON(plotJson);
	core.plots.push(plot);
	plot.parentBox = { id: plot.id, width: 600, height: 500 };
	return plot;
}

const labels = (plot) => plot.plot.getLegendItems.map((i) => i.label);

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
});
beforeEach(() => {
	core.seriesAppearance = {};
});
afterEach(() => cleanup());

describe('Actogram series legend: entries', () => {
	it('contributes one entry per drawn series, labelled and coloured as its bars are', () => {
		const plot = actogramFromDemo();
		const series = plot.plot.data[0];
		expect(plot.plot.data.length).toBeGreaterThan(0);

		const items = plot.plot.getLegendItems;
		expect(items).toHaveLength(plot.plot.data.length);
		expect(items[0].label).toBe(series.displayLabel);
		expect(items[0].label).not.toBe('');

		const [el] = items[0].elements;
		// A solid bar, not a hollow box: the actogram draws filled bars.
		expect(el.type).toBe('boxplot');
		expect(el.color).toBe(series.colour);
		expect(el.fillColor).toBe(series.colour);
		expect(el.fillOpacity).toBe(1);
	});

	it('a hidden series (draw = false) contributes nothing', () => {
		const plot = actogramFromDemo();
		const before = plot.plot.getLegendItems.length;
		plot.plot.data[0].draw = false;
		expect(plot.plot.getLegendItems).toHaveLength(before - 1);
		expect(labels(plot)).not.toContain(plot.plot.data[0].displayLabel);
	});

	it('follows the series label the user typed', () => {
		const plot = actogramFromDemo();
		plot.plot.data[0].label = 'Mouse 3 activity';
		expect(labels(plot)).toContain('Mouse 3 activity');
	});
});

describe('Actogram series legend: phase-marker blocks', () => {
	it('a named block contributes one entry with its name, colour, points and line', () => {
		const plot = actogramFromDemo({ markers: [structuredClone(ONSET)] });
		const marker = plot.plot.data[0].phaseMarkers[0];
		expect(marker.name).toBe('onsets');

		const item = plot.plot.getLegendItems.find((i) => i.label === 'onsets');
		expect(item).toBeTruthy();
		const types = item.elements.map((e) => e.type);
		expect(types).toContain('points');
		expect(types).toContain('line');
		for (const el of item.elements) expect(el.color).toBe(marker.colour);
		// The line swatch must match the width actually drawn.
		expect(item.elements.find((e) => e.type === 'line').strokeWidth).toBe(marker.lineWidth);
	});

	it('a block drawing only its line contributes a line-only entry', () => {
		// A one-click line block: manual with no markers at all, both parameters
		// fixed. `addFitLine` builds exactly this, and it is the case that shipped
		// with a dot in the legend and no dot on the figure, because the entry was
		// keyed off `showMarkers` — a field the renderer never reads.
		const plot = actogramFromDemo();
		const series = plot.plot.data[0];
		series.addFitLine();
		const marker = series.phaseMarkers.at(-1);
		expect(marker.markerPoints, 'the block draws no marker dots').toBe('');
		expect(marker.showMarkers, 'and says it does, which is why it is not consulted').toBe(true);

		const item = plot.plot.getLegendItems.find((i) => i.label === marker.name);
		expect(item.elements.map((e) => e.type)).toEqual(['line']);
	});

	it('a block whose line is switched off keeps the markers it still draws', () => {
		// `showMarkers` is vestigial: the marker <path> is drawn unconditionally, so
		// an onset block with its line off is still a block of dots on the figure.
		const plot = actogramFromDemo({ markers: [structuredClone(ONSET)] });
		const marker = plot.plot.data[0].phaseMarkers[0];
		marker.showLine = false;
		marker.showMarkers = false;
		expect(marker.markerPoints, 'the dots are still drawn').not.toBe('');
		const item = plot.plot.getLegendItems.find((i) => i.label === 'onsets');
		expect(item.elements.map((e) => e.type)).toEqual(['points']);
	});

	it('a block that draws nothing at all contributes nothing', () => {
		const plot = actogramFromDemo();
		const series = plot.plot.data[0];
		series.addFitLine();
		const marker = series.phaseMarkers.at(-1);
		marker.showLine = false;
		expect(marker.markerPoints).toBe('');
		expect(labels(plot)).not.toContain(marker.name);
		expect(plot.plot.getLegendItems).toHaveLength(plot.plot.data.length);
	});

	it('a line whose day range is empty is not legended', () => {
		// The renderer's gate is `showLine && slope && hi >= lo`; only the first two
		// were mirrored, so a block clamped to an impossible day range advertised a
		// line that the figure does not draw.
		const plot = actogramFromDemo();
		const series = plot.plot.data[0];
		series.addFitLine();
		const marker = series.phaseMarkers.at(-1);
		expect(marker.lineDrawn).toBe(true);
		marker.lineMinDay = 5;
		marker.lineMaxDay = 2;
		expect(marker.lineDrawn).toBe(false);
		expect(labels(plot)).not.toContain(marker.name);
	});

	it('falls back to a readable label when the block name is blank', () => {
		const plot = actogramFromDemo({ markers: [structuredClone(ONSET)] });
		const marker = plot.plot.data[0].phaseMarkers[0];
		marker.name = '   ';
		const extra = plot.plot.getLegendItems.filter(
			(i) => !plot.plot.data.some((d) => d.displayLabel === i.label)
		);
		expect(extra).toHaveLength(1);
		expect(extra[0].label.trim()).not.toBe('');
	});

	it('keeps a hidden series’ markers, because the plot still draws them', () => {
		// The marker <g> in Actogram.svelte sits OUTSIDE the `{#if datum.draw}`
		// block, so hiding a series hides its bars only. The legend must say the
		// same thing the figure does.
		const plot = actogramFromDemo({ markers: [structuredClone(ONSET)] });
		plot.plot.data[0].draw = false;
		expect(labels(plot)).toContain('onsets');
	});
});

describe('Actogram series legend: light bands', () => {
	it('never lists a light band', () => {
		const plot = actogramFromDemo();
		const before = plot.plot.getLegendItems.length;
		plot.plot.lightBands.addBand({ pc: 50, colour: '#ffee88' });
		plot.plot.lightBands.addBand({ pc: 50, colour: '#223344' });
		expect(plot.plot.lightBands.bands.length).toBe(2);
		expect(plot.plot.getLegendItems).toHaveLength(before);
		for (const item of plot.plot.getLegendItems) {
			for (const el of item.elements) {
				expect(el.color).not.toBe('#ffee88');
				expect(el.color).not.toBe('#223344');
			}
		}
	});
});

describe('Actogram series legend: heatmap render mode', () => {
	it('does not claim a heatmap series is drawn in its series colour', () => {
		const plot = actogramFromDemo();
		const series = plot.plot.data[0];
		plot.plot.renderMode = 'heatmap';
		const item = plot.plot.getLegendItems.find((i) => i.label === series.displayLabel);
		expect(item).toBeTruthy();
		const [el] = item.elements;
		expect(el.color).not.toBe(series.colour);
		// It is a colour the series IS drawn in: the colormap's mid stop.
		expect(el.color).toBe(colormapRGB(plot.plot.colormap ?? DEFAULT_COLORMAP, 0.5));
	});
});

describe('Actogram series legend: persistence', () => {
	it('round-trips a user-typed series label through toJSON/fromJSON', () => {
		const plot = actogramFromDemo();
		plot.plot.data[0].label = 'Mouse 3 activity';
		const json = JSON.parse(JSON.stringify(plot.plot.toJSON()));
		expect(json.data[0].label).toBe('Mouse 3 activity');

		const reloaded = Actogramclass.fromJSON(plot.parentBox, json);
		expect(reloaded.data[0].label).toBe('Mouse 3 activity');
		expect(reloaded.getLegendItems.map((i) => i.label)).toContain('Mouse 3 activity');
	});

	it('round-trips the legend settings', () => {
		const plot = actogramFromDemo();
		plot.plot.legend.show = true;
		plot.plot.legend.position = 'bottomleft';
		const json = JSON.parse(JSON.stringify(plot.plot.toJSON()));
		const reloaded = Actogramclass.fromJSON(plot.parentBox, json);
		expect(reloaded.legend.show).toBe(true);
		expect(reloaded.legend.position).toBe('bottomleft');
	});

	it('defaults the legend OFF for a new plot and for a session saved before it existed', () => {
		const plot = actogramFromDemo();
		expect(plot.plot.legend.show).toBe(false);
		// An old session's actogram JSON carries no `legend` key at all.
		expect(Actogramclass.fromJSON(plot.parentBox, {}).legend.show).toBe(false);
		expect(Actogramclass.fromJSON(plot.parentBox, null).legend.show).toBe(false);
	});
});

describe('Actogram series legend: rendering', () => {
	function renderPlot(plot) {
		return render(Actogram, { props: { theData: plot, which: 'plot' } });
	}

	it('draws the legend text in the SVG when show is true', async () => {
		const plot = actogramFromDemo({ markers: [structuredClone(ONSET)] });
		plot.plot.legend.show = true;
		const { container } = renderPlot(plot);
		const texts = [...container.querySelectorAll('svg text')].map((t) => t.textContent.trim());
		expect(texts).toContain(plot.plot.data[0].displayLabel);
		expect(texts).toContain('onsets');
	});

	/**
	 * The gradient <rect> of the heatmap colour-scale legend, and its left edge.
	 * Found by its gradient fill so it cannot be confused with the series legend's
	 * own background rect.
	 */
	function scaleBarX(container) {
		const bar = [...container.querySelectorAll('svg rect')].find((r) =>
			/^url\(#actogram-heat-legend-/.test(r.getAttribute('fill') || '')
		);
		return bar ? Number(bar.getAttribute('x')) : null;
	}

	it('the heatmap colour-scale bar steps aside when the series legend takes its corner', () => {
		// Both default to the top-right of the plot area, so switching the series
		// legend on in heatmap mode drew it underneath the scale bar. The scale bar
		// is the one the user cannot move, so it is the one that moves.
		const plot = actogramFromDemo();
		plot.plot.renderMode = 'heatmap';

		const before = scaleBarX(renderPlot(plot).container);
		expect(before, 'the scale bar is drawn in heatmap mode').not.toBeNull();
		// Top-right: past the middle of the plot area.
		expect(before).toBeGreaterThan(plot.plot.padding.left + plot.plot.plotwidth / 2);
		cleanup();

		plot.plot.legend.show = true;
		expect(plot.plot.getLegendItems.length).toBeGreaterThan(0);
		const after = scaleBarX(renderPlot(plot).container);
		expect(after, 'now top-left, clear of the series legend').toBe(plot.plot.padding.left + 10);
	});

	it('the scale bar keeps its corner when the series legend is somewhere else', () => {
		const plot = actogramFromDemo();
		plot.plot.renderMode = 'heatmap';
		plot.plot.legend.show = true;
		plot.plot.legend.position = 'bottomleft';
		const x = scaleBarX(renderPlot(plot).container);
		expect(x).toBe(plot.plot.padding.left + plot.plot.plotwidth - 96 - 10);
	});

	it('draws no legend text when show is false', () => {
		const plot = actogramFromDemo({ markers: [structuredClone(ONSET)] });
		expect(plot.plot.legend.show).toBe(false);
		const { container } = renderPlot(plot);
		const texts = [...container.querySelectorAll('svg text')].map((t) => t.textContent.trim());
		expect(texts).not.toContain(plot.plot.data[0].displayLabel);
		expect(texts).not.toContain('onsets');
	});
});
