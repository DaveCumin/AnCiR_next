// @ts-nocheck
/**
 * Colour by on the phase 2 hosts (colour-by plan 2026-10-20, section 3.12): the Q-Q plot, Mean
 * +/- SEM and the Circular phase plot, on the REAL plot classes and components (no stubs, the
 * "green-suite blindness" lesson of the figure-style ADR). The shared machinery
 * (plotbits/colourBySeries.svelte.js, markerPaths.js) is the Scatterplot's, pinned in
 * plots/Scatterplot/colourBy.svelte.test.js; here each host's own part is pinned:
 *
 *   - Q-Q sorts its values: each drawn sample keeps the colour of the ROW it came from.
 *   - Mean +/- SEM draws one mark per group: its colour is the group's mean of the colour column
 *     over exactly the rows the mean used, the CIRCULAR mean for hour of day (across midnight);
 *     its connecting line takes each segment's starting mean's colour, solid; error bars keep
 *     their colour.
 *   - Circular phase places untimed dots by stack / bin / rim, which reorders them: each dot
 *     keeps its own row's colour in every placement, timed series too. Wedges keep the series
 *     colour. The colour bar sits beside the clock, clear of its hour labels and the legend.
 *
 * Plus, per host: buckets and "no value", the manual range, monochrome, save and load, the
 * canvas port, and a large input (timed, reported).
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
	clearProcessNodeGraphCache,
	plotNodeSlots
} from '$lib/core/ProcessNode.svelte.js';
import { applyEncodingWire } from '$lib/components/workflow/encodingWiring.js';
import { bucketColours, COLOUR_BUCKETS } from '$lib/components/plotbits/encodings.js';
import { createPolar } from '$lib/components/plotbits/polar.js';
import { COLOUR_BY_SWATCH } from '$lib/components/plotbits/colourBySeries.svelte.js';
import QQPlot, { QQPlotclass } from './QQPlot/QQPlot.svelte';
import MeanSEM, { MeanSEMclass } from './MeanSEM/MeanSEM.svelte';
import CircularPhase, { CircularPhaseClass } from './CircularPhase/CircularPhase.svelte';

const K = COLOUR_BUCKETS;
const VIRIDIS = bucketColours('viridis');
const TWILIGHT = bucketColours('twilight_shifted');
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

/** A plot in the session, built through Plot like every real one, with the given series. */
function sessionPlot(type, data, { width = 600, height = 400 } = {}) {
	core.plots.push(new Plot({ type, name: type, width, height, plot: { data } }));
	return core.plots[core.plots.length - 1];
}

function colourSeries(plot, colId, i = 0) {
	const d = plot.plot.data[i];
	d.enableColourBy();
	d.colourBy.refId = colId;
	flushSync();
	return d;
}

/** Every coloured marker path: { key, fill, centres }. Circles start `M cx cy m-r 0`. */
function bucketPaths(container, sel = 'path[data-colour-bucket]') {
	return [...container.querySelectorAll(sel)].map((p) => ({
		key: p.getAttribute('data-colour-bucket'),
		fill: p.getAttribute('fill'),
		centres: [...p.getAttribute('d').matchAll(/M([-\d.e]+) ([-\d.e]+)m/g)].map((m) => [
			Number(m[1]),
			Number(m[2])
		])
	}));
}

