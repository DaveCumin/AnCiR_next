// @ts-nocheck
/**
 * Size by on the other hosts (colour-by plan 2026-10-20, sections 3.7 and 3.12; phase 3): the
 * Q-Q plot, Mean +/- SEM and the Circular phase plot, on the REAL plot classes and components.
 * The shared machinery (plotbits/colourBySeries.svelte.js, markerPaths.js) is pinned on the
 * Scatterplot in plots/Scatterplot/sizeBy.svelte.test.js; here each host's own part:
 *
 *   - Q-Q sorts its values: each drawn sample keeps the SIZE of the row it came from.
 *   - Mean +/- SEM: a group mean is sized by the arithmetic mean of the size column over
 *     exactly the rows the mean used.
 *   - Circular phase: every placement (stack, bin, rim) and the timed clock keeps each dot's
 *     own row's size; the size key shares the strip beside the clock with the colour bar,
 *     clear of the hour labels, the legend and the bar.
 *
 * Plus the panel on every host, save and load, the canvas port, and large inputs (timed).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { render, cleanup } from '@testing-library/svelte';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { loadPlots } from '$test/plotRegistry.js';
import {
	getCachedProcessNodeGraph,
	clearProcessNodeGraphCache
} from '$lib/core/ProcessNode.svelte.js';
import { sizeRadius, SIZE_BUCKETS, COLOUR_BUCKETS } from '$lib/components/plotbits/encodings.js';
import { createPolar } from '$lib/components/plotbits/polar.js';
import QQPlot, { QQPlotclass } from './QQPlot/QQPlot.svelte';
import MeanSEM, { MeanSEMclass } from './MeanSEM/MeanSEM.svelte';
import CircularPhase, { CircularPhaseClass } from './CircularPhase/CircularPhase.svelte';

const H = 3600000;
const T0 = Date.UTC(2026, 0, 1);

function mkCol(values, type = 'number', name = 'c') {
	const c = new Column({ type, data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

function sessionPlot(type, data, { width = 600, height = 400 } = {}) {
	core.plots.push(new Plot({ type, name: type, width, height, plot: { data } }));
	return core.plots[core.plots.length - 1];
}

function sizeSeries(plot, colId, i = 0) {
	const d = plot.plot.data[i];
	d.enableSizeBy();
	d.sizeBy.refId = colId;
	flushSync();
	return d;
}

function colourSeries(plot, colId, i = 0) {
	const d = plot.plot.data[i];
	d.enableColourBy();
	d.colourBy.refId = colId;
	flushSync();
	return d;
}

/** Every sized circle drawn: { cx, cy, r, layer, key } (circles: `M cx cy m-r 0 a r ...`). */
function sizedCircles(container) {
	return [...container.querySelectorAll('path[data-size-layer]')].flatMap((p) =>
		[...p.getAttribute('d').matchAll(/M([-\d.e]+) ([-\d.e]+)m-([-\d.e]+) 0/g)].map((m) => ({
			cx: Number(m[1]),
			cy: Number(m[2]),
			r: Number(m[3]),
			layer: Number(p.getAttribute('data-size-layer')),
			key: p.getAttribute('data-colour-bucket')
		}))
	);
}

const draw = (Component, plot) =>
	render(Component, { props: { theData: plot, which: 'plot' } }).container;
/** The plot's panel on one tab (Data: the series settings, Properties: the keys). */
function controls(Component, plot, tab = 'data') {
	appState.currentControlTab = tab;
	return render(Component, { props: { theData: plot.plot, which: 'controls' } }).container;
}

beforeAll(async () => {
	appConsts.plotMap = await loadPlots();
});
beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	core.tableProcesses = [];
	core.chainRefs = [];
	appState.displayTimezone = 'utc';
	clearProcessNodeGraphCache();
});
afterEach(() => cleanup());

