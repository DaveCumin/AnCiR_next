// @ts-nocheck
// The box fill opacity: saved on every series (0.3 in every session) but never drawn, so a box
// filled in its own outline colour (category colours, or a fill that follows the stroke) was a
// solid block the colour of its outline. Drives the REAL Boxplot component.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { loadPlots } from '$test/plotRegistry.js';
import { pinAllSeriesAppearance } from '$lib/plots/appearanceIdentity.js';
import { getSharedDataSchema } from '$lib/plots/sharedControls.js';
import { plotProps } from '$lib/utils/aiEdit.js';
import { boxFillOpacity, BOX_FILL_OPACITY_DEFAULT } from '$lib/components/plotbits/Box.svelte';

beforeAll(async () => {
	appConsts.plotMap = await loadPlots();
});
beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	core.seriesAppearance = {};
	core.categoryColours = {};
});
afterEach(() => cleanup());

function mkCol(type, values) {
	const c = new Column({ type, data: -1 });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

const CATS = ['a', 'a', 'a', 'a', 'b', 'b', 'b', 'b', 'c', 'c', 'c', 'c'];
const VALS = [1, 2, 3, 30, 4, 5, 6, 7, 8, 9, 10, 11];

/** A boxplot with these series ({ x?, y, boxPlot? }), mounted; returns what it draws. */
async function draw(series, style = {}) {
	const plot = new Plot({
		type: 'boxplot',
		name: 'b',
		width: 500,
		height: 300,
		plot: {
			data: series.map((s) => ({ x: { refId: s.x ?? -1 }, y: { refId: s.y }, boxPlot: s.boxPlot }))
		}
	});
	plot.style = { ...plot.style, ...style };
	core.plots.push(plot);
	const live = core.plots[core.plots.length - 1];
	pinAllSeriesAppearance(core.plots);
	const Comp = appConsts.plotMap.get('boxplot').plot;
	const { container } = render(Comp, { props: { theData: live, which: 'plot' } });
	for (let i = 0; i < 4; i++) {
		flushSync();
		await tick();
	}
	const svg = container.querySelector('svg');
	const groups = [...svg.querySelectorAll('g[clip-path^="url(#boxplot-"]')];
	return {
		live,
		boxes: groups.flatMap((g) => [...g.querySelectorAll('rect')]),
		lines: groups.flatMap((g) => [...g.querySelectorAll('line')]),
		rings: groups.flatMap((g) => [...g.querySelectorAll('circle[fill="none"]')]),
		swatches: [...svg.querySelectorAll('text[dy="0.35em"]')]
			.map((t) => t.parentElement.querySelector('rect'))
			.filter(Boolean)
	};
}

describe('the box fill is drawn at the saved opacity', () => {
	it('a session saved with the default draws its boxes at 0.3', async () => {
		const x = mkCol('category', CATS);
		const y = mkCol('number', VALS);
		const { boxes } = await draw([{ x, y }]);
		expect(boxes.length).toBe(3);
		for (const r of boxes) expect(r.getAttribute('fill-opacity')).toBe('0.3');
	});

	it('category-coloured boxes keep their colour and are translucent', async () => {
		const x = mkCol('category', CATS);
		const y = mkCol('number', VALS);
		const { live, boxes } = await draw([{ x, y, boxPlot: { fillOpacity: 0.45 } }]);
		expect(live.plot.categoryColoured).toBe(true);
		const fills = boxes.map((r) => r.getAttribute('fill'));
		expect(new Set(fills).size).toBe(3);
		for (const r of boxes) {
			// The fill is the outline's colour, so only the opacity tells them apart.
			expect(r.getAttribute('fill')).toBe(r.getAttribute('stroke'));
			expect(r.getAttribute('fill-opacity')).toBe('0.45');
		}
	});

	it('only the fill is translucent: median, whiskers and outlier rings stay opaque', async () => {
		const x = mkCol('category', CATS);
		const y = mkCol('number', VALS);
		const { lines, rings } = await draw([{ x, y }]);
		expect(rings.length).toBeGreaterThan(0); // the 30 in group a
		for (const el of [...lines, ...rings]) {
			expect(el.getAttribute('fill-opacity')).toBe(null);
			expect(el.getAttribute('stroke-opacity')).toBe(null);
		}
	});

	it('monochrome greys are translucent too', async () => {
		const x = mkCol('category', CATS);
		const y = mkCol('number', VALS);
		const { boxes } = await draw([{ x, y }], { monochrome: true });
		for (const r of boxes) expect(r.getAttribute('fill-opacity')).toBe('0.3');
	});

	it('each series uses its own opacity and the legend swatch matches it', async () => {
		const x = mkCol('category', CATS);
		const y1 = mkCol('number', VALS);
		const y2 = mkCol(
			'number',
			VALS.map((v) => v + 3)
		);
		const { boxes, swatches } = await draw([
			{ x, y: y1, boxPlot: { fillOpacity: 0.2 } },
			{ x, y: y2, boxPlot: { fillOpacity: 1 } }
		]);
		const ops = boxes.map((r) => r.getAttribute('fill-opacity'));
		expect(ops.filter((o) => o === '0.2').length).toBe(3);
		expect(ops.filter((o) => o === '1').length).toBe(3);
		expect(swatches.map((r) => r.getAttribute('fill-opacity'))).toEqual(['0.2', '1']);
	});
});

describe('boxFillOpacity', () => {
	it('clamps to [0, 1] and draws the default for anything that is not a number', () => {
		expect(boxFillOpacity(0.5)).toBe(0.5);
		expect(boxFillOpacity(0)).toBe(0);
		expect(boxFillOpacity(2)).toBe(1);
		expect(boxFillOpacity(-1)).toBe(0);
		for (const bad of [undefined, null, '0.5', NaN, Infinity])
			expect(boxFillOpacity(bad)).toBe(BOX_FILL_OPACITY_DEFAULT);
	});
});

describe('the multi-select panel and the AI editor can set it', () => {
	it('fillOpacity is a series field of a boxplot', () => {
		const y = mkCol('number', VALS);
		const plot = new Plot({ type: 'boxplot', name: 'b', plot: { data: [{ y: { refId: y } }] } });
		const field = getSharedDataSchema(plot).find((f) => f.path === 'boxPlot.fillOpacity');
		expect(field).toMatchObject({ label: 'Box fill opacity', input: 'number', step: 0.05, min: 0 });
		const prop = plotProps(plot).find((p) => p.path === 'plot.data[0].boxPlot.fillOpacity');
		expect(prop).toMatchObject({ input: 'number', value: 0.3 });
	});
});
