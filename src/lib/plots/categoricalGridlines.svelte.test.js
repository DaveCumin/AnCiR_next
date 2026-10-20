// @ts-nocheck
/**
 * Vertical (x) gridlines on the categorical-x plots: the Boxplot and Mean +/- SEM.
 *
 * Both draw their x axis from a stand-in axis object (getXAxisForManualCategories) that puts
 * one tick at each category's index. That object hardcoded `gridlines: false`, so turning the
 * x gridlines on (a saved plot, a style applied to all plots, the MCP) drew nothing, and the
 * X-axis panel offered no Grid switch at all. Enabled x gridlines now draw one line per
 * category, at the category's centre (the tick under its label), spanning the plot area; off
 * draws none. The panel has the same Grid switch as every other axis.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { loadPlots } from '$test/plotRegistry.js';
import { clearProcessNodeGraphCache } from '$lib/core/ProcessNode.svelte.js';
import Boxplot from './Boxplot/Boxplot.svelte';
import MeanSEM from './MeanSEM/MeanSEM.svelte';

function mkCol(values, type = 'number', name = 'c') {
	const c = new Column({ type, data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

function sessionPlot(type, data) {
	core.plots.push(new Plot({ type, name: type, width: 520, height: 340, plot: { data } }));
	return core.plots[core.plots.length - 1];
}

/** The axis group's translate(Xpx, Ypx), as numbers. */
function groupOffset(g) {
	const m = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(g.style.transform);
	return [Number(m[1]), Number(m[2])];
}

/** Every bottom-axis gridline as { x, y0, y1 } in the plot svg's coordinates. */
function bottomGridlines(container) {
	const g = container.querySelector('g.axis-bottom');
	expect(g, 'an axis-bottom group').not.toBeNull();
	const [gx, gy] = groupOffset(g);
	return [...g.querySelectorAll('line.gridline')].map((l) => {
		const tick = l.closest('.tick');
		const m = /translate\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/.exec(tick.getAttribute('transform'));
		const a = Number(l.getAttribute('y1')) + gy;
		const b = Number(l.getAttribute('y2')) + gy;
		return { x: Number(m[1]) + gx, y0: Math.min(a, b), y1: Math.max(a, b) };
	});
}

const HOSTS = [
	['boxplot', Boxplot],
	['meansem', MeanSEM]
];

beforeAll(async () => {
	appConsts.plotMap = await loadPlots();
});
beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	core.tableProcesses = [];
	core.chainRefs = [];
	clearProcessNodeGraphCache();
});
afterEach(() => cleanup());

function categoricalPlot(type) {
	const x = mkCol(['a', 'a', 'b', 'b', 'c', 'c', 'd', 'd'], 'category', 'group');
	const y = mkCol([1, 2, 3, 4, 2, 5, 6, 3], 'number', 'value');
	return sessionPlot(type, [{ x: { refId: x }, y: { refId: y } }]);
}

describe.each(HOSTS)('%s: x gridlines on a categorical axis', (type, Component) => {
	it('enabled: one per category, at its centre, spanning the plot area', () => {
		const plot = categoricalPlot(type);
		plot.plot.xAxis.gridlines = true;
		flushSync();
		const inner = plot.plot;
		const { container } = render(Component, { props: { theData: plot, which: 'plot' } });
		const lines = bottomGridlines(container);
		const n = inner.uniqueXValues.length;
		expect(n).toBe(4);
		expect(lines.length).toBe(n);
		const scale = inner.overlayXScale;
		const want = inner.uniqueXValues.map((_, i) => inner.padding.left + scale(i));
		// d3's axis shifts every tick by its crisp-edge offset (0.5 px at a device pixel ratio
		// of 1), so a line is at its category's centre to within that half pixel.
		lines.forEach((l, i) => expect(Math.abs(l.x - want[i])).toBeLessThanOrEqual(0.5));
		for (const l of lines) {
			expect(l.y0).toBeCloseTo(inner.padding.top, 6);
			expect(l.y1).toBeCloseTo(inner.padding.top + inner.plotheight, 6);
		}
	});

	it('disabled: none', () => {
		const plot = categoricalPlot(type);
		plot.plot.xAxis.gridlines = false;
		flushSync();
		const { container } = render(Component, { props: { theData: plot, which: 'plot' } });
		expect(bottomGridlines(container)).toEqual([]);
	});

	it('the X-axis panel has a Grid switch that sets xAxis.gridlines', async () => {
		const plot = categoricalPlot(type);
		plot.plot.xAxis.gridlines = false;
		appState.currentControlTab = 'properties';
		const { container } = render(Component, {
			props: { theData: plot.plot, which: 'controls' }
		});
		const box = container.querySelector('[data-testid="x-axis-gridlines"]');
		expect(box, 'an x-axis Grid checkbox').not.toBeNull();
		expect(box.checked).toBe(false);
		await fireEvent.click(box);
		expect(plot.plot.xAxis.gridlines).toBe(true);
	});
});