const draw = (Component, plot) =>
	render(Component, { props: { theData: plot, which: 'plot' } }).container;

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
describe('Q-Q: the colour follows each sample’s own row through the sort', () => {
	it('a column whose colour order is the reverse of its value order', () => {
		// Values descend down the rows, colours ascend: after the sort the smallest sample is
		// the LAST row, whose colour is the largest. Coloured by position instead (the bug the
		// permutation prevents), every mark would take the opposite end of the scale.
		const n = 10;
		const v = mkCol(Array.from({ length: n }, (_, i) => n - i));
		const c = mkCol(Array.from({ length: n }, (_, i) => i));
		const plot = sessionPlot('qqplot', [{ column: { refId: v } }]);
		const d = colourSeries(plot, c);
		expect(d.qq.sample).toEqual(Array.from({ length: n }, (_, i) => i + 1));
		expect(d.qq.order).toEqual(Array.from({ length: n }, (_, i) => n - 1 - i));
		expect(d.colourMarkValues).toEqual(Array.from({ length: n }, (_, i) => n - 1 - i));
		// Rendered: the sample drawn lowest on the y axis (smallest value) is in the top colour.
		const paths = bucketPaths(draw(QQPlot, plot));
		const lowest = paths
			.flatMap((p) => p.centres.map((ctr) => ({ y: ctr[1], fill: p.fill })))
			.sort((a, b) => b.y - a.y)[0];
		expect(lowest.fill).toBe(VIRIDIS[K - 1]);
		expect(paths.reduce((s, p) => s + p.centres.length, 0)).toBe(n);
	});

	it('ties keep their row order; dropped values and short colour columns', () => {
		// Row 2 has no value (dropped from the Q-Q); row 4 has no colour; the colour column is
		// one row short, so the last row has none either.
		const v = mkCol([5, 1, null, 1, 3, 2]);
		const c = mkCol([50, 10, 99, 11, NaN]);
		const plot = sessionPlot('qqplot', [{ column: { refId: v } }]);
		const d = colourSeries(plot, c);
		expect(d.qq.order).toEqual([1, 3, 5, 4, 0]);
		expect(d.colourMarkValues.map((x) => (Number.isFinite(x) ? x : null))).toEqual([
			10,
			11,
			null,
			null,
			50
		]);
		expect(d.colourNoValueCount).toBe(2);
		expect(d.colourLengthNote).toMatch(/5 rows and this series 6/);
		const paths = bucketPaths(draw(QQPlot, plot));
		// "no value" first (underneath), in the series colour; the bar says so.
		expect(paths[0]).toMatchObject({ key: 'none', fill: d.colour });
		expect(paths[0].centres.length).toBe(2);
		expect(plot.plot.colourKey.noValue).toEqual({ colour: d.colour, label: 'no value' });
		// The range is the marks' (10 to 50): the dropped row's 99 is not drawn, so not counted.
		expect(d.colourDomain).toMatchObject({ lo: 10, hi: 50 });
	});

	it('Colour by off draws one path in the series colour, at the series opacity', () => {
		const v = mkCol([3, 1, 2, 5, 4]);
		const plot = sessionPlot('qqplot', [{ column: { refId: v } }]);
		const svg = draw(QQPlot, plot);
		const pts = svg.querySelectorAll('path.qq-points');
		expect(pts.length).toBe(1);
		expect(pts[0].getAttribute('fill')).toBe(plot.plot.data[0].colour);
		expect(pts[0].getAttribute('fill-opacity')).toBe(String(plot.plot.data[0].opacity));
		expect(pts[0].hasAttribute('data-colour-bucket')).toBe(false);
		expect(svg.querySelectorAll('circle').length).toBe(0);
	});

	it('manual range, monochrome, the grey legend swatch and the CSV column', () => {
		const v = mkCol([1, 2, 3, 4]);
		const c = mkCol([0, 10, 20, 30]);
		const plot = sessionPlot('qqplot', [{ column: { refId: v } }]);
		const d = colourSeries(plot, c);
		d.colourEncoding.domainMin = 10;
		d.colourEncoding.domainMax = 20;
		flushSync();
		expect([...d.colourIdx]).toEqual([0, 0, K - 1, K - 1]);
		expect(plot.plot.colourKey.ticks.map((t) => t.label)).toEqual(['≤ 10', '15', '≥ 20']);
		plot.style = { ...(plot.style ?? {}), monochrome: true };
		flushSync();
		expect(d.colourMap).toBe('greys');
		expect(d.colourEncoding.colormap).toBe('auto');
		expect(d.getLegendItem().elements[0].color).toBe(COLOUR_BY_SWATCH);
		const csv = plot.plot.getDownloadData();
		expect(csv.headers.at(-1)).toBe('colour');
		expect(csv.rows.map((r) => r.at(-1))).toEqual([0, 10, 20, 30]);
	});

	it('save and load: the column, the settings and the colour bar; old files load off', () => {
		const v = mkCol([1, 2, 3]);
		const c = mkCol([3, 2, 1]);
		const plot = sessionPlot('qqplot', [{ column: { refId: v } }]);
		const d = colourSeries(plot, c);
		d.colourEncoding.colormap = 'magma';
		plot.plot.colourScale.orientation = 'horizontal';
		const json = JSON.parse(JSON.stringify(plot.plot));
		expect(json.colourScale.orientation).toBe('horizontal');
		const back = QQPlotclass.fromJSON(plot, json);
		expect(back.data[0].colourBy.refId).toBe(c);
		expect(back.data[0].colourEncoding.colormap).toBe('magma');
		expect(back.colourScale.orientation).toBe('horizontal');
		expect(JSON.parse(JSON.stringify(back))).toEqual(json);
		// A file saved without Colour by: off, no colourScale saved.
		delete json.colourScale;
		delete json.data[0].colourBy;
		delete json.data[0].colourEncoding;
		const plain = QQPlotclass.fromJSON(plot, json);
		expect(plain.data[0].colourEncoding).toBeNull();
		expect('colourScale' in JSON.parse(JSON.stringify(plain))).toBe(false);
	});

	it('the canvas: a colour port after the data port, with an edge once wired', () => {
		const v = mkCol([1, 2, 3]);
		const c = mkCol([3, 2, 1], 'number', 'temp');
		const plot = sessionPlot('qqplot', [{ column: { refId: v } }]);
		plot.plot.data[0].enableColourBy();
		clearProcessNodeGraphCache();
		let graph = getCachedProcessNodeGraph(core, appConsts);
		let node = graph.nodes.find((n) => n.id === `plot_${plot.id}`);
		const rows = plotNodeSlots(node.ports.inputs, node.ports.outputs)
			.inputRows.filter((r) => r.kind === 'port')
			.map((r) => r.port.name);
		// The colour port right after the data port (before the overlays' drop port).
		expect(rows.slice(0, 2)).toEqual(['data', 'enc1_colour']);
		expect(applyEncodingWire(plot.plot, 'enc1_colour', c)).toBe(true);
		clearProcessNodeGraphCache();
		graph = getCachedProcessNodeGraph(core, appConsts);
		expect(
			graph.connections.some(
				(e) =>
					e.toId === `plot_${plot.id}` && e.toPort === 'enc1_colour' && e.fromId === `data_${c}`
			)
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------------------------
describe('Mean ± SEM: a group mean is coloured by its group’s summary of the colour column', () => {
	it('hour of day uses the CIRCULAR mean: a group across midnight is midnight, not noon', () => {
		// Group 1: 23:00 and 01:00 (arithmetic mean 12:00, circular mean 00:00); group 2: 11:00
		// and 13:00 (both means 12:00).
		const x = mkCol([1, 1, 2, 2]);
		const y = mkCol([5, 6, 7, 8]);
		const t = mkCol([T0 + 23 * H, T0 + 25 * H, T0 + 11 * H, T0 + 13 * H], 'time', 'time');
		const plot = sessionPlot('meansem', [{ x: { refId: x }, y: { refId: y } }]);
		const d = colourSeries(plot, t);
		expect(d.colourMode).toBe('hourOfDay');
		expect(d.colourMarkValues[0]).toBeCloseTo(0, 9);
		expect(d.colourMarkValues[1]).toBeCloseTo(12, 9);
		expect([...d.colourIdx]).toEqual([0, K / 2]);
		expect(d.colourSummaryNote).toMatch(/circular mean/);
		const paths = bucketPaths(draw(MeanSEM, plot), 'path[data-colour-bucket]');
		expect(paths.map((p) => [p.key, p.fill])).toEqual([
			['b0', TWILIGHT[0]],
			[`b${K / 2}`, TWILIGHT[K / 2]]
		]);
	});

	it('a value column uses the arithmetic mean over exactly the rows the mean used', () => {
		// Row 1 has no y, so the group-1 mean uses rows 0 and 2 only: the colour is the mean of
		// 0 and 10 (5), not of 0, 100 and 10. Group 2's colour cells are empty: no value.
		const x = mkCol([1, 1, 1, 2, 2]);
		const y = mkCol([1, NaN, 3, 4, 5]);
		const c = mkCol([0, 100, 10, null, NaN]);
		const plot = sessionPlot('meansem', [{ x: { refId: x }, y: { refId: y } }]);
		const d = colourSeries(plot, c);
		expect(d.stats.map((s) => s.rows)).toEqual([
			[0, 2],
			[3, 4]
		]);
		expect(d.colourMarkValues[0]).toBe(5);
		expect(Number.isNaN(d.colourMarkValues[1])).toBe(true);
		expect(d.colourNoValueCount).toBe(1);
		const svg = draw(MeanSEM, plot);
		const paths = bucketPaths(svg);
		expect(paths[0]).toMatchObject({ key: 'none', fill: d.points.colour });
		expect(plot.plot.colourKey.noValue).toMatchObject({ colour: d.points.colour });
		// Error bars keep their own colour.
		const bars = [...svg.querySelectorAll('line')].filter((l) => l.getAttribute('stroke-width'));
		expect(bars.length).toBeGreaterThan(0);
		for (const l of bars) expect(l.getAttribute('stroke')).toBe(d.errorColour);
	});

	it('the connecting line: each segment in its starting mean’s colour, solid, off by default', () => {
		const x = mkCol([1, 2, 3]);
		const y = mkCol([1, 2, 3]);
		const c = mkCol([0, 10, 20]);
		const plot = sessionPlot('meansem', [{ x: { refId: x }, y: { refId: y } }]);
		const d = plot.plot.data[0];
		d.line.draw = true;
		d.line.stroke = '5 3';
		colourSeries(plot, c);
		expect(d.colourEncoding.colourLine).toBe(false);
		let svg = draw(MeanSEM, plot);
		expect(svg.querySelectorAll('path[data-line-colour-bucket]').length).toBe(0);
		cleanup();
		d.colourEncoding.colourLine = true;
		flushSync();
		svg = draw(MeanSEM, plot);
		const segs = [...svg.querySelectorAll('path[data-line-colour-bucket]')];
		// Two segments: 1 to 2 in the first mean's colour, 2 to 3 in the second's.
		expect(segs.map((p) => p.getAttribute('data-line-colour-bucket'))).toEqual(['b0', 'b32']);
		expect(segs.map((p) => p.getAttribute('stroke'))).toEqual([VIRIDIS[0], VIRIDIS[32]]);
		for (const p of segs) {
			expect(p.getAttribute('style')).not.toMatch(/dasharray/);
			expect(p.getAttribute('stroke-linecap')).toBe('round');
		}
		const legend = d.getLegendItem().elements;
		expect(legend.map((e) => e.color)).toEqual([COLOUR_BY_SWATCH, COLOUR_BY_SWATCH]);
	});

	it('save and load, and the CSV colour row', () => {
		const x = mkCol([1, 2]);
		const y = mkCol([1, 2]);
		const c = mkCol([4, 8]);
		const plot = sessionPlot('meansem', [{ x: { refId: x }, y: { refId: y } }]);
		const d = colourSeries(plot, c);
		d.colourEncoding.mode = 'value';
		plot.plot.colourScale.position = 'topleft';
		const json = JSON.parse(JSON.stringify(plot.plot));
		const back = MeanSEMclass.fromJSON(plot, json);
		expect(back.data[0].colourBy.refId).toBe(c);
		expect(back.colourScale.position).toBe('topleft');
		expect(JSON.parse(JSON.stringify(back))).toEqual(json);
		const csv = plot.plot.getDownloadData();
		expect(csv.rows.at(-1)).toEqual(['colour', 4, 8]);
	});
});

// ---------------------------------------------------------------------------------------------
describe('Circular phase: every dot keeps its own row’s colour', () => {
	/** The clock's projection as the plot draws it. */
	function projection(inner) {
		const size = inner.plotSize;
		const corner = inner.legendCorner;
		const cx = inner.padding.left + (corner?.offsetX ?? 0) + size / 2;
		const cy = inner.padding.top + (corner?.offsetY ?? 0) + inner.clockShiftY + size / 2;
		return createPolar({ cx, cy, radius: (size / 2) * 0.82, period: inner.displayPeriod });
	}

	// Rows whose placement order differs from row order: stack groups 5 with 5.1 and 1 with
	// 1.1 (emitting rows 0, 2, 1, 3); bin (2 h bins) puts rows 0 and 2 in the 4 to 6 h bin.
	// Row 1 has no phase (not drawn), so a dot's position among the drawn values is not its
	// row either.
	const PHASES = [5, null, 1, 5.1, 1.1, 18];
	const COLOURS = [0, 60, 100, 50, 25, 75];

	for (const placement of ['stack', 'bin', 'rim']) {
		it(`untimed, ${placement}: each dot sits at its row’s phase in its row’s colour`, () => {
			const v = mkCol(PHASES);
			const c = mkCol(COLOURS);
			const plot = sessionPlot('circularphase', [{ y: { refId: v } }]);
			plot.plot.placement = placement;
			plot.plot.binWidth = 2;
			const d = colourSeries(plot, c);
			const paths = bucketPaths(draw(CircularPhase, plot));
			expect(paths.reduce((s, p) => s + p.centres.length, 0)).toBe(PHASES.length - 1);
			const P = projection(plot.plot);
			PHASES.forEach((phase, r) => {
				if (phase == null) return;
				const b = d.colourIdx[r];
				const path = paths.find((p) => p.key === `b${b}`);
				expect(path?.fill, `row ${r}`).toBe(VIRIDIS[b]);
				const where = placement === 'bin' ? (Math.floor(phase / 2) + 0.5) * 2 : phase;
				const hit = path.centres.some(([x, y]) => Math.abs(P.fromXY(x, y).value - where) < 1e-6);
				expect(hit, `row ${r} at ${where} h`).toBe(true);
			});
		});
	}

	it('timed: each row at (time of day, value) in its row’s colour; wedges keep the series colour', () => {
		const t = mkCol([T0 + 1 * H, T0 + 7 * H, T0 + 13 * H, T0 + 19 * H], 'time', 'time');
		const v = mkCol([1, 2, 3, 4]);
		const c = mkCol([30, 20, 10, 0]);
		const plot = sessionPlot('circularphase', [{ x: { refId: t }, y: { refId: v } }]);
		const d = colourSeries(plot, c);
		expect(d.timeWired).toBe(true);
		const svg = draw(CircularPhase, plot);
		const paths = bucketPaths(svg);
		const P = projection(plot.plot);
		[1, 7, 13, 19].forEach((hour, r) => {
			const path = paths.find((p) => p.key === `b${d.colourIdx[r]}`);
			expect(path.centres.some(([x, y]) => Math.abs(P.fromXY(x, y).value - hour) < 1e-6)).toBe(
				true
			);
		});
		expect(paths.map((p) => p.fill)).toEqual([VIRIDIS[0], VIRIDIS[21], VIRIDIS[42], VIRIDIS[63]]);
	});

	it('wedges and mean vectors keep the series colour; legend swatch is grey', () => {
		const v = mkCol([1, 2, 3, 13]);
		const c = mkCol([0, 1, 2, 3]);
		const plot = sessionPlot('circularphase', [{ y: { refId: v } }]);
		plot.plot.showWedges = true;
		const d = colourSeries(plot, c);
		const svg = draw(CircularPhase, plot);
		const wedges = [...svg.querySelectorAll('path')].filter(
			(p) => !p.hasAttribute('data-colour-bucket') && p.getAttribute('fill') === d.colour
		);
		expect(wedges.length).toBeGreaterThan(0);
		expect(d.getLegendItem().elements[0].color).toBe(COLOUR_BY_SWATCH);
	});

	it('a missing colour value is drawn in the series colour; the tooltip names the value', () => {
		const v = mkCol([2, 4, 6]);
		const c = mkCol([10, null, 30]);
		const plot = sessionPlot('circularphase', [{ y: { refId: v } }]);
		const d = colourSeries(plot, c);
		expect(d.colourNoValueCount).toBe(1);
		const paths = bucketPaths(draw(CircularPhase, plot));
		expect(paths[0]).toMatchObject({ key: 'none', fill: d.colour });
		expect(plot.plot.colourKey.noValue).toMatchObject({ colour: d.colour });
	});

	describe('the colour bar sits beside the clock, clear of its labels and of the legend', () => {
		const overlap = (a, b) =>
			a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

		function coloured(position, size = { width: 600, height: 400 }) {
			const v = mkCol([1, 5, 9, 13, 17, 21]);
			const w = mkCol([2, 6, 10, 14, 18, 22]);
			const c = mkCol([0, 1, 2, 3, 4, 5]);
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
			flushSync();
			return plot.plot;
		}
		/** The bar and the clock's right label reach, in view px. */
		function rects(inner) {
			const at = inner.colourKeys.placement;
			const g = inner.colourKeys.geometry(at.length);
			const bar = {
				x: inner.padding.left + at.x,
				y: inner.padding.top + at.y,
				width: g.width,
				height: g.height
			};
			const P = projection(inner);
			// The "6" label reaches about 21 px past the ring; the plot keeps 26 px (LABEL_REACH,
			// the reach plus air) clear beside it.
			return { bar, labelsRight: P.cx + P.radius + 26 - 0.01 };
		}

		for (const position of ['none', 'topright', 'bottomright', 'topleft', 'outsideright', 'auto']) {
			it(`legend ${position}`, () => {
				const inner = coloured(position === 'none' ? 'topright' : position);
				if (position === 'none') inner.legend.show = false;
				flushSync();
				const { bar, labelsRight } = rects(inner);
				// Past the "6" label, and inside the view.
				expect(bar.x).toBeGreaterThanOrEqual(labelsRight);
				expect(bar.x + bar.width).toBeLessThanOrEqual(inner.viewWidth + 0.5);
				expect(bar.y).toBeGreaterThanOrEqual(0);
				expect(bar.y + bar.height).toBeLessThanOrEqual(inner.viewHeight + 0.5);
				// Never over the legend as drawn.
				const box = inner.legendLayout.box;
				if (box && inner.legend.show) {
					const out = inner.legendLayout.outsidePosition;
					const corner = inner.legendCorner;
					const size = inner.plotSize;
					const W = size + (corner?.reserveW ?? 0);
					const Hh = size + (corner?.reserveH ?? 0);
					const M = box.margin;
					const pos = inner.legend.position;
					const lx = out
						? out.x
						: pos === 'auto' && inner.legendLayout.auto
							? inner.legendLayout.auto.x
							: pos.endsWith('right')
								? W - box.width - M
								: M;
					const ly = out
						? out.y
						: pos === 'auto' && inner.legendLayout.auto
							? inner.legendLayout.auto.y
							: pos.startsWith('bottom')
								? Hh - box.height - M
								: M;
					const legend = {
						x: inner.padding.left + lx,
						y: inner.padding.top + ly,
						width: box.width,
						height: box.height
					};
					expect(overlap(bar, legend), JSON.stringify({ bar, legend })).toBe(false);
				}
			});
		}

		it('a small figure: the labels hang further out, and the bar still clears them', () => {
			const inner = coloured('topright', { width: 330, height: 190 });
			inner.legend.show = false;
			flushSync();
			const { bar, labelsRight } = rects(inner);
			expect(bar.x).toBeGreaterThanOrEqual(labelsRight);
			expect(bar.x + bar.width).toBeLessThanOrEqual(inner.viewWidth + 0.5);
		});

		it('only "Beside plot" is offered, and no backdrop is drawn whatever is saved', () => {
			const inner = coloured('topright');
			expect(inner.colourKeys.positions).toEqual(['right']);
			inner.colourScale.position = 'topleft';
			flushSync();
			expect(inner.colourKeys.drawProps.backdrop).toBe(false);
		});
	});

	it('save and load', () => {
		const v = mkCol([1, 2, 3]);
		const c = mkCol([3, 2, 1]);
		const plot = sessionPlot('circularphase', [{ y: { refId: v } }]);
		colourSeries(plot, c);
		const json = JSON.parse(JSON.stringify(plot.plot));
		const back = CircularPhaseClass.fromJSON(plot, json);
		expect(back.data[0].colourBy.refId).toBe(c);
		expect(JSON.parse(JSON.stringify(back))).toEqual(json);
	});
});

// ---------------------------------------------------------------------------------------------
describe('large inputs: at most 65 paths, timed', () => {
	const n = 200_000;
	const big = () => {
		const vals = new Array(n);
		const cols = new Array(n);
		for (let i = 0; i < n; i++) {
			vals[i] = Math.sin(i * 0.37) * 10 + (i % 13);
			cols[i] = i % 997 === 0 ? null : (i * 7919) % 1000;
		}
		return { vals, cols };
	};
	const report = {};

	/**
	 * Render a plot plain, then coloured, and time both. Colouring must cost no more than a
	 * small multiple of the plain render (one DOM node per point would cost seconds); the
	 * bound is loose so the test is not timing-flaky.
	 */
	function timed(key, Component, plot, colId) {
		let t = performance.now();
		const plain = draw(Component, plot);
		const plainMs = performance.now() - t;
		expect(plain.querySelectorAll('path[data-colour-bucket]').length).toBe(0);
		cleanup();
		colourSeries(plot, colId);
		t = performance.now();
		const svg = draw(Component, plot);
		const ms = performance.now() - t;
		report[key] = { plain: Math.round(plainMs), coloured: Math.round(ms) };
		expect(ms).toBeLessThan(Math.max(5000, plainMs * 6));
		return svg;
	}

	it('Q-Q', () => {
		const { vals, cols } = big();
		const plot = sessionPlot('qqplot', [{ column: { refId: mkCol(vals) } }]);
		const svg = timed('qq', QQPlot, plot, mkCol(cols));
		expect(svg.querySelectorAll('path[data-colour-bucket]').length).toBe(K + 1);
	}, 60000);

	it('Mean ± SEM (1000 groups)', () => {
		const { vals, cols } = big();
		const x = mkCol(vals.map((_, i) => i % 1000));
		const plot = sessionPlot('meansem', [{ x: { refId: x }, y: { refId: mkCol(vals) } }]);
		const svg = timed('meansem', MeanSEM, plot, mkCol(cols));
		expect(svg.querySelectorAll('path[data-colour-bucket]').length).toBeLessThanOrEqual(K + 1);
	}, 60000);

	it('Circular phase (timed, and untimed stacked)', () => {
		const { vals, cols } = big();
		const t0 = mkCol(
			vals.map((_, i) => T0 + i * 60000),
			'time',
			'time'
		);
		const plot = sessionPlot('circularphase', [{ x: { refId: t0 }, y: { refId: mkCol(vals) } }]);
		const svg = timed('circularTimed', CircularPhase, plot, mkCol(cols));
		expect(svg.querySelectorAll('path[data-colour-bucket]').length).toBe(K + 1);
		cleanup();
		const phases = mkCol(vals.map((v) => ((v % 24) + 24) % 24));
		const untimed = sessionPlot('circularphase', [{ y: { refId: phases } }]);
		const svg2 = timed('circularStack', CircularPhase, untimed, mkCol(cols));
		expect(svg2.querySelectorAll('path[data-colour-bucket]').length).toBe(K + 1);
		process.stdout.write(`colour-by render, 200k rows (ms): ${JSON.stringify(report)}\n`);
	}, 120000);
});
