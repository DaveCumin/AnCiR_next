// @ts-nocheck
// Gridlines span exactly the plot area, for every axis position.
//
// A bottom axis <g> is translated to the plot's bottom edge (height + padding.top), so its
// gridlines run from 0 (the axis) to -height (the top of the plot area). They started at
// -padding.top instead, so every vertical gridline stopped padding.top px short of the x axis
// (a 10 px gap on a default scatterplot, seen in the browser on the Scatterplot, Periodogram,
// Correlogram, Histogram and FFT). The Python export draws them axes-fraction 0 to 1, i.e. the
// full plot height, so the app and the export disagreed.
//
// Each case reads the line coordinates in the coordinate space of the plot <svg>: the axis
// group's translate plus the line's own y1/y2 (or x1/x2), and compares them with the plot area
// [padding.top, padding.top + height] or [padding.left, padding.left + width].
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { scaleLinear } from 'd3-scale';
import { core } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import Axis, { AxisClass } from '$lib/components/plotbits/Axis.svelte';
import Scatterplot, { Scatterplotclass } from '$lib/plots/Scatterplot/Scatterplot.svelte';
import Histogram, { Histogramclass } from '$lib/plots/Histogram/Histogram.svelte';

afterEach(() => cleanup());

/** The axis group's translate(Xpx, Ypx), as numbers. */
function groupOffset(g) {
	const m = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(g.style.transform);
	expect(m, `axis group has a px translate: "${g.style.transform}"`).not.toBeNull();
	return [Number(m[1]), Number(m[2])];
}

/**
 * The [min, max] extent of every gridline of the axis group at `position`, along the axis
 * perpendicular to it (y for bottom/top, x for left/right), in the plot's coordinates.
 */
function gridExtents(container, position) {
	const g = container.querySelector(`g.axis-${position}`);
	expect(g, `an axis-${position} group`).not.toBeNull();
	const [gx, gy] = groupOffset(g);
	const lines = [...g.querySelectorAll('line.gridline')];
	expect(lines.length, `${position} axis draws gridlines`).toBeGreaterThan(0);
	const vertical = position === 'bottom' || position === 'top';
	return lines.map((l) => {
		const a = Number(l.getAttribute(vertical ? 'y1' : 'x1'));
		const b = Number(l.getAttribute(vertical ? 'y2' : 'x2'));
		const off = vertical ? gy : gx;
		return [Math.min(a, b) + off, Math.max(a, b) + off];
	});
}

function expectSpans(container, position, { padding, width, height }) {
	const vertical = position === 'bottom' || position === 'top';
	const want = vertical
		? [padding.top, padding.top + height]
		: [padding.left, padding.left + width];
	for (const [lo, hi] of gridExtents(container, position)) {
		expect(lo).toBeCloseTo(want[0], 6);
		expect(hi).toBeCloseTo(want[1], 6);
	}
}

describe('Axis gridlines span the plot area at every position', () => {
	// Asymmetric padding, so an extent that borrows the wrong side's padding cannot pass.
	const padding = { top: 17, right: 23, bottom: 41, left: 53 };
	const width = 240;
	const height = 130;

	it.each(['bottom', 'top', 'left', 'right'])('%s axis', (position) => {
		const vertical = position === 'bottom' || position === 'top';
		const scale = vertical
			? scaleLinear().domain([0, 10]).range([0, width])
			: scaleLinear().domain([0, 10]).range([height, 0]);
		const { container } = render(Axis, {
			props: {
				which: 'plot',
				axisData: new AxisClass({ gridlines: true, nticks: 5 }),
				position,
				scale,
				width,
				height,
				plotPadding: padding
			}
		});
		expectSpans(container, position, { padding, width, height });
	});
});

describe('plot gridlines span the plot area', () => {
	beforeEach(() => {
		core.data = [];
		core.rawData = new Map();
	});

	function mkCol(values) {
		const c = new Column({ type: 'number', data: -1 });
		core.rawData.set(c.id, values);
		c.data = c.id;
		core.data.push(c);
		return c.id;
	}

	it('Scatterplot: bottom, left and right axes', () => {
		const wrapper = { id: 1, type: 'scatterplot', name: 'p', width: 420, height: 300, plot: null };
		const s = new Scatterplotclass(wrapper, null);
		s.padding = { top: 20, right: 45, bottom: 30, left: 50 };
		s.addData({
			x: { refId: mkCol([0, 2, 4, 6, 8, 10]) },
			y: { refId: mkCol([1, 3, 2, 5, 4, 6]) }
		});
		s.addData({
			x: { refId: mkCol([0, 2, 4, 6, 8, 10]) },
			y: { refId: mkCol([9, 7, 8, 5, 6, 4]) }
		});
		s.data[1].yAxis = 'right';
		s.xAxis.gridlines = true;
		s.yAxisLeft.gridlines = true;
		s.yAxisRight.gridlines = true;
		wrapper.plot = s;
		const { container } = render(Scatterplot, { props: { theData: wrapper, which: 'plot' } });
		const area = { padding: s.padding, width: s.plotwidth, height: s.plotheight };
		expect(area.width).toBeGreaterThan(0);
		expect(area.height).toBeGreaterThan(0);
		for (const position of ['bottom', 'left', 'right']) expectSpans(container, position, area);
	});

	it('Histogram: bottom and left axes', () => {
		const wrapper = { id: 2, type: 'histogram', name: 'h', width: 400, height: 300, plot: null };
		const h = new Histogramclass(wrapper, null);
		h.padding = { top: 25, right: 30, bottom: 35, left: 55 };
		h.addData({ column: { refId: mkCol([1, 2, 2, 3, 3, 3, 4, 4, 5, 6, 7, 7, 8]) } });
		h.xAxis.gridlines = true;
		h.yAxis.gridlines = true;
		wrapper.plot = h;
		const { container } = render(Histogram, { props: { theData: wrapper, which: 'plot' } });
		const area = { padding: h.padding, width: h.plotwidth, height: h.plotheight };
		for (const position of ['bottom', 'left']) expectSpans(container, position, area);
	});
});
