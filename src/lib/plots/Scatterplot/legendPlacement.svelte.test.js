// @ts-nocheck
// Automatic legend placement on a real scatterplot.
//
// The paper's cosinor figure had data in every corner, and the fixed top-right legend
// covered a week of points. 'auto' keeps the corner when it is clear, and otherwise, when no
// inside position is clear, moves the legend outside and narrows the plot area to make room.
import { describe, it, expect, beforeEach } from 'vitest';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { LEGEND_MARGIN } from '$lib/components/plotbits/Legend.svelte';

function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

function scatter(xs, ys, legend) {
	const plot = new Plot({
		type: 'scatterplot',
		width: 600,
		height: 300,
		plot: { data: [], ...(legend ? { legend } : {}) }
	});
	plot.plot.addData({ x: { refId: mkCol('t', xs) }, y: { refId: mkCol('y', ys) } });
	plot.plot.padding = { top: 15, right: 30, bottom: 30, left: 30 };
	core.plots.push(plot);
	return plot.plot;
}

/** Points on a grid dense enough that no legend-sized gap is left anywhere. */
function fullGrid() {
	const xs = [];
	const ys = [];
	for (let i = 0; i <= 80; i++) {
		for (let j = 0; j <= 40; j++) {
			xs.push(i);
			ys.push(j);
		}
	}
	return [xs, ys];
}

beforeEach(async () => {
	appConsts.plotMap = await loadPlots();
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	core.seriesAppearance = {};
});

describe('scatterplot legend placement', () => {
	it('a new plot uses auto placement', () => {
		const p = scatter([0, 1], [0, 1]);
		expect(p.legend.position).toBe('auto');
	});

	it('keeps the top-right corner when the data leave it clear', () => {
		// Two points, bottom left and top left: the top right is clear.
		const p = scatter([0, 0], [0, 10]);
		const a = p.legendAutoPlacement;
		expect(a.outside).toBe(false);
		expect(a.name).toBe('topright');
		expect(p.plotwidth).toBe(p.basePlotWidth);
	});

	it('moves outside and narrows the plot when data fill every inside spot', () => {
		// Points everywhere, as in the paper figure.
		const [xs, ys] = fullGrid();
		const p = scatter(xs, ys);
		expect(p.legendAutoPlacement.outside).toBe(true);
		expect(p.legendOutside).toBe(true);
		expect(p.plotwidth).toBeCloseTo(p.basePlotWidth - p.legendBox.width - LEGEND_MARGIN, 6);
		// The legend sits just right of the plot area and ends where the area used to end.
		expect(p.legendOutsideX).toBeCloseTo(p.plotwidth + LEGEND_MARGIN, 6);
		expect(p.legendOutsideX + p.legendBox.width).toBeCloseTo(p.basePlotWidth, 6);
	});

	it('a saved legend keeps its saved corner and reserves nothing', () => {
		const [xs, ys] = fullGrid();
		const p = scatter(xs, ys, { position: 'topright', show: true });
		expect(p.legend.position).toBe('topright');
		expect(p.legendAutoPlacement).toBeNull();
		expect(p.plotwidth).toBe(p.basePlotWidth);
	});

	it('an explicit outside-right legend reserves room whatever the data', () => {
		const p = scatter([0, 10], [10, 0], { position: 'outsideright', show: true });
		expect(p.legendOutside).toBe(true);
		expect(p.plotwidth).toBeLessThan(p.basePlotWidth);
	});

	it('a hidden legend reserves nothing', () => {
		const p = scatter([0, 10], [10, 0], { position: 'outsideright', show: false });
		expect(p.legendOutside).toBe(false);
		expect(p.plotwidth).toBe(p.basePlotWidth);
	});
});
