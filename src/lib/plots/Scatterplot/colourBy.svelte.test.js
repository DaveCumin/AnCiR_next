// @ts-nocheck
/**
 * Colour by on Scatterplot points (colour-by plan 2026-10-20, phase 1b), on the REAL plot
 * class and the REAL Points renderer (no stubs: the "green-suite blindness" lesson of the
 * figure-style ADR, where synthetic fixtures passed while the real shape was inert).
 *
 * Pins: the bucket a value lands in (both sides of each boundary), the 64-path cap and the
 * gates either side of it, "no value" marks (drawn in the series colour, underneath, and named
 * on the colour bar), hour of day across midnight and in a half-hour zone, the manual range,
 * monochrome, the colour bar's placement against the legend, save/load, facets, the canvas
 * port and its edge, column delete, copy/paste remapping, and a 200k-point render.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { render, cleanup } from '@testing-library/svelte';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { Column, removeColumn } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { loadPlots } from '$test/plotRegistry.js';
import {
	getCachedProcessNodeGraph,
	clearProcessNodeGraphCache,
	plotNodeSlots
} from '$lib/core/ProcessNode.svelte.js';
import { describeNodePort } from '$lib/core/portDescriptions.js';
import { panelsFor, projectPanel } from '$lib/core/facetPanels.svelte.js';
import Scatterplot, { Scatterplotclass } from './Scatterplot.svelte';
import { bucketColours, COLOUR_BUCKETS } from '$lib/components/plotbits/encodings.js';
import { colormapRGB } from '$lib/components/plotbits/colormaps.js';
import {
	applyEncodingWire,
	clearEncodingPort,
	removeEncodingWire,
	rerouteEncodingWire,
	encodingPortSelection
} from '$lib/components/workflow/encodingWiring.js';

const K = COLOUR_BUCKETS;
const VIRIDIS = bucketColours('viridis');

function mkCol(values, type = 'number', name = 'c') {
	const c = new Column({ type, data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

/** A scatter (square markers, so each marker is one `M`) with series 0 coloured by `cs`. */
function mkPlot(xs, ys, cs, { ctype = 'number', width = 600, height = 400 } = {}) {
	const wrapper = { id: 7, type: 'scatterplot', name: 'p', width, height, plot: null, style: {} };
	const s = new Scatterplotclass(wrapper, null);
	s.padding = { top: 20, right: 30, bottom: 30, left: 50 };
	s.addData({ x: { refId: mkCol(xs, 'number', 'x') }, y: { refId: mkCol(ys, 'number', 'y') } });
	s.data[0].points.shape = 'square';
	s.data[0].points.radius = 2;
	if (cs) {
		s.data[0].enableColourBy();
		s.data[0].colourBy.refId = mkCol(cs, ctype, 'temp');
	}
	wrapper.plot = s;
	return { wrapper, s, d: s.data[0] };
}

/** Each drawn point path: { key, fill, centres: [[x, y], ...] } (square: M at x - r, y - r). */
function drawnPaths(container) {
	return [...container.querySelectorAll('path[data-colour-bucket]')].map((p) => {
		const d = p.getAttribute('d');
		const centres = [...d.matchAll(/M([-\d.e]+) ([-\d.e]+)h/g)].map((m) => [
			Number(m[1]) + 2,
			Number(m[2]) + 2
		]);
		return { key: p.getAttribute('data-colour-bucket'), fill: p.getAttribute('fill'), centres };
	});
}