// ---------------------------------------------------------------------------------------------
describe('Q-Q: each sample keeps its own row’s size through the sort', () => {
	it('a size column whose order is the reverse of the value order', () => {
		const n = 9;
		const v = mkCol(Array.from({ length: n }, (_, i) => n - i));
		const s = mkCol(Array.from({ length: n }, (_, i) => i));
		const plot = sessionPlot('qqplot', [{ column: { refId: v } }]);
		const d = sizeSeries(plot, s);
		expect(d.sizeMarkValues).toEqual(Array.from({ length: n }, (_, i) => n - 1 - i));
		const circles = sizedCircles(draw(QQPlot, plot));
		expect(circles.length).toBe(n);
		// The sample drawn lowest (smallest value) came from the last row: the largest size.
		const lowest = [...circles].sort((a, b) => b.cy - a.cy)[0];
		expect(lowest.r).toBeCloseTo(10, 9);
		const highest = [...circles].sort((a, b) => a.cy - b.cy)[0];
		expect(highest.r).toBeCloseTo(2, 9);
		// Largest layer drawn first.
		const layers = [...new Set(circles.map((c) => c.layer))];
		expect(layers).toEqual([...layers].sort((a, b) => b - a));
	});

	it('a missing size keeps the series point radius; the CSV has a size column; save and load', () => {
		const v = mkCol([3, 1, 2]);
		const s = mkCol([null, 0, 10]);
		const plot = sessionPlot('qqplot', [{ column: { refId: v } }]);
		plot.plot.data[0].pointRadius = 5;
		const d = sizeSeries(plot, s);
		// Sorted: 1 (row 1, size 0), 2 (row 2, size 10), 3 (row 0, no size).
		expect([...d.sizeRadii.r]).toEqual([2, 10, 5]);
		expect(d.sizeNoValueCount).toBe(1);
		const { headers, rows } = plot.plot.getDownloadData();
		const k = headers.indexOf('size');
		expect(rows.map((r) => r[k])).toEqual([0, 10, '']);
		const json = JSON.parse(JSON.stringify(plot.plot));
		const back = QQPlotclass.fromJSON(plot, json);
		expect(back.data[0].sizeBy.refId).toBe(s);
		expect(JSON.parse(JSON.stringify(back))).toEqual(json);
	});

	it('the canvas: a size port after the data port, with an edge once wired', () => {
		const v = mkCol([1, 2, 3]);
		const s = mkCol([3, 2, 1]);
		const plot = sessionPlot('qqplot', [{ column: { refId: v } }]);
		sizeSeries(plot, s);
		clearProcessNodeGraphCache();
		const graph = getCachedProcessNodeGraph(core, appConsts);
		const node = graph.nodes.find((n) => n.id === `plot_${plot.id}`);
		const names = node.ports.inputs.map((p) => p.name);
		expect(names.indexOf('enc1_size')).toBeGreaterThan(names.indexOf('data'));
		expect(graph.connections.some((e) => e.toId === node.id && e.toPort === 'enc1_size')).toBe(
			true
		);
	});
});

// ---------------------------------------------------------------------------------------------
describe('Mean ± SEM: a group mean is sized by its group’s mean of the size column', () => {
	it('the arithmetic mean over exactly the rows the mean used', () => {
		// Row 1 has no y, so group 1's size is the mean of rows 0 and 2 (0 and 10: 5), not of
		// 0, 100 and 10. Group 2: sizes 20 and 40, mean 30. Group 3 has no size: no value.
		const x = mkCol([1, 1, 1, 2, 2, 3]);
		const y = mkCol([1, NaN, 3, 4, 5, 6]);
		const s = mkCol([0, 100, 10, 20, 40, null]);
		const plot = sessionPlot('meansem', [{ x: { refId: x }, y: { refId: y } }]);
		const d = sizeSeries(plot, s);
		expect(d.sizeMarkValues.slice(0, 2)).toEqual([5, 30]);
		expect(Number.isNaN(d.sizeMarkValues[2])).toBe(true);
		expect(d.sizeDomain).toMatchObject({ lo: 5, hi: 30 });
		expect(d.sizeSummaryNote).toMatch(/mean of its rows’ size values/);
		const circles = sizedCircles(draw(MeanSEM, plot));
		const byX = [...circles].sort((a, b) => a.cx - b.cx).map((c) => c.r);
		expect(byX).toEqual([2, 10, d.points.radius]);
		expect(plot.plot.sizeKey.noValue).toEqual({ r: d.points.radius, label: 'no value' });
	});

	it('a time size column is read as days since start, never hour of day; the CSV size row', () => {
		const x = mkCol([1, 1, 2, 2]);
		const y = mkCol([5, 6, 7, 8]);
		const t = mkCol([T0, T0 + 24 * H, T0 + 48 * H, T0 + 96 * H], 'time', 'time');
		const plot = sessionPlot('meansem', [{ x: { refId: x }, y: { refId: y } }]);
		const d = sizeSeries(plot, t);
		expect(d.sizeMode).toBe('daysSinceStart');
		expect(d.sizeMarkValues).toEqual([0.5, 3]);
		const { rows } = plot.plot.getDownloadData();
		expect(rows.find((r) => r[0] === 'size')).toEqual(['size', 0.5, 3]);
	});

	it('save and load', () => {
		const x = mkCol([1, 2]);
		const y = mkCol([5, 6]);
		const s = mkCol([1, 2]);
		const plot = sessionPlot('meansem', [{ x: { refId: x }, y: { refId: y } }]);
		sizeSeries(plot, s);
		plot.plot.sizeScale.position = 'topleft';
		const json = JSON.parse(JSON.stringify(plot.plot));
		const back = MeanSEMclass.fromJSON(plot, json);
		expect(back.data[0].sizeBy.refId).toBe(s);
		expect(back.sizeScale.position).toBe('topleft');
		expect(JSON.parse(JSON.stringify(back))).toEqual(json);
	});
});

