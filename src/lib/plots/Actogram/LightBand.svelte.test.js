/**
 * The actogram's light-band bar (LightBand.svelte).
 *
 * REPORTED (v82.53 export work; reproduced 2026-10-21 in headless Chromium on
 * demo-workflow-masking): the bar's Height control edited a value that was never saved
 * (a reload always gave 10 px), and the bar was laid out from the SAVED left padding and the
 * figure's width, so with row labels on it started over the labels, and with an outside
 * legend it ran past the rows (240 px of bar over 183 px of row per period).
 *
 * Pinned here, on the real shipped demo:
 *   1. the height is saved and restored (a session without one, or with a bad one, gets 10);
 *   2. the bar spans exactly the rows' x range, one copy of the bands per plotted period,
 *      in every layout (plain, double-plotted, row labels, an outside legend, a node view).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { core, appConsts, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import Actogram from './Actogram.svelte';
import { LightBandClass, LIGHT_BAND_DEFAULT_HEIGHT } from './LightBand.svelte';

const SESSION = join(process.cwd(), 'static', 'sessions', 'demos', 'demo-workflow-masking.json');

const BANDS = [
	{ col: '#000000', pc: 25 },
	{ col: '#ffffff', pc: 50 },
	{ col: '#000000', pc: 25 }
];

function actogramFromDemo(edit = () => {}) {
	const session = JSON.parse(readFileSync(SESSION, 'utf8'));
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.groups = [];
	core.storedValues = {};
	core.seriesAppearance = {};
	core.rawData = new Map(Object.entries(session.rawData ?? {}).map(([k, v]) => [+k, v]));
	for (const cd of session.data ?? []) pushObj(Column.fromJSON(cd));
	const plotJson = session.plots.find((p) => p.name === 'Actogram: truly entrained');
	plotJson.plot.lightBands = { bands: structuredClone(BANDS) };
	edit(plotJson);
	const plot = Plot.fromJSON(plotJson);
	core.plots.push(plot);
	plot.parentBox = { id: plot.id, width: 600, height: 500 };
	return plot;
}

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
});
afterEach(() => cleanup());

describe('light-band height is saved', () => {
	it('survives a save and load', () => {
		const plot = actogramFromDemo();
		plot.plot.lightBands.height = 18;
		const json = JSON.parse(JSON.stringify(plot));
		expect(json.plot.lightBands.height).toBe(18);
		const back = Plot.fromJSON(json);
		expect(back.plot.lightBands.height).toBe(18);
		// The room it makes above the plot follows it (twice the height on top).
		expect(back.plot.topPadding).toBe(back.plot.paddingIN.top + 36);
	});

	it('a session saved before the height was, or with a bad one, gets the default', () => {
		expect(LIGHT_BAND_DEFAULT_HEIGHT).toBe(10);
		for (const height of [undefined, null, 'tall', 0, -4, Infinity]) {
			const lb = LightBandClass.fromJSON({ bands: structuredClone(BANDS), height }, null);
			expect(lb.height, String(height)).toBe(10);
		}
		expect(LightBandClass.fromJSON({ bands: [], height: 7 }, null).height).toBe(7);
	});
});

/** The bar as drawn: each rect's [left, right] in svg px, and the rows' [left, right]. */
function drawnBar(plot) {
	const { container } = render(Actogram, { props: { theData: plot, which: 'plot' } });
	flushSync();
	const g = container.querySelector('g.actogram');
	const m = /translate\(\s*([-\d.e]+)px,\s*([-\d.e]+)px\s*\)/.exec(g.getAttribute('style'));
	const tx = Number(m[1]);
	const rects = [...g.querySelectorAll('rect')].map((r) => {
		const x = tx + Number(r.getAttribute('x'));
		return [x, x + Number(r.getAttribute('width')), r.getAttribute('fill')];
	});
	const inner = plot.plot;
	return { rects, rows: [inner.padding.left, inner.padding.left + inner.plotwidth] };
}

const LAYOUTS = {
	'double-plotted (the default)': () => {},
	'single-plotted': (j) => (j.plot.doublePlot = 1),
	'row labels on': (j) => (j.plot.rowLabels = 'period'),
	'date row labels, single-plotted': (j) => {
		j.plot.rowLabels = 'date';
		j.plot.doublePlot = 1;
	},
	'an outside legend': (j) => {
		j.plot.legend = { ...(j.plot.legend ?? {}), show: true, position: 'outsideright' };
	},
	'row labels and an outside legend': (j) => {
		j.plot.rowLabels = 'period';
		j.plot.legend = { ...(j.plot.legend ?? {}), show: true, position: 'outsideright' };
	}
};

describe('the light bar spans exactly the rows', () => {
	for (const [name, edit] of Object.entries(LAYOUTS)) {
		it(name, () => {
			const plot = actogramFromDemo(edit);
			const { rects, rows } = drawnBar(plot);
			const copies = plot.plot.doublePlot;
			expect(rects).toHaveLength(BANDS.length * copies);
			expect(rects[0][0]).toBeCloseTo(rows[0], 6);
			expect(rects.at(-1)[1]).toBeCloseTo(rows[1], 6);
			// Side by side, each its share of ONE period, the pattern repeated per period.
			const period = (rows[1] - rows[0]) / copies;
			rects.forEach(([l, r, fill], i) => {
				const band = BANDS[i % BANDS.length];
				expect(r - l).toBeCloseTo((period * band.pc) / 100, 6);
				expect(fill).toBe(band.col);
				if (i > 0) expect(l).toBeCloseTo(rects[i - 1][1], 6);
			});
		});
	}

	it('in a node view (a renderBox smaller than the figure)', () => {
		const plot = actogramFromDemo((j) => (j.plot.rowLabels = 'period'));
		plot.plot.renderBox = { w: 300, h: 260 };
		const { rects, rows } = drawnBar(plot);
		expect(rects[0][0]).toBeCloseTo(rows[0], 6);
		expect(rects.at(-1)[1]).toBeCloseTo(rows[1], 6);
	});
});