function draw(wrapper) {
	return render(Scatterplot, { props: { theData: wrapper, which: 'plot' } }).container;
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

describe('mapping and buckets on the real renderer', () => {
	it('a value lands in its bucket, on both sides of each boundary', () => {
		// Range [0, 64], so bucket b is [b, b + 1): the boundaries are the integers.
		const cs = [0, 0.999999, 1, 31.999999, 32, 62.999999, 63, 63.5, 64];
		const want = [0, 0, 1, 31, 32, 62, 63, 63, 63];
		const xs = cs.map((_, i) => i);
		const ys = cs.map(() => 1);
		const { wrapper, d } = mkPlot(xs, ys, cs);
		expect([...d.colourIdx]).toEqual(want);
		const paths = drawnPaths(draw(wrapper));
		// Every point drawn once, in a path whose fill is its bucket's colour.
		const byKey = Object.fromEntries(paths.map((p) => [p.key, p]));
		for (let i = 0; i < cs.length; i++) {
			expect(byKey[`b${want[i]}`]?.fill, `row ${i}`).toBe(VIRIDIS[want[i]]);
		}
		expect(paths.reduce((n, p) => n + p.centres.length, 0)).toBe(cs.length);
		// The bucket colour is the map at the bucket's centre.
		expect(VIRIDIS[32]).toBe(colormapRGB('viridis', 32.5 / 64));
	});

	it('draws one path per non-empty bucket: 63, 64 and 65 distinct values (the cap)', () => {
		for (const [distinct, paths] of [
			[63, 63],
			[64, 64],
			[65, 64],
			[640, 64]
		]) {
			cleanup();
			core.data = [];
			core.rawData = new Map();
			// `distinct` values spread over the range; with 63 values over [0, 62] the buckets
			// used are 63 distinct ones (b = floor(v / 62 * 64) is one-to-one there).
			const cs = Array.from({ length: distinct }, (_, i) => i);
			const { wrapper } = mkPlot(
				cs.map((_, i) => i),
				cs.map(() => 1),
				cs
			);
			const got = drawnPaths(draw(wrapper));
			expect(got.length, `${distinct} distinct values`).toBe(paths);
			expect(got.every((p) => p.key !== 'none')).toBe(true);
		}
	});

	it('Colour by off draws the one series-coloured path, exactly as before', () => {
		const { wrapper, s } = mkPlot([0, 1, 2], [1, 2, 3], null);
		const c = draw(wrapper);
		expect(c.querySelectorAll('path[data-colour-bucket]').length).toBe(0);
		// The points: one path holding all three square markers, in the series colour.
		const pts = [...c.querySelectorAll('path')].filter(
			(p) => (p.getAttribute('d') ?? '').match(/M[^M]*h/g)?.length === 3
		);
		expect(pts.length).toBe(1);
		expect(pts[0].getAttribute('fill')).toBe(s.data[0].points.colour);
		expect(c.querySelector('.colour-scale')).toBeNull();
		// And a plain series saves no colour-by fields at all.
		const j = JSON.parse(JSON.stringify(s));
		expect('colourBy' in j.data[0]).toBe(false);
		expect('colourEncoding' in j.data[0]).toBe(false);
		expect('colourScale' in j).toBe(false);
	});
});

describe('missing colour values', () => {
	it('are drawn in the series colour, underneath, and the colour bar says so', () => {
		// null, NaN, a text cell, and two rows past the end of a shorter colour column.
		const cs = [0, null, 5, NaN, 'x', 10];
		const xs = [0, 1, 2, 3, 4, 5, 6, 7];
		const ys = xs.map(() => 1);
		const { wrapper, d } = mkPlot(xs, ys, cs);
		expect(d.colourNoValueCount).toBe(5);
		const c = draw(wrapper);
		const paths = drawnPaths(c);
		expect(paths[0].key).toBe('none');
		expect(paths[0].fill).toBe(d.points.colour);
		expect(paths[0].centres.length).toBe(5);
		expect(paths.slice(1).reduce((n, p) => n + p.centres.length, 0)).toBe(3);
		expect(c.querySelector('.colour-scale-novalue')?.textContent).toContain('no value');
	});

	it('no "no value" entry when every point has a value', () => {
		const { wrapper } = mkPlot([0, 1, 2], [1, 1, 1], [1, 2, 3]);
		const c = draw(wrapper);
		expect(c.querySelector('.colour-scale')).not.toBeNull();
		expect(c.querySelector('.colour-scale-novalue')).toBeNull();
	});
});

describe('hour of day', () => {
	const H = 3600000;
	const t0 = Date.UTC(2026, 0, 10, 0, 0);

	it('a time column reads as hour of day automatically; 23:30 and 00:30 sit at the two ends', () => {
		const times = [t0 + 23.5 * H, t0 + 24.5 * H, t0 + 12 * H];
		const { wrapper, d, s } = mkPlot([0, 1, 2], [1, 1, 1], times, { ctype: 'time' });
		expect(d.colourMode).toBe('hourOfDay');
		expect(d.colourMap).toBe('twilight_shifted');
		expect([...d.colourIdx]).toEqual([Math.floor((23.5 / 24) * K), Math.floor((0.5 / 24) * K), 32]);
		// A cyclic map: the two ends are the same colour, so midnight shows no seam.
		const tw = bucketColours('twilight_shifted');
		const rgb = (str) => str.match(/\d+/g).map(Number);
		const dist = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
		expect(dist(tw[d.colourIdx[0]], tw[d.colourIdx[1]])).toBeLessThan(25);
		expect(dist(tw[d.colourIdx[0]], tw[d.colourIdx[2]])).toBeGreaterThan(100);
		const c = draw(wrapper);
		expect(s.colourKey.title).toBe('Hour of day (UTC)');
		const ticks = [...c.querySelectorAll('.colour-scale-tick')].map((t) => t.textContent);
		expect(ticks).toEqual(['24', '18', '12', '6', '0']);
		expect(c.querySelector('.colour-scale-label')?.textContent).toBe('Hour of day (UTC)');
	});

	it('reads the display zone, half-hour zones included, and names it', () => {
		appState.displayTimezone = 'Asia/Kolkata'; // UTC+5:30
		const times = [t0 + 18 * H, t0 + 18.5 * H]; // 23:30 and 00:00 in Kolkata
		const { d, s } = mkPlot([0, 1], [1, 1], times, { ctype: 'time' });
		expect(d.colourEncoded.values[0]).toBeCloseTo(23.5, 9);
		expect(d.colourEncoded.values[1]).toBeCloseTo(0, 9);
		expect([...d.colourIdx]).toEqual([62, 0]);
		expect(s.colourKey.title).toBe('Hour of day (Asia/Kolkata)');
	});

	// Per-column time zone, phase 2: the hour of day is the COLOUR column's own clock, and the
	// bar names that zone. "Show times in" relabels times only; it never moves a colour.
	it("reads the colour column's own zone (epoch ms in +05:30) and names it", () => {
		const times = [t0 + 18 * H, t0 + 18.5 * H]; // 23:30 and 00:00 at +05:30
		const { d, s } = mkPlot([0, 1], [1, 1], times, { ctype: 'time' });
		core.data.find((c) => c.id === d.colourBy.refId).timeZone = '+05:30';
		flushSync();
		expect(d.colourEncoded.values[0]).toBeCloseTo(23.5, 9);
		expect(d.colourEncoded.values[1]).toBeCloseTo(0, 9);
		expect(s.colourKey.title).toBe('Hour of day (UTC+05:30)');
		appState.showTimesIn = 'Pacific/Auckland';
		flushSync();
		expect(d.colourEncoded.values[0]).toBeCloseTo(23.5, 9);
		expect(s.colourKey.title).toBe('Hour of day (UTC+05:30)');
		appState.showTimesIn = 'column';
	});

	it('a zone-less text column in Pacific/Auckland reads its hours as written', () => {
		const { d, s } = mkPlot([0, 1], [1, 1], ['2026-01-10 07:15', '2026-01-10 19:45'], {
			ctype: 'time'
		});
		const col = core.data.find((c) => c.id === d.colourBy.refId);
		col.timeFormat = 'YYYY-MM-DD HH:mm';
		col.timeZone = 'Pacific/Auckland';
		flushSync();
		expect([...d.colourEncoded.values]).toEqual([7.25, 19.75]);
		expect(s.colourKey.title).toBe('Hour of day (Pacific/Auckland)');
	});

	it('the tooltip names the colour value', () => {
		const { wrapper } = mkPlot([0], [1], [t0 + 14.5 * H], { ctype: 'time' });
		const c = draw(wrapper);
		const path = c.querySelector('path[data-colour-bucket]');
		let detail = null;
		c.addEventListener('tooltip', (e) => (detail = e.detail));
		const [cx, cy] = drawnPaths(c)[0].centres[0];
		// happy-dom computes no offsetX / offsetY: give them, at the point's centre.
		const ev = new MouseEvent('mousemove', { bubbles: true });
		Object.defineProperty(ev, 'offsetX', { value: cx + 50 });
		Object.defineProperty(ev, 'offsetY', { value: cy + 20 });
		path.dispatchEvent(ev);
		expect(detail?.content).toContain('Hour of day (UTC):</span> 14:30');
	});
});

describe('range', () => {
	it('a manual range clamps outside values to the end colours and marks the ends', () => {
		const cs = [0, 10, 15, 20, 30];
		const { d, s } = mkPlot([0, 1, 2, 3, 4], [1, 1, 1, 1, 1], cs);
		expect(d.colourDomain).toMatchObject({ lo: 0, hi: 30 });
		d.colourEncoding.domainMin = 10;
		d.colourEncoding.domainMax = 20;
		flushSync();
		expect([...d.colourIdx]).toEqual([0, 0, 32, 63, 63]);
		expect(s.colourKey.ticks.map((t) => t.label)).toEqual(['≤ 10', '15', '≥ 20']);
		// The automatic range is still known (the panel's placeholder).
		expect(d.colourAutoDomain).toMatchObject({ lo: 0, hi: 30 });
		// Only one end set: the other stays the data's.
		d.colourEncoding.domainMax = null;
		flushSync();
		expect(d.colourDomain).toMatchObject({ lo: 10, hi: 30 });
	});

	it('zooming does not recolour (the range is the data range, not the axis)', () => {
		const { d, s } = mkPlot([0, 1, 2, 3], [1, 2, 3, 4], [0, 1, 2, 3]);
		const before = [...d.colourIdx];
		s.xlimsIN = [1, 2];
		flushSync();
		expect([...d.colourIdx]).toEqual(before);
	});
});

describe('monochrome', () => {
	it('draws a sequential map in greys and a cyclic one in cyclic greys; the saved map is kept', () => {
		const { wrapper, d } = mkPlot([0, 1, 2], [1, 1, 1], [0, 5, 10]);
		d.colourEncoding.colormap = 'magma';
		wrapper.style = { monochrome: true };
		flushSync();
		expect(d.colourMap).toBe('greys');
		const fills = drawnPaths(draw(wrapper)).map((p) => p.fill.match(/\d+/g).map(Number));
		for (const [r, g, b] of fills) expect(r === g && g === b).toBe(true);
		expect(JSON.parse(JSON.stringify(d)).colourEncoding.colormap).toBe('magma');

		cleanup();
		const t = Date.UTC(2026, 0, 1);
		const h = mkPlot([0], [1], [t], { ctype: 'time' });
		h.wrapper.style = { monochrome: true };
		flushSync();
		expect(h.d.colourMap).toBe('greysCyclic');
		// (The test wrapper is a plain object, so a fresh plot stands in for switching back.)
		cleanup();
		const h2 = mkPlot([0], [1], [t], { ctype: 'time' });
		expect(h2.d.colourMap).toBe('twilight_shifted');
	});
});

describe('the colour bar and the legend never overlap', () => {
	const overlap = (a, b) =>
		a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

	/** The key as drawn, backdrop included (ColourScale pads a key over the data). */
	function barRect(s) {
		const at = s.encodingKeys.placement;
		const g = s.encodingKeys.geometry(at.length);
		const pad = s.encodingKeys.inset;
		return { x: at.x - pad, y: at.y - pad, width: g.width + 2 * pad, height: g.height + 2 * pad };
	}
	function legendRect(s) {
		const p = s.encodingKeys.legendPlaced;
		return {
			x: p.outside ? p.x : (s.legendLayout.auto?.x ?? p.x),
			y: p.y,
			width: p.width,
			height: p.height
		};
	}
	function twoSeries() {
		const n = 60;
		const xs = Array.from({ length: n }, (_, i) => i);
		const { s, wrapper } = mkPlot(
			xs,
			xs.map((i) => Math.sin(i / 5) * 10),
			xs.map((i) => i)
		);
		s.addData({
			x: { refId: s.data[0].x.refId },
			y: {
				refId: mkCol(
					xs.map((i) => i / 6),
					'number',
					'second'
				)
			}
		});
		return { s, wrapper };
	}

	it('beside the plot, under an outside legend; the wider sets the room', () => {
		const { s } = twoSeries();
		s.legend.position = 'outsideright';
		s.colourScale.position = 'right';
		flushSync();
		const legend = s.encodingKeys.legendPlaced;
		expect(legend.outside).toBe(true);
		const bar = barRect(s);
		expect(bar.y).toBeGreaterThanOrEqual(legend.y + legend.height);
		expect(overlap(bar, legendRect(s))).toBe(false);
		const room = s.basePlotWidth - s.plotwidth;
		expect(room).toBeGreaterThanOrEqual(Math.max(legend.width, bar.width));
		// Both inside the figure's right edge.
		expect(bar.x + bar.width).toBeLessThanOrEqual(s.basePlotWidth + s.padding.right + 1);
	});

	it('beside the plot with the legend inside: the bar takes room, the legend stays clear of it', () => {
		const { s } = twoSeries();
		s.legend.position = 'topright';
		s.colourScale.position = 'right';
		flushSync();
		expect(s.plotwidth).toBeLessThan(s.basePlotWidth);
		expect(barRect(s).x).toBeGreaterThanOrEqual(s.plotwidth);
	});

	it('the same inside corner as a fixed legend: the bar moves under it', () => {
		const { s } = twoSeries();
		s.legend.position = 'topright';
		s.colourScale.position = 'topright';
		flushSync();
		expect(overlap(barRect(s), legendRect(s))).toBe(false);
		s.legend.position = 'bottomleft';
		s.colourScale.position = 'bottomleft';
		flushSync();
		expect(overlap(barRect(s), legendRect(s))).toBe(false);
	});

	it('an auto legend avoids an inside bar', () => {
		// Data only along the bottom, so top right is clear for the legend except for the bar.
		const n = 40;
		const xs = Array.from({ length: n }, (_, i) => i);
		const { s } = mkPlot(
			xs,
			xs.map(() => 0),
			xs
		);
		s.ylimsLeftIN = [0, 100];
		s.addData({
			x: { refId: s.data[0].x.refId },
			y: {
				refId: mkCol(
					xs.map(() => 1),
					'number',
					'b'
				)
			}
		});
		s.colourScale.position = 'topright';
		s.legend.position = 'auto';
		flushSync();
		expect(s.legendLayout.auto.outside).toBe(false);
		expect(s.legendLayout.auto.name).not.toBe('topright');
		expect(overlap(barRect(s), legendRect(s))).toBe(false);
	});
});

describe('save and load', () => {
	it('round-trips the column, the settings and the colour bar', () => {
		const { s, d } = mkPlot([0, 1, 2], [1, 2, 3], [3, 4, 5]);
		d.colourEncoding.mode = 'daysSinceStart';
		d.colourEncoding.colormap = 'magma';
		d.colourEncoding.domainMin = 1;
		s.colourScale.position = 'topleft';
		const json = JSON.parse(JSON.stringify(s));
		const back = Scatterplotclass.fromJSON(s.parentBox, json);
		const bd = back.data[0];
		expect(bd.colourBy.refId).toBe(d.colourBy.refId);
		expect(bd.colourEncoding.toJSON()).toEqual(d.colourEncoding.toJSON());
		expect(back.colourScale.position).toBe('topleft');
		expect(JSON.parse(JSON.stringify(back))).toEqual(json);
	});

	it('a saved file from before colour by loads with it off; a broken encoding falls back', () => {
		const { s } = mkPlot([0, 1], [1, 2], null);
		const json = JSON.parse(JSON.stringify(s));
		const back = Scatterplotclass.fromJSON(s.parentBox, json);
		expect(back.data[0].colourBy).toBeNull();
		expect(back.data[0].colourEncoding).toBeNull();
		json.data[0].colourBy = { refId: 99999 };
		json.data[0].colourEncoding = { id: 'x', mode: 'nonsense', colormap: 'nope', domainMin: 'a' };
		const odd = Scatterplotclass.fromJSON(s.parentBox, json).data[0];
		expect(odd.colourEncoding.toJSON()).toEqual({
			id: 1,
			mode: 'auto',
			colormap: 'auto',
			domainMin: null,
			domainMax: null,
			colourLine: false
		});
		// Wired to a column that does not exist: on, but nothing coloured.
		expect(odd.colourActive).toBe(false);
	});

	it('pasted series with the same encoding id get distinct ids (distinct ports)', () => {
		const { s } = mkPlot([0, 1], [1, 2], [1, 2]);
		const json = JSON.parse(JSON.stringify(s));
		json.data.push(JSON.parse(JSON.stringify(json.data[0])));
		const back = Scatterplotclass.fromJSON(s.parentBox, json);
		const ids = back.data.map((d) => d.colourEncoding.id);
		expect(new Set(ids).size).toBe(2);
	});
});

describe('the canvas: port, edge, wiring', () => {
	function sessionPlot() {
		const x = mkCol([0, 1, 2], 'number', 'x');
		const y = mkCol([1, 2, 3], 'number', 'y');
		const c = mkCol([5, 6, 7], 'number', 'temp');
		const plot = new Plot({
			type: 'scatterplot',
			name: 'sc',
			plot: { data: [{ x: { refId: x }, y: { refId: y } }] }
		});
		core.plots.push(plot);
		const live = core.plots[core.plots.length - 1];
		return { plot: live, x, y, c };
	}
	const nodeOf = (plot) =>
		getCachedProcessNodeGraph(core, appConsts).nodes.find((n) => n.id === `plot_${plot.id}`);

	it('a colour port appears in the series block when Colour by is on, with an edge once wired', () => {
		const { plot, c } = sessionPlot();
		expect(nodeOf(plot).ports.inputs.some((p) => p.name.startsWith('enc'))).toBe(false);
		plot.plot.data[0].enableColourBy();
		clearProcessNodeGraphCache();
		let node = nodeOf(plot);
		const port = node.ports.inputs.find((p) => p.name === 'enc1_colour');
		expect(port).toBeTruthy();
		expect(port.display).toBe('colour');
		expect(describeNodePort(node, port, 'in')).toMatch(/colours this series/);
		// Laid out under the series' y, not after the overlays.
		const slots = plotNodeSlots(node.ports.inputs, node.ports.outputs);
		const rows = slots.inputRows.filter((r) => r.kind === 'port').map((r) => r.port.name);
		expect(rows.indexOf('enc1_colour')).toBe(rows.indexOf('ys1') + 1);
		// Wire it through the canvas path.
		expect(applyEncodingWire(plot.plot, 'enc1_colour', c)).toBe(true);
		clearProcessNodeGraphCache();
		const graph = getCachedProcessNodeGraph(core, appConsts);
		node = graph.nodes.find((n) => n.id === `plot_${plot.id}`);
		expect(
			graph.connections.some(
				(e) => e.toId === node.id && e.toPort === 'enc1_colour' && e.fromId === `data_${c}`
			)
		).toBe(true);
		// No passthrough output for the colour column.
		expect(node.ports.outputs.some((p) => p.name === `col_${c}`)).toBe(false);
		expect(encodingPortSelection(plot.plot, 'enc1_colour')).toEqual({ many: false, ids: [c] });
	});

	it('clear, remove, reroute, and a foreign port', () => {
		const { plot, c, y } = sessionPlot();
		const d = plot.plot.data[0];
		d.enableColourBy();
		applyEncodingWire(plot.plot, 'enc1_colour', c);
		expect(removeEncodingWire(plot.plot, 'enc1_colour', y)).toBe(true);
		expect(d.colourBy.refId).toBe(c);
		expect(rerouteEncodingWire(plot.plot, 'enc1_colour', y, c)).toBe(false);
		expect(rerouteEncodingWire(plot.plot, 'enc1_colour', c, y)).toBe(true);
		expect(d.colourBy.refId).toBe(y);
		expect(clearEncodingPort(plot.plot, 'enc1_colour')).toBe(true);
		expect(d.colourBy.refId).toBe(-1);
		expect(d.colourEncoding).not.toBeNull();
		expect(applyEncodingWire(plot.plot, 'enc9_colour', c)).toBe(false);
		expect(applyEncodingWire(plot.plot, 'ys1', c)).toBe(false);
	});

	it('deleting the colour column unwires it and keeps the series', () => {
		const { plot, c } = sessionPlot();
		const d = plot.plot.data[0];
		d.enableColourBy();
		d.colourBy.refId = c;
		removeColumn(c);
		expect(plot.plot.data.length).toBe(1);
		expect(plot.plot.data[0].colourBy.refId).toBe(-1);
	});
});

describe('facets share one colour range', () => {
	it('every panel uses the generator setting and the range over all panels', async () => {
		const xs = [0, 1, 2];
		const x = mkCol(xs, 'number', 'x');
		const ya = mkCol([1, 2, 3], 'number', 'a');
		const yb = mkCol([3, 2, 1], 'number', 'b');
		const ca = mkCol([0, 1, 2], 'number', 'ca');
		const cb = mkCol([10, 20, 30], 'number', 'cb');
		const plot = new Plot({
			type: 'scatterplot',
			name: 'f',
			plot: {
				data: [
					{ x: { refId: x }, y: { refId: ya } },
					{ x: { refId: x }, y: { refId: yb } }
				]
			}
		});
		core.plots.push(plot);
		const gen = core.plots[0];
		gen.plot.data[0].enableColourBy();
		gen.plot.data[0].colourBy.refId = ca;
		gen.plot.data[1].enableColourBy();
		gen.plot.data[1].colourBy.refId = cb;
		gen.facet = true;
		const panels = panelsFor(gen);
		expect(panels.length).toBe(2);
		for (const p of panels) projectPanel(p);
		const doms = panels.map((p) => p.plot.data[0].colourDomain);
		for (const dom of doms) expect(dom).toMatchObject({ lo: 0, hi: 30 });
		// Panel a's values 0..2 sit at the low end of the shared scale.
		expect([...panels[0].plot.data[0].colourIdx]).toEqual([0, 2, 4]);
		// The generator's setting reaches the panel.
		gen.plot.data[0].colourEncoding.colormap = 'magma';
		projectPanel(panels[0]);
		expect(panels[0].plot.data[0].colourMap).toBe('magma');
	});
});

describe('a large series', () => {
	it('200k points render as at most 65 paths, and the render time is measured', () => {
		const n = 200_000;
		const xs = new Array(n);
		const ys = new Array(n);
		const cs = new Array(n);
		for (let i = 0; i < n; i++) {
			xs[i] = i;
			ys[i] = Math.sin(i / 1000);
			cs[i] = i % 997 === 0 ? null : (i * 7919) % 1000;
		}
		const plain = mkPlot(xs, ys, null);
		plain.d.points.shape = 'circle';
		let t = performance.now();
		const c0 = draw(plain.wrapper);
		const plainMs = performance.now() - t;
		expect(c0.querySelectorAll('path[data-colour-bucket]').length).toBe(0);
		cleanup();

		const coloured = mkPlot(xs, ys, cs);
		coloured.d.points.shape = 'circle';
		t = performance.now();
		const c1 = draw(coloured.wrapper);
		const colouredMs = performance.now() - t;
		const paths = c1.querySelectorAll('path[data-colour-bucket]');
		expect(paths.length).toBe(K + 1);
		expect(paths[0].getAttribute('data-colour-bucket')).toBe('none');
		// Measured at about 0.3 s for both in happy-dom (phase 1b report): colouring costs no
		// more than the single path. Bounded loosely so a regression to one DOM node per point
		// (seconds) fails without making the test timing-flaky.
		expect(colouredMs).toBeLessThan(Math.max(5000, plainMs * 6));
	}, 60000);
});

describe('the AI editor and the multi-select panel', () => {
	it('offer a coloured series’ settings as restyle paths, with their choices', async () => {
		const { plotProps } = await import('$lib/utils/aiEdit.js');
		const x = mkCol([0, 1, 2], 'number', 'x');
		const y = mkCol([1, 2, 3], 'number', 'y');
		const c = mkCol([5, 6, 7], 'number', 'temp');
		core.plots.push(
			new Plot({
				type: 'scatterplot',
				name: 'sc',
				plot: { data: [{ x: { refId: x }, y: { refId: y } }] }
			})
		);
		const plot = core.plots[0];
		plot.plot.data[0].enableColourBy();
		plot.plot.data[0].colourBy.refId = c;
		const props = Object.fromEntries(plotProps(plot).map((p) => [p.path, p]));
		expect(props['plot.data[0].colourEncoding.mode']).toMatchObject({
			value: 'auto',
			options: ['auto', 'value', 'hourOfDay', 'dayOfYear', 'daysSinceStart', 'category']
		});
		expect(props['plot.data[0].colourEncoding.colormap'].options).toContain('twilight_shifted');
		expect(props['plot.data[0].colourEncoding.domainMin']).toMatchObject({
			input: 'number',
			value: null
		});
		// The id names the canvas port; it is wiring, not a style.
		expect(props['plot.data[0].colourEncoding.id']).toBeUndefined();
		// Wiring is not restyle-able either.
		expect(Object.keys(props).some((k) => k.includes('colourBy'))).toBe(false);
	});
});

describe('copy and paste', () => {
	it('a pasted coloured plot lands unwired (as x and y do) and keeps its colour bar settings', async () => {
		const { clearPlotInputs } = await import('$lib/core/nodeClipboard.js');
		const x = mkCol([0, 1, 2], 'number', 'x');
		const y = mkCol([1, 2, 3], 'number', 'y');
		const c = mkCol([5, 6, 7], 'number', 'temp');
		core.plots.push(
			new Plot({
				type: 'scatterplot',
				name: 'sc',
				plot: { data: [{ x: { refId: x }, y: { refId: y } }] }
			})
		);
		const plot = core.plots[0];
		plot.plot.data[0].enableColourBy();
		plot.plot.data[0].colourBy.refId = c;
		plot.plot.colourScale.position = 'bottomleft';
		const envelope = clearPlotInputs(JSON.parse(JSON.stringify(plot)));
		delete envelope.id;
		const pasted = Plot.fromJSON(envelope);
		expect(pasted.plot.data).toEqual([]);
		expect(pasted.plot.colourScale.position).toBe('bottomleft');
		expect(pasted.plot.colourKey).toBeNull();
		// The original is untouched.
		expect(plot.plot.data[0].colourBy.refId).toBe(c);
	});
});

// ---- Phase 1c: coloured lines (plan 3.6; rules in components/plotbits/colouredLine.js) ----
describe('coloured lines', () => {
	/** A plot with series 0's line drawn (points too unless `points: false`), coloured by cs. */
	function linePlot(xs, ys, cs, { colourLine = true, points = true, ctype = 'number' } = {}) {
		const p = mkPlot(xs, ys, cs, { ctype });
		p.d.line.draw = true;
		p.d.line.strokeWidth = 2;
		p.d.points.draw = points;
		if (cs) p.d.colourEncoding.colourLine = colourLine;
		flushSync();
		return p;
	}
	/** Each coloured line path: { key, stroke, segs: [[rowStart, rowEnd], ...] }. */
	function linePaths(container, s, xs) {
		const px = xs.map((x) => s.XScale(x));
		const row = (v) => {
			let best = 0;
			for (let i = 1; i < px.length; i++)
				if (Math.abs(px[i] - v) < Math.abs(px[best] - v)) best = i;
			return best;
		};
		return [...container.querySelectorAll('path[data-line-colour-bucket]')].map((p) => ({
			el: p,
			key: p.getAttribute('data-line-colour-bucket'),
			stroke: p.getAttribute('stroke'),
			segs: [...p.getAttribute('d').matchAll(/M([-\d.e]+) [-\d.e]+L([-\d.e]+) [-\d.e]+/g)].map(
				(m) => [row(Number(m[1])), row(Number(m[2]))]
			)
		}));
	}
	const allSegs = (paths) =>
		paths.flatMap((p) => p.segs.map((sg) => [...sg, p.key])).sort((a, b) => a[0] - b[0]);

	it('off by default: the line keeps the series colour as one plain path', () => {
		const xs = [0, 1, 2, 3];
		const { wrapper, d } = linePlot(xs, [1, 2, 3, 4], [0, 1, 2, 3], { colourLine: false });
		expect(d.colourEncoding.colourLine).toBe(false);
		expect(d.colourLineRender).toBeNull();
		const c = draw(wrapper);
		expect(c.querySelectorAll('path[data-line-colour-bucket]').length).toBe(0);
		const plain = [...c.querySelectorAll('path')].filter(
			(p) => p.getAttribute('fill') === 'none' && p.getAttribute('stroke') === d.line.colour
		);
		expect(plain.length).toBe(1);
		// The points are still coloured.
		expect(c.querySelectorAll('path[data-colour-bucket]').length).toBeGreaterThan(1);
	});

	it('each segment takes its starting row’s colour, grouped one path per bucket', () => {
		// Range [0, 64]: row i is in bucket i * 8 (the last clamps to 63).
		const cs = [0, 8, 16, 24, 32, 40, 48, 56, 64];
		const xs = cs.map((_, i) => i);
		const { wrapper, s, d } = linePlot(
			xs,
			xs.map((i) => i % 3),
			cs
		);
		const paths = linePaths(draw(wrapper), s, xs);
		expect(paths.length).toBe(8); // 8 segments, 8 distinct starting buckets
		for (const p of paths) {
			expect(p.segs.length).toBe(1);
			const [start] = p.segs[0];
			expect(p.key).toBe(`b${d.colourIdx[start]}`);
			expect(p.stroke).toBe(VIRIDIS[d.colourIdx[start]]);
		}
		// Bucket order (decision 9).
		expect(paths.map((p) => p.key)).toEqual(['b0', 'b8', 'b16', 'b24', 'b32', 'b40', 'b48', 'b56']);
	});

	it('the midnight segment is drawn in the colour of the hour it starts at', () => {
		const H = 3600000;
		const t0 = Date.UTC(2026, 0, 10);
		const times = [22.5, 23.5, 24.5, 25.5].map((h) => t0 + h * H);
		const xs = [0, 1, 2, 3];
		const { wrapper, s } = linePlot(xs, [0, 1, 0, 1], times, { ctype: 'time' });
		const tw = bucketColours('twilight_shifted');
		const segs = allSegs(linePaths(draw(wrapper), s, xs));
		expect(segs).toEqual([
			[0, 1, 'b60'],
			[1, 2, 'b62'], // 23:30 -> 00:30: 23:30's colour
			[2, 3, 'b1']
		]);
		const stroke = [...document.querySelectorAll('path[data-line-colour-bucket="b62"]')][0];
		expect(stroke.getAttribute('stroke')).toBe(tw[62]);
	});

	it('gaps break the coloured line exactly where the plain line breaks', () => {
		const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8];
		const ys = [1, 2, 3, 4, 5, null, 7, 8, NaN]; // a gap at row 5, a trailing gap
		const cs = xs.map((i) => i);
		const { wrapper, s, d } = linePlot(xs, ys, cs);
		let segs = allSegs(linePaths(draw(wrapper), s, xs)).map(([a, b]) => `${a}-${b}`);
		expect(segs).toEqual(['0-1', '1-2', '2-3', '3-4', '6-7']);
		cleanup();
		// The plain line on the same data has the same break (two subpaths, none touching 5).
		d.colourEncoding.colourLine = false;
		flushSync();
		const plain = [...draw(wrapper).querySelectorAll('path')].find(
			(p) => p.getAttribute('fill') === 'none' && p.getAttribute('stroke') === d.line.colour
		);
		expect(plain.getAttribute('d').match(/M/g).length).toBe(2);
		cleanup();
		// Join gaps: bridged 4 -> 6 in row 4's colour.
		d.colourEncoding.colourLine = true;
		d.line.joinGaps = true;
		flushSync();
		segs = allSegs(linePaths(draw(wrapper), s, xs));
		expect(segs.map(([a, b]) => `${a}-${b}`)).toEqual(['0-1', '1-2', '2-3', '3-4', '4-6', '6-7']);
		expect(segs.find(([a]) => a === 4)[2]).toBe(`b${d.colourIdx[4]}`);
	});

	it('a missing x breaks it too', () => {
		const xs = [0, 1, null, 3, 4];
		const { wrapper, s } = linePlot(xs, [1, 2, 3, 4, 5], [0, 1, 2, 3, 4]);
		const segs = allSegs(linePaths(draw(wrapper), s, [0, 1, 2, 3, 4]));
		expect(segs.map(([a, b]) => `${a}-${b}`)).toEqual(['0-1', '3-4']);
	});

	it('segments starting at a row with no colour value are in the line colour, and the bar says so', () => {
		const xs = [0, 1, 2, 3, 4, 5];
		// Row 1 null, rows 4 and 5 past the end of the colour column.
		const { wrapper, s, d } = linePlot(xs, [1, 2, 3, 4, 5, 6], [0, null, 10, 20], {
			points: false
		});
		expect(d.colourLineNoValueCount).toBe(2); // 1-2 and 4-5 (3-4 starts at row 3: valued)
		const c = draw(wrapper);
		const paths = linePaths(c, s, xs);
		expect(paths[0].key).toBe('none');
		expect(paths[0].stroke).toBe(d.line.colour);
		expect(paths[0].segs).toEqual([
			[1, 2],
			[4, 5]
		]);
		// Points hidden: the key still shows (for the line), with its "no value" entry.
		expect(c.querySelector('.colour-scale')).not.toBeNull();
		expect(c.querySelector('.colour-scale-novalue')?.textContent).toContain('no value');
	});

	it('is solid with round caps and joins even when the series line is dashed', () => {
		const xs = [0, 1, 2];
		const { wrapper, d, s } = linePlot(xs, [0, 1, 0], [0, 1, 2]);
		d.line.stroke = '5, 5';
		d.line.strokeWidth = 12;
		flushSync();
		const paths = linePaths(draw(wrapper), s, xs);
		expect(paths.length).toBe(2);
		for (const p of paths) {
			expect(p.el.getAttribute('stroke-linecap')).toBe('round');
			expect(p.el.getAttribute('stroke-linejoin')).toBe('round');
			expect(p.el.getAttribute('stroke-width')).toBe('12');
			expect(p.el.getAttribute('style') ?? '').not.toContain('dasharray');
			expect(p.el.getAttribute('stroke-dasharray')).toBeNull();
		}
		// The dash is kept for when colouring is off.
		expect(d.line.stroke).toBe('5, 5');
		// The legend swatch: grey and solid, like a coloured point's swatch.
		const item = d.getLegendItem();
		const lineEl = item.elements.find((e) => e.type === 'line');
		expect(lineEl).toMatchObject({ color: 'rgb(140, 140, 140)', stroke: 'solid' });
		d.colourEncoding.colourLine = false;
		flushSync();
		expect(d.getLegendItem().elements.find((e) => e.type === 'line')).toMatchObject({
			color: d.line.colour,
			stroke: '5, 5'
		});
	});

	it('switching Colour by on with points hidden colours the line (the only mark)', () => {
		const { d } = mkPlot([0, 1], [1, 2], null);
		d.line.draw = true;
		d.points.draw = false;
		d.enableColourBy();
		expect(d.colourEncoding.colourLine).toBe(true);
		d.disableColourBy();
		d.points.draw = true;
		d.enableColourBy();
		expect(d.colourEncoding.colourLine).toBe(false);
	});

	it('the line tooltip names the colour value of the nearest row', () => {
		const H = 3600000;
		const t0 = Date.UTC(2026, 0, 10);
		const xs = [0, 1];
		const { wrapper, s } = linePlot(xs, [1, 2], [t0 + 14.5 * H, t0 + 15 * H], {
			ctype: 'time',
			points: false
		});
		const c = draw(wrapper);
		const path = c.querySelector('path[data-line-colour-bucket]');
		let detail = null;
		c.addEventListener('tooltip', (e) => (detail = e.detail));
		const ev = new MouseEvent('mousemove', { bubbles: true });
		Object.defineProperty(ev, 'offsetX', { value: s.XScale(0) + s.padding.left });
		Object.defineProperty(ev, 'offsetY', { value: s.YScaleLeft(1) + s.padding.top });
		path.dispatchEvent(ev);
		expect(detail?.content).toContain('Hour of day (UTC):</span> 14:30');
	});

	it('save and load keep the setting; a file from phase 1b loads with it off', () => {
		const { s } = linePlot([0, 1, 2], [1, 2, 3], [3, 4, 5]);
		const json = JSON.parse(JSON.stringify(s));
		expect(json.data[0].colourEncoding.colourLine).toBe(true);
		const back = Scatterplotclass.fromJSON(s.parentBox, json);
		expect(back.data[0].colourEncoding.colourLine).toBe(true);
		expect(back.data[0].colourLineActive).toBe(true);
		expect(JSON.parse(JSON.stringify(back))).toEqual(json);
		delete json.data[0].colourEncoding.colourLine;
		expect(Scatterplotclass.fromJSON(s.parentBox, json).data[0].colourEncoding.colourLine).toBe(
			false
		);
	});

	it('monochrome draws the line in greys too', () => {
		const xs = [0, 1, 2, 3];
		const { wrapper, s } = linePlot(xs, [0, 1, 0, 1], [0, 5, 10, 15]);
		wrapper.style = { monochrome: true };
		flushSync();
		const strokes = linePaths(draw(wrapper), s, xs).map((p) => p.stroke.match(/\d+/g).map(Number));
		expect(strokes.length).toBe(3);
		for (const [r, g, b] of strokes) expect(r === g && g === b).toBe(true);
	});

	it('facet panels inherit the setting from the generator', () => {
		const x = mkCol([0, 1, 2], 'number', 'x');
		const ya = mkCol([1, 2, 3], 'number', 'a');
		const yb = mkCol([3, 2, 1], 'number', 'b');
		const c = mkCol([0, 1, 2], 'number', 'c');
		core.plots.push(
			new Plot({
				type: 'scatterplot',
				name: 'f',
				plot: {
					data: [
						{ x: { refId: x }, y: { refId: ya }, line: { draw: true } },
						{ x: { refId: x }, y: { refId: yb }, line: { draw: true } }
					]
				}
			})
		);
		const gen = core.plots[0];
		for (const d of gen.plot.data) {
			d.enableColourBy();
			d.colourBy.refId = c;
			d.colourEncoding.colourLine = true;
		}
		gen.facet = true;
		const panels = panelsFor(gen);
		for (const p of panels) projectPanel(p);
		for (const p of panels) expect(p.plot.data[0].colourLineActive).toBe(true);
		gen.plot.data[0].colourEncoding.colourLine = false;
		projectPanel(panels[0]);
		expect(panels[0].plot.data[0].colourLineActive).toBe(false);
	});

	it('the AI editor and the multi-select panel offer "colour the line too"', async () => {
		const { plotProps } = await import('$lib/utils/aiEdit.js');
		const x = mkCol([0, 1, 2], 'number', 'x');
		const y = mkCol([1, 2, 3], 'number', 'y');
		const c = mkCol([5, 6, 7], 'number', 'temp');
		core.plots.push(
			new Plot({
				type: 'scatterplot',
				name: 'sc',
				plot: { data: [{ x: { refId: x }, y: { refId: y } }] }
			})
		);
		const plot = core.plots[0];
		plot.plot.data[0].enableColourBy();
		plot.plot.data[0].colourBy.refId = c;
		const props = Object.fromEntries(plotProps(plot).map((p) => [p.path, p]));
		expect(props['plot.data[0].colourEncoding.colourLine']).toMatchObject({
			input: 'boolean',
			value: false
		});
	});

	it('200k rows: at most 65 line paths, and the render time is measured', () => {
		const n = 200_000;
		const xs = new Array(n);
		const ys = new Array(n);
		const cs = new Array(n);
		for (let i = 0; i < n; i++) {
			xs[i] = i;
			ys[i] = i % 5003 === 0 ? null : Math.sin(i / 1000);
			cs[i] = i % 997 === 0 ? null : (i * 7919) % 1000;
		}
		const plain = linePlot(xs, ys, null, { points: false });
		let t = performance.now();
		draw(plain.wrapper);
		const plainMs = performance.now() - t;
		cleanup();
		const coloured = linePlot(xs, ys, cs, { points: false });
		t = performance.now();
		const c1 = draw(coloured.wrapper);
		const colouredMs = performance.now() - t;
		const paths = c1.querySelectorAll('path[data-line-colour-bucket]');
		expect(paths.length).toBe(K + 1);
		expect(paths[0].getAttribute('data-line-colour-bucket')).toBe('none');
		const segments = [...paths].reduce((m, p) => m + p.getAttribute('d').match(/M/g).length, 0);
		// n - 1 joins, less two per gap row (rows 0, 5003, ... 195117: 40 rows; row 0 costs one).
		expect(segments).toBe(n - 1 - (2 * 40 - 1));
		// PERF_LOG=1 prints the timings (the test setup swallows console output).
		if (process.env.PERF_LOG)
			process.stderr.write(
				`coloured line, 200k rows: plain ${plainMs.toFixed(0)} ms, coloured ${colouredMs.toFixed(0)} ms\n`
			);
		expect(colouredMs).toBeLessThan(Math.max(5000, plainMs * 6));
	}, 60000);
});