// ---------------------------------------------------------------------------------------------
describe('Circular phase: every dot keeps its own row’s size', () => {
	function projection(inner) {
		const size = inner.plotSize;
		const corner = inner.legendCorner;
		const cx = inner.padding.left + (corner?.offsetX ?? 0) + size / 2;
		const cy = inner.padding.top + (corner?.offsetY ?? 0) + inner.clockShiftY + size / 2;
		return createPolar({ cx, cy, radius: (size / 2) * 0.82, period: inner.displayPeriod });
	}

	// Placement order differs from row order (see colourByHosts): stack groups 5 with 5.1 and
	// 1 with 1.1; bin (2 h bins) merges rows 0 and 3. Row 1 has no phase.
	const PHASES = [5, null, 1, 5.1, 1.1, 18];
	const SIZES = [0, 60, 100, 50, 25, 75];

	for (const placement of ['stack', 'bin', 'rim']) {
		it(`untimed, ${placement}: each dot at its row’s phase at its row’s size`, () => {
			const v = mkCol(PHASES);
			const s = mkCol(SIZES);
			const plot = sessionPlot('circularphase', [{ y: { refId: v } }]);
			plot.plot.placement = placement;
			plot.plot.binWidth = 2;
			const d = sizeSeries(plot, s);
			const circles = sizedCircles(draw(CircularPhase, plot));
			expect(circles.length).toBe(PHASES.length - 1);
			const P = projection(plot.plot);
			PHASES.forEach((phase, r) => {
				if (phase == null) return;
				const want = sizeRadius(SIZES[r] / 100, 2, 10);
				expect(d.sizeRadii.r[r]).toBeCloseTo(want, 12);
				const where = placement === 'bin' ? (Math.floor(phase / 2) + 0.5) * 2 : phase;
				const hit = circles.some(
					(c) => Math.abs(P.fromXY(c.cx, c.cy).value - where) < 1e-6 && Math.abs(c.r - want) < 1e-9
				);
				expect(hit, `row ${r} at ${where} h, r ${want}`).toBe(true);
			});
		});
	}

	it('stacked sized dots are spaced by the largest radius, so they do not overlap', () => {
		const v = mkCol([6, 6, 6, 6]);
		const s = mkCol([0, 100, 100, 0]);
		const plot = sessionPlot('circularphase', [{ y: { refId: v } }]);
		plot.plot.placement = 'stack';
		const d = sizeSeries(plot, s);
		expect(d.placeRadius).toBe(10);
		const circles = sizedCircles(draw(CircularPhase, plot));
		for (let i = 0; i < circles.length; i++) {
			for (let j = i + 1; j < circles.length; j++) {
				const a = circles[i];
				const b = circles[j];
				const gap = Math.hypot(a.cx - b.cx, a.cy - b.cy) - a.r - b.r;
				expect(gap, `${i}, ${j}`).toBeGreaterThanOrEqual(-1e-9);
			}
		}
	});

	it('timed: each row at (time of day, value) at its row’s size; the tooltip names it', () => {
		const t = mkCol([T0 + 1 * H, T0 + 7 * H, T0 + 13 * H], 'time', 'time');
		const v = mkCol([1, 2, 3]);
		const s = mkCol([30, 20, 10], 'number', 'activity');
		const plot = sessionPlot('circularphase', [{ x: { refId: t }, y: { refId: v } }]);
		const d = sizeSeries(plot, s);
		const svg = draw(CircularPhase, plot);
		const circles = sizedCircles(svg);
		const P = projection(plot.plot);
		[1, 7, 13].forEach((hour, r) => {
			const c = circles.find((k) => Math.abs(P.fromXY(k.cx, k.cy).value - hour) < 1e-6);
			expect(c.r).toBeCloseTo(d.sizeRadii.r[r], 12);
		});
		expect(circles.map((c) => c.r).sort((a, b) => b - a)[0]).toBe(10);
	});

	describe('the size key shares the strip beside the clock with the colour bar', () => {
		const overlap = (a, b) =>
			a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

		function both(position, size = { width: 640, height: 420 }) {
			const v = mkCol([1, 5, 9, 13, 17, 21]);
			const w = mkCol([2, 6, 10, 14, 18, 22]);
			const c = mkCol([0, 1, 2, 3, 4, 5]);
			const s = mkCol([5, 4, null, 2, 1, 0]);
			const plot = sessionPlot(
				'circularphase',
				[
					{ y: { refId: v }, label: 'A rather long first series name' },
					{ y: { refId: w }, label: 'Second series' }
				],
				size
			);
			plot.plot.legend.show = true;
			plot.plot.legend.position = position;
			colourSeries(plot, c);
			sizeSeries(plot, s);
			flushSync();
			return plot.plot;
		}
		function boxes(inner) {
			const k = inner.encodingKeys;
			const g = k.geometry(k.placement.length);
			const bar = {
				x: inner.padding.left + k.placement.x,
				y: inner.padding.top + k.placement.y,
				width: g.width,
				height: g.height
			};
			const sz = {
				x: inner.padding.left + k.sizePlacement.x,
				y: inner.padding.top + k.sizePlacement.y,
				width: k.sizeBase.width,
				height: k.sizeBase.height
			};
			const P = projection(inner);
			return { bar, sz, labelsRight: P.cx + P.radius + 26 - 0.01 };
		}

		for (const position of ['none', 'topright', 'bottomright', 'topleft', 'outsideright', 'auto']) {
			it(`legend ${position}`, () => {
				const inner = both(position === 'none' ? 'topright' : position);
				if (position === 'none') inner.legend.show = false;
				flushSync();
				const { bar, sz, labelsRight } = boxes(inner);
				expect(overlap(bar, sz), JSON.stringify({ bar, sz })).toBe(false);
				for (const box of [bar, sz]) {
					expect(box.x).toBeGreaterThanOrEqual(labelsRight);
					expect(box.x + box.width).toBeLessThanOrEqual(inner.viewWidth + 0.5);
					expect(box.y).toBeGreaterThanOrEqual(0);
					expect(box.y + box.height).toBeLessThanOrEqual(inner.viewHeight + 0.5);
				}
				// Under the bar, in the same strip.
				expect(sz.y).toBeGreaterThanOrEqual(bar.y + bar.height);
				expect(sz.x).toBe(bar.x);
				const box = inner.legendLayout.box;
				if (box && inner.legend.show) {
					const out = inner.legendLayout.outsidePosition;
					const corner = inner.legendCorner;
					const S = inner.plotSize;
					const W = S + (corner?.reserveW ?? 0);
					const Hh = S + (corner?.reserveH ?? 0);
					const M = box.margin;
					const pos = inner.legend.position;
					const auto = pos === 'auto' ? inner.legendLayout.auto : null;
					const lx = out ? out.x : auto ? auto.x : pos.endsWith('right') ? W - box.width - M : M;
					const ly = out
						? out.y
						: auto
							? auto.y
							: pos.startsWith('bottom')
								? Hh - box.height - M
								: M;
					const legend = {
						x: inner.padding.left + lx,
						y: inner.padding.top + ly,
						width: box.width,
						height: box.height
					};
					expect(overlap(sz, legend), JSON.stringify({ sz, legend })).toBe(false);
					expect(overlap(bar, legend), JSON.stringify({ bar, legend })).toBe(false);
				}
			});
		}

		it('a size key alone gets the strip; no backdrop; only "Beside plot" is offered', () => {
			const v = mkCol([1, 5, 9]);
			const s = mkCol([1, 2, 3]);
			const plot = sessionPlot('circularphase', [{ y: { refId: v } }]);
			sizeSeries(plot, s);
			const inner = plot.plot;
			expect(inner.encodingKeys.placement).toBeNull();
			const at = inner.encodingKeys.sizePlacement;
			const P = projection(inner);
			expect(inner.padding.left + at.x).toBeGreaterThanOrEqual(P.cx + P.radius + 26 - 0.01);
			expect(inner.encodingKeys.sizeDrawProps.backdrop).toBe(false);
			const panel = controls(CircularPhase, plot, 'properties');
			expect(panel.textContent).toContain('Size key');
			// One position only (beside the clock), so no Position select under the size key.
			const sizeKeyPanel = [...panel.querySelectorAll('.control-component')].find((c) =>
				c.querySelector('.control-component-title')?.textContent.includes('Size key')
			);
			expect(sizeKeyPanel.textContent).not.toContain('Position');
		});
	});

	it('save and load', () => {
		const v = mkCol([1, 2, 3]);
		const s = mkCol([3, 2, 1]);
		const plot = sessionPlot('circularphase', [{ y: { refId: v } }]);
		sizeSeries(plot, s);
		const json = JSON.parse(JSON.stringify(plot.plot));
		const back = CircularPhaseClass.fromJSON(plot, json);
		expect(back.data[0].sizeBy.refId).toBe(s);
		expect(JSON.parse(JSON.stringify(back))).toEqual(json);
	});
});

