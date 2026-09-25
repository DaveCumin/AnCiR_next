// @ts-nocheck
// The periodogram's shared series legend: what it contributes, what it must NOT
// contribute, and what actually reaches the SVG.
//
// Two things here are specific to this plot. First, the significance threshold is
// drawn only for the Chi-squared method, so it earns its OWN legend entry and that
// entry has to vanish the moment the method changes. Second, the legend defaults
// OFF: every saved session already contains periodograms, and a legend switching
// itself on at load would silently change a finished figure.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import Periodogram, { Periodogramclass } from './Periodogram.svelte';

function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

/** A two-series periodogram on a real Plot wrapper (the shape the app mounts). */
function makePeriodogram() {
	const t = mkCol('t', [0, 1, 2, 3, 4, 5, 6, 7]);
	const plot = new Plot({ type: 'periodogram', plot: { data: [] } });
	plot.plot.addData({ x: { refId: t }, y: { refId: mkCol('a', [1, 2, 3, 4, 3, 2, 1, 2]) } });
	plot.plot.addData({ x: { refId: t }, y: { refId: mkCol('b', [4, 3, 2, 1, 2, 3, 4, 3]) } });
	core.plots.push(plot);
	return plot;
}

const labels = (plot) => plot.plot.getLegendItems.map((i) => i.label);

beforeEach(async () => {
	appConsts.plotMap = await loadPlots();
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	core.seriesAppearance = {};
	appState.gridSize = 15;
});
afterEach(() => cleanup());

describe('Periodogram legend items', () => {
	it('contributes one entry per drawn series, labelled by the wired y column and coloured like its line', () => {
		const plot = makePeriodogram();
		expect(labels(plot)).toEqual(['a', 'b']);

		const items = plot.plot.getLegendItems;
		expect(items[0].elements.map((e) => e.type)).toEqual(['line', 'points']);
		expect(items[0].elements[0].color).toBe(plot.plot.data[0].line.colour);
		expect(items[0].elements[1].color).toBe(plot.plot.data[0].points.colour);
		// Two different columns, so two different colours: the swatches are not all one hue.
		expect(items[1].elements[0].color).not.toBe(items[0].elements[0].color);
	});

	it('a series drawing neither a line nor points contributes NO entry', () => {
		const plot = makePeriodogram();
		plot.plot.data[0].line.draw = false;
		plot.plot.data[0].points.draw = false;
		expect(labels(plot)).toEqual(['b']);
		expect(plot.plot.data[0].getLegendItem()).toBeNull();
	});

	it('hiding just the line leaves a points-only entry', () => {
		const plot = makePeriodogram();
		plot.plot.data[0].line.draw = false;
		expect(plot.plot.data[0].getLegendItem().elements.map((e) => e.type)).toEqual(['points']);
	});
});

describe('Periodogram threshold legend entry', () => {
	it('appears only for the Chi-squared method, and carries the threshold line colour', () => {
		const plot = makePeriodogram();
		const datum = plot.plot.data[0];
		datum.thresholdline.colour = '#123456';

		// Lomb-Scargle (the default) draws no threshold, so it contributes nothing.
		expect(datum.method).toBe('Lomb-Scargle');
		expect(datum.getThresholdLegendItem()).toBeNull();
		expect(labels(plot)).toEqual(['a', 'b']);

		datum.method = 'Chi-squared';
		const entry = datum.getThresholdLegendItem();
		expect(entry).not.toBeNull();
		expect(entry.label).toBe('a threshold');
		expect(entry.elements).toHaveLength(1);
		expect(entry.elements[0].type).toBe('line');
		expect(entry.elements[0].color).toBe('#123456');
		expect(entry.elements[0].strokeWidth).toBe(datum.thresholdline.strokeWidth);
		expect(entry.elements[0].stroke).toBe(datum.thresholdline.stroke);
		// The plot orders series entry then its threshold entry.
		expect(labels(plot)).toEqual(['a', 'a threshold', 'b']);

		datum.method = 'Lomb-Scargle';
		expect(labels(plot)).toEqual(['a', 'b']);
	});

	it('never appears when the threshold line itself is hidden', () => {
		const plot = makePeriodogram();
		const datum = plot.plot.data[0];
		datum.method = 'Chi-squared';
		datum.thresholdline.draw = false;
		expect(datum.getThresholdLegendItem()).toBeNull();
		expect(labels(plot)).toEqual(['a', 'b']);
	});

	it('a Chi-squared series whose own line and points are hidden still contributes its threshold', () => {
		const plot = makePeriodogram();
		const datum = plot.plot.data[0];
		datum.method = 'Chi-squared';
		datum.line.draw = false;
		datum.points.draw = false;
		expect(labels(plot)).toEqual(['a threshold', 'b']);
	});
});

describe('Periodogram legend rendering', () => {
	it('draws the series labels in the SVG when show is true, and nothing when it is false', async () => {
		const plot = makePeriodogram();
		plot.plot.legend.show = true;

		const { container } = render(Periodogram, { props: { theData: plot, which: 'plot' } });
		const texts = () =>
			[...container.querySelectorAll('svg text')].map((t) => t.textContent.trim());
		expect(texts()).toEqual(expect.arrayContaining(['a', 'b']));

		plot.plot.legend.show = false;
		await Promise.resolve();
		cleanup();
		const second = render(Periodogram, { props: { theData: plot, which: 'plot' } });
		const hidden = [...second.container.querySelectorAll('svg text')].map((t) =>
			t.textContent.trim()
		);
		expect(hidden).not.toContain('a');
		expect(hidden).not.toContain('b');
	});
});

describe('Periodogram legend persistence', () => {
	it('round-trips show: true through toJSON / fromJSON', () => {
		const plot = makePeriodogram();
		plot.plot.legend.show = true;
		plot.plot.legend.position = 'bottomleft';
		const json = JSON.parse(JSON.stringify(plot.plot.toJSON()));
		const restored = Periodogramclass.fromJSON(plot, json);
		expect(restored.legend.show).toBe(true);
		expect(restored.legend.position).toBe('bottomleft');
	});

	it('an OLD session with no legend key loads with the legend OFF', () => {
		const plot = makePeriodogram();
		expect(Periodogramclass.fromJSON(plot, {}).legend.show).toBe(false);
		expect(Periodogramclass.fromJSON(plot, null).legend.show).toBe(false);
		// And a brand-new plot is off too.
		expect(plot.plot.legend.show).toBe(false);
	});
});