// ---------------------------------------------------------------------------------------------
describe('the panel offers Size by on every host', () => {
	for (const [type, Component, data] of [
		['scatterplot', null, (a, b) => [{ x: { refId: a }, y: { refId: b } }]],
		['qqplot', QQPlot, (a) => [{ column: { refId: a } }]],
		['meansem', MeanSEM, (a, b) => [{ x: { refId: a }, y: { refId: b } }]],
		['circularphase', CircularPhase, (a) => [{ y: { refId: a } }]]
	]) {
		it(type, async () => {
			const Comp = Component ?? (await import('./Scatterplot/Scatterplot.svelte')).default;
			const a = mkCol([1, 2, 3]);
			const b = mkCol([4, 5, 6]);
			const plot = sessionPlot(type, data(a, b));
			expect(plot.plot.constructor.encodingCapabilities.size).toBe(true);
			const panel = controls(Comp, plot);
			const box = panel.querySelector('input[aria-label="Size points by a column"]');
			expect(box, type).not.toBeNull();
		});
	}
});

// ---------------------------------------------------------------------------------------------
describe('large inputs: at most 8 x 65 paths, timed', () => {
	const n = 200_000;
	const lcg = (seed) => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
	const big = () => {
		const a = lcg(3);
		const b = lcg(77);
		const vals = new Array(n);
		const sizes = new Array(n);
		const cols = new Array(n);
		for (let i = 0; i < n; i++) {
			vals[i] = Math.sin(i * 0.37) * 10 + (i % 13);
			sizes[i] = i % 1009 === 0 ? null : a();
			cols[i] = i % 997 === 0 ? null : b();
		}
		return { vals, sizes, cols };
	};
	const report = {};
	const cap = SIZE_BUCKETS * (COLOUR_BUCKETS + 1);

	function timed(key, Component, plot, sizeId, colourId) {
		let t = performance.now();
		draw(Component, plot);
		const plainMs = performance.now() - t;
		cleanup();
		sizeSeries(plot, sizeId);
		colourSeries(plot, colourId);
		t = performance.now();
		const svg = draw(Component, plot);
		const ms = performance.now() - t;
		report[key] = { plain: Math.round(plainMs), sizedColoured: Math.round(ms) };
		expect(ms).toBeLessThan(Math.max(8000, plainMs * 8));
		const paths = svg.querySelectorAll('path[data-size-layer]').length;
		expect(paths).toBeLessThanOrEqual(cap);
		return paths;
	}

	it('Q-Q, Mean ± SEM and Circular phase', () => {
		const { vals, sizes, cols } = big();
		const qq = sessionPlot('qqplot', [{ column: { refId: mkCol(vals) } }]);
		expect(timed('qq', QQPlot, qq, mkCol(sizes), mkCol(cols))).toBeGreaterThan(cap * 0.9);
		cleanup();
		const x = mkCol(vals.map((_, i) => i % 1000));
		const ms = sessionPlot('meansem', [{ x: { refId: x }, y: { refId: mkCol(vals) } }]);
		timed('meansem', MeanSEM, ms, mkCol(sizes), mkCol(cols));
		cleanup();
		const t0 = mkCol(
			vals.map((_, i) => T0 + i * 60000),
			'time',
			'time'
		);
		const cp = sessionPlot('circularphase', [{ x: { refId: t0 }, y: { refId: mkCol(vals) } }]);
		expect(timed('circular', CircularPhase, cp, mkCol(sizes), mkCol(cols))).toBeGreaterThan(
			cap * 0.9
		);
		process.stdout.write(`size-by render, 200k rows (ms): ${JSON.stringify(report)}\n`);
	}, 180000);
});
