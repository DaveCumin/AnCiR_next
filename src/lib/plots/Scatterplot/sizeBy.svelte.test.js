// @ts-nocheck
/**
 * Size by on Scatterplot points (colour-by plan 2026-10-20, section 3.7; phase 3), on the REAL
 * plot class and the REAL Points renderer (no stubs: the "green-suite blindness" lesson of the
 * figure-style ADR).
 *
 * Pins: every point drawn at the exact radius of the area-proportional scale (both ends, the
 * area midpoint, a manual range clamping), points with no size value at the series' own size
 * (and named in the size key), size together with colour (grouped by size layer x colour
 * bucket, largest layer first), hour of day refused, the size key's content, the size key, the
 * colour bar and the legend never overlapping (every legend position, keys beside the plot and
 * in corners), the tooltip's size row, save/load, copy/paste, the canvas port and its edge,
 * column delete, facets sharing one size range, monochrome leaving sizes alone, the CSV column,
 * the AI editor's descriptors, and a 200k-point render.
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
import {
	bucketColours,
	sizeRadius,
	SIZE_BUCKETS,
	COLOUR_BUCKETS
} from '$lib/components/plotbits/encodings.js';
import { sizeKeyGeometry } from '$lib/components/plotbits/SizeKey.svelte';
import { minBarLength, TICK_LABEL_SPACE } from '$lib/components/plotbits/ColourScale.svelte';
import {
	applyEncodingWire,
	clearEncodingPort,
	encodingPortSelection
} from '$lib/components/workflow/encodingWiring.js';

const VIRIDIS = bucketColours('viridis');
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

/** A scatter (square markers: each marker one `M x y h2r`) with series 0 sized by `ss`. */
function mkPlot(xs, ys, ss, { stype = 'number', cs = null, width = 600, height = 400 } = {}) {
	const wrapper = { id: 9, type: 'scatterplot', name: 'p', width, height, plot: null, style: {} };
	const s = new Scatterplotclass(wrapper, null);
	s.padding = { top: 20, right: 30, bottom: 30, left: 50 };
	s.addData({ x: { refId: mkCol(xs, 'number', 'x') }, y: { refId: mkCol(ys, 'number', 'y') } });
	const d = s.data[0];
	d.points.shape = 'square';
	d.points.radius = 4;
	if (ss) {
		d.enableSizeBy();
		d.sizeBy.refId = mkCol(ss, stype, 'humidity');
	}
	if (cs) {
		d.enableColourBy();
		d.colourBy.refId = mkCol(cs, 'number', 'temp');
	}
	wrapper.plot = s;
	flushSync();
	return { wrapper, s, d };
}

/** Each drawn point path: { key, layer, fill, marks: [{ cx, cy, r }] } in DOM order. */
function drawnPaths(container) {
	return [...container.querySelectorAll('path[data-size-layer]')].map((p) => ({
		key: p.getAttribute('data-colour-bucket'),
		layer: Number(p.getAttribute('data-size-layer')),
		fill: p.getAttribute('fill'),
		marks: [...p.getAttribute('d').matchAll(/M([-\d.e]+) ([-\d.e]+)h([-\d.e]+)/g)].map((m) => {
			const r = Number(m[3]) / 2;
			return { cx: Number(m[1]) + r, cy: Number(m[2]) + r, r };
		})
	}));
}

function draw(wrapper) {
	return render(Scatterplot, { props: { theData: wrapper, which: 'plot' } }).container;
}

/** Each mark drawn, keyed by its x pixel (rows are at distinct x). */
function marksByX(container, s, xs) {
	const out = new Map();
	for (const p of drawnPaths(container)) for (const m of p.marks) out.set(Math.round(m.cx), m);
	return xs.map((x) => out.get(Math.round(s.XScale(x))));
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

describe('the scale on the real renderer', () => {
	it('every point at the exact radius: both ends, the area midpoint, in between', () => {
		const ss = [0, 25, 50, 75, 100];
		const xs = ss.map((_, i) => i);
		const { wrapper, s, d } = mkPlot(xs, xs, ss);
		d.sizeEncoding.minRadius = 2;
		d.sizeEncoding.maxRadius = 12;
		flushSync();
		const marks = marksByX(draw(wrapper), s, xs);
		const want = ss.map((v) => sizeRadius(v / 100, 2, 12));
		marks.forEach((m, i) => expect(m.r, `row ${i}`).toBeCloseTo(want[i], 9));
		expect(marks[0].r).toBeCloseTo(2, 12);
		expect(marks[4].r).toBeCloseTo(12, 12);
		expect(marks[2].r ** 2).toBeCloseTo((4 + 144) / 2, 9);
	});

	it('a manual range clamps the sizes beyond it; the key marks its ends', () => {
		const ss = [0, 10, 20, 30, 40];
		const xs = ss.map((_, i) => i);
		const { wrapper, s, d } = mkPlot(xs, xs, ss);
		d.sizeEncoding.domainMin = 10;
		d.sizeEncoding.domainMax = 30;
		flushSync();
		const marks = marksByX(draw(wrapper), s, xs);
		expect(marks.map((m) => Math.round(m.r * 1000) / 1000)).toEqual([
			2,
			2,
			Math.round(sizeRadius(0.5, 2, 10) * 1000) / 1000,
			10,
			10
		]);
		expect(s.sizeKey.items.map((i) => i.label)).toEqual(['≤ 10', '20', '≥ 30']);
		// The panel's placeholder is the data's own range.
		expect(d.sizeAutoDomain).toMatchObject({ lo: 0, hi: 40 });
	});

	it('drawn largest layer first, so small points sit on top of big ones', () => {
		const ss = [100, 0, 50, 0, 100];
		const xs = ss.map((_, i) => i);
		const { wrapper } = mkPlot(xs, xs, ss);
		const paths = drawnPaths(draw(wrapper));
		const layers = paths.map((p) => p.layer);
		expect(layers).toEqual([...layers].sort((a, b) => b - a));
		expect(layers[0]).toBe(SIZE_BUCKETS - 1);
		expect(layers[layers.length - 1]).toBe(0);
		expect(paths.reduce((n, p) => n + p.marks.length, 0)).toBe(ss.length);
	});

	it('Size by off draws the one series path, exactly as before', () => {
		const { wrapper, d } = mkPlot([0, 1], [0, 1], [1, 2]);
		const before = draw(wrapper).querySelectorAll('path[data-size-layer]').length;
		expect(before).toBeGreaterThan(0);
		cleanup();
		d.disableSizeBy();
		flushSync();
		const c = draw(wrapper);
		expect(c.querySelectorAll('path[data-size-layer]').length).toBe(0);
		expect(d.sizeBy).toBeNull();
		expect(d.toJSON().sizeEncoding).toBeUndefined();
	});
});

describe('missing size values', () => {
	it('are drawn at the series’ own size, counted, and named in the size key', () => {
		const ss = [0, null, 'n/a', 100];
		const xs = ss.map((_, i) => i);
		const { wrapper, s, d } = mkPlot(xs, xs, ss);
		d.points.radius = 5;
		flushSync();
		const marks = marksByX(draw(wrapper), s, xs);
		expect(marks.map((m) => m.r)).toEqual([2, 5, 5, 10]);
		expect(d.sizeNoValueCount).toBe(2);
		expect(s.sizeKey.noValue).toEqual({ r: 5, label: 'no value' });
	});

	it('no "no value" entry when every point has a size value', () => {
		const { s } = mkPlot([0, 1], [0, 1], [3, 4]);
		expect(s.sizeKey.noValue).toBeNull();
	});
});

describe('size together with colour', () => {
	it('grouped by (size layer, colour bucket): largest first, "no value" colour first in a layer', () => {
		const ss = [0, 0, 100, 100, 100];
		const cs = [0, 64, 0, null, 64];
		const xs = ss.map((_, i) => i);
		const { wrapper, s, d } = mkPlot(xs, xs, ss, { cs });
		const paths = drawnPaths(draw(wrapper));
		expect(paths.map((p) => p.key)).toEqual(['s7-none', 's7-b0', 's7-b63', 's0-b0', 's0-b63']);
		expect(paths.map((p) => p.fill)).toEqual([
			d.points.colour,
			VIRIDIS[0],
			VIRIDIS[COLOUR_BUCKETS - 1],
			VIRIDIS[0],
			VIRIDIS[COLOUR_BUCKETS - 1]
		]);
		const marks = marksByX(draw(wrapper), s, xs);
		expect(marks.map((m) => m.r)).toEqual([2, 2, 10, 10, 10]);
	});

	it('the colour bar and the size key both show, the size key under the bar', () => {
		const xs = [0, 1, 2, 3];
		const { s } = mkPlot(xs, xs, [1, 2, 3, 4], { cs: [4, 3, 2, 1] });
		expect(s.encodingKeys.drawProps).not.toBeNull();
		expect(s.encodingKeys.sizeDrawProps).not.toBeNull();
		expect(s.encodingKeys.sizePlacement.y).toBeGreaterThanOrEqual(
			s.encodingKeys.placement.y + s.encodingKeys.geometry(s.encodingKeys.placement.length).height
		);
	});
});

describe('modes', () => {
	it('a time column is sized by days since start (hour of day is refused)', () => {
		const times = [T0, T0 + 12 * H, T0 + 48 * H];
		const { d } = mkPlot([0, 1, 2], [0, 1, 2], times, { stype: 'time' });
		expect(d.sizeMode).toBe('daysSinceStart');
		// A stored Hour of day (a hand-written file, the AI editor) is not drawn: the column's
		// natural size mode is. The panel never offers it.
		d.sizeEncoding.mode = 'hourOfDay';
		flushSync();
		expect(d.sizeMode).toBe('daysSinceStart');
		expect(d.sizeMarkValues).toEqual([0, 0.5, 2]);
		expect(d.sizeTitle).toBe('Days since start');
	});
});

describe('the tooltip', () => {
	it('names the size value (and the colour value when both are on)', () => {
		const { wrapper } = mkPlot([0], [1], [72.5], { cs: [3] });
		const c = draw(wrapper);
		const path = c.querySelector('path[data-size-layer]');
		let detail = null;
		c.addEventListener('tooltip', (e) => (detail = e.detail));
		const m = drawnPaths(c)[0].marks[0];
		const ev = new MouseEvent('mousemove', { bubbles: true });
		Object.defineProperty(ev, 'offsetX', { value: m.cx + 50 });
		Object.defineProperty(ev, 'offsetY', { value: m.cy + 20 });
		path.dispatchEvent(ev);
		expect(detail?.content).toContain('humidity:</span> 72.5');
		expect(detail?.content).toContain('temp:</span> 3');
	});
});

describe('the keys never overlap', () => {
	const overlap = (a, b) =>
		a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

	/** The keys and the legend as drawn, backdrops included, in plot-area px. */
	function rects(s) {
		const k = s.encodingKeys;
		const out = {};
		if (k.placement) {
			const g = k.geometry(k.placement.length);
			const p = k.inset;
			out.bar = {
				x: k.placement.x - p,
				y: k.placement.y - p,
				width: g.width + 2 * p,
				height: g.height + 2 * p
			};
		}
		if (k.sizePlacement) {
			const g = k.sizeBase;
			const p = k.sizeInset;
			out.size = {
				x: k.sizePlacement.x - p,
				y: k.sizePlacement.y - p,
				width: g.width + 2 * p,
				height: g.height + 2 * p
			};
		}
		const lp = k.legendPlaced;
		if (lp && s.legend.show) {
			const pos = s.legend.position;
			const x = lp.outside
				? lp.x
				: pos === 'auto'
					? s.legendLayout.auto.x
					: pos.endsWith('left')
						? s.legendLayout.margin
						: s.plotwidth - lp.width - s.legendLayout.margin;
			out.legend = { x, y: lp.y, width: lp.width, height: lp.height };
		}
		return out;
	}

	function threeKeys() {
		const n = 50;
		const xs = Array.from({ length: n }, (_, i) => i);
		const { s } = mkPlot(
			xs,
			xs.map((i) => Math.cos(i / 4) * 5),
			xs.map((i) => (i % 9 === 0 ? null : i)),
			{ cs: xs.map((i) => (i % 7 === 0 ? null : 50 - i)) }
		);
		s.addData({
			x: { refId: s.data[0].x.refId },
			y: {
				refId: mkCol(
					xs.map((i) => i / 10),
					'number',
					'a second series with a long name'
				)
			}
		});
		s.legend.show = true;
		flushSync();
		return s;
	}

	const LEGENDS = ['topright', 'topleft', 'bottomright', 'bottomleft', 'outsideright', 'auto'];
	const KEYS = [
		['right', 'right'],
		['topright', 'topright'],
		['bottomleft', 'bottomleft'],
		['right', 'topleft'],
		['topleft', 'right'],
		['bottomright', 'bottomright']
	];
	for (const legend of LEGENDS) {
		for (const [bar, size] of KEYS) {
			it(`legend ${legend}, colour bar ${bar}, size key ${size}`, () => {
				const s = threeKeys();
				s.legend.position = legend;
				s.colourScale.position = bar;
				s.sizeScale.position = size;
				flushSync();
				const r = rects(s);
				expect(r.bar && r.size).toBeTruthy();
				const names = Object.keys(r);
				for (let i = 0; i < names.length; i++) {
					for (let j = i + 1; j < names.length; j++) {
						expect(
							overlap(r[names[i]], r[names[j]]),
							`${names[i]} vs ${names[j]}: ${JSON.stringify(r)}`
						).toBe(false);
					}
				}
				// Beside the plot, the keys are within the figure and the plot area gave them room.
				for (const name of ['bar', 'size']) {
					const box = r[name];
					expect(box.x + box.width).toBeLessThanOrEqual(s.basePlotWidth + s.padding.right + 1);
					if ((name === 'bar' ? bar : size) === 'right')
						expect(box.x).toBeGreaterThanOrEqual(s.plotwidth);
				}
			});
		}
	}

	it('the size key geometry is what the component draws', () => {
		const s = threeKeys();
		const k = s.sizeKey;
		const g = sizeKeyGeometry({
			items: k.items,
			noValue: k.noValue,
			title: k.title,
			fontSize: s.encodingKeys.sizeFontPx
		});
		expect(s.encodingKeys.sizeBase).toEqual(g);
		const c = draw(s.parentBox);
		const circles = [...c.querySelectorAll('g.size-key path')].map((p) =>
			Number(p.getAttribute('data-size-key-r'))
		);
		expect(circles).toEqual(g.rows.map((r) => r.r));
		expect(c.querySelector('g.size-key-novalue')).not.toBeNull();
	});
});

describe('small plots: the colour bar and the size key sharing a place (v82.45)', () => {
	// The hysteresis demo's keys on a small plot: an hour-of-day bar (five labels, a long
	// title) and a size key with a long, wrapped title, sharing a place. Stacked, the bar was
	// shortened to 20 px: its five labels sat on one another and its turned title ran past
	// both ends (over the legend and the size key). Now the bar is never made shorter than
	// minBarLength; when stacking would squeeze it under its title's length the size key goes
	// BESIDE it instead (sizeBeside); labels thin to fit; a title still too long is shortened.
	const overlap = (a, b) =>
		a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

	function hysteresis({ width, height, place, legend = null }) {
		const n = 48;
		const xs = Array.from({ length: n }, (_, i) => i);
		const { wrapper, s, d } = mkPlot(
			xs,
			xs.map((i) => Math.sin(i / 6)),
			xs.map((i) => 40 + i),
			{ width, height }
		);
		d.enableColourBy();
		d.colourBy.refId = mkCol(
			xs.map((i) => T0 + i * H),
			'time',
			'time'
		);
		core.data.find((c) => c.id === d.sizeBy.refId).customName = 'Binned: relative humidity (%)';
		s.legend.show = !!legend;
		if (legend) s.legend.position = legend;
		s.colourScale.position = place;
		s.sizeScale.position = place;
		flushSync();
		return { wrapper, s, d };
	}

	/** The bar and the size key as drawn, backdrops included, in plot-area px. */
	function boxes(s) {
		const k = s.encodingKeys;
		const g = k.geometry(k.placement.length);
		const sg = k.sizeBase;
		return {
			bar: {
				x: k.placement.x - k.inset,
				y: k.placement.y - k.inset,
				width: g.width + 2 * k.inset,
				height: g.height + 2 * k.inset
			},
			size: {
				x: k.sizePlacement.x - k.sizeInset,
				y: k.sizePlacement.y - k.sizeInset,
				width: sg.width + 2 * k.sizeInset,
				height: sg.height + 2 * k.sizeInset
			}
		};
	}

	/** The drawn tick labels' spans along the bar (1 em each), px from the bar's low end. */
	function tickSpans(container, length, fs) {
		return [...container.querySelectorAll('g.colour-scale text.colour-scale-tick')]
			.map((t) => {
				const y = Number(t.getAttribute('y'));
				const base = t.getAttribute('dominant-baseline');
				const top = base === 'hanging' ? y : base === 'central' ? y - fs / 2 : y - fs;
				return [length - top - fs, length - top];
			})
			.sort((a, b) => a[0] - b[0]);
	}

	const SIZES = [
		[600, 400],
		[520, 300],
		[460, 260],
		[400, 220],
		[360, 180]
	];
	const PLACES = ['right', 'topright', 'bottomleft'];
	const LEGENDS = [null, 'outsideright', 'topright'];
	for (const [width, height] of SIZES) {
		for (const place of PLACES) {
			for (const legend of LEGENDS) {
				it(`${width}x${height}, keys ${place}, legend ${legend ?? 'off'}`, () => {
					const { wrapper, s } = hysteresis({ width, height, place, legend });
					const k = s.encodingKeys;
					const fs = k.fontPx;
					const c = draw(wrapper);
					const length = k.placement.length;
					// The bar is never shorter than its two end labels need.
					expect(length).toBeGreaterThanOrEqual(minBarLength(fs) - 1e-9);
					// No two tick labels overlap; both ends are labelled.
					const spans = tickSpans(c, length, fs);
					for (let i = 1; i < spans.length; i++)
						expect(spans[i][0] - spans[i - 1][1]).toBeGreaterThanOrEqual(TICK_LABEL_SPACE);
					const texts = [...c.querySelectorAll('g.colour-scale text.colour-scale-tick')].map(
						(t) => t.textContent
					);
					expect(texts).toContain('0');
					expect(texts).toContain('24');
					// The turned title stays within the bar's length.
					const title = c.querySelector('g.colour-scale text.colour-scale-label');
					const shown = title.firstChild?.nodeValue ?? '';
					expect(shown.length * fs * 0.6).toBeLessThanOrEqual(length + 1e-9);
					// Without a legend in its way the title is never shortened because the size
					// key took the bar's room (the size key goes beside the bar instead): either
					// it is whole, or the bar is as long as it is with no size key at all.
					if (!legend && shown !== k.key.title) {
						s.sizeScale.show = false;
						flushSync();
						const alone = k.placement.length;
						s.sizeScale.show = true;
						flushSync();
						expect(length).toBeGreaterThanOrEqual(alone - 1e-9);
					}
					// The keys never overlap each other, and stay within the figure.
					const b = boxes(s);
					expect(overlap(b.bar, b.size), JSON.stringify(b)).toBe(false);
					for (const box of [b.bar, b.size]) {
						expect(box.x + box.width).toBeLessThanOrEqual(s.basePlotWidth + s.padding.right + 1);
						expect(box.x).toBeGreaterThanOrEqual(-1e-9);
						expect(box.y).toBeGreaterThanOrEqual(-1e-9);
						if (place === 'right') expect(box.x).toBeGreaterThanOrEqual(s.plotwidth);
					}
				});
			}
		}
	}

	it('stacked on a roomy plot, beside on a small one (both sides of the threshold)', () => {
		const roomy = hysteresis({ width: 600, height: 400, place: 'right' }).s;
		expect(roomy.encodingKeys.sizeBeside).toBe(false);
		const rb = boxes(roomy);
		expect(rb.size.y).toBeGreaterThanOrEqual(rb.bar.y + rb.bar.height);
		cleanup();
		const small = hysteresis({ width: 400, height: 220, place: 'right' }).s;
		expect(small.encodingKeys.sizeBeside).toBe(true);
		const sb = boxes(small);
		expect(sb.size.x).toBeGreaterThanOrEqual(sb.bar.x + sb.bar.width);
		expect(sb.size.y).toBeCloseTo(sb.bar.y, 9);
		// Beside the plot both keys' widths (and the margin between them) come off the plot.
		expect(small.basePlotWidth - small.plotwidth).toBeGreaterThanOrEqual(
			sb.bar.width + small.encodingKeys.margin + sb.size.width
		);
		// In a right corner the size key sits on the bar's left, level with its top.
		cleanup();
		const corner = hysteresis({ width: 400, height: 220, place: 'topright' }).s;
		expect(corner.encodingKeys.sizeBeside).toBe(true);
		const cb = boxes(corner);
		expect(cb.size.x + cb.size.width).toBeLessThanOrEqual(cb.bar.x);
		expect(cb.size.y).toBeCloseTo(cb.bar.y, 9);
	});

	it('a tall legend above the keys: the bar stops at its minimum, its ends still apart', () => {
		const { wrapper, s } = hysteresis({
			width: 380,
			height: 170,
			place: 'right',
			legend: 'outsideright'
		});
		for (let i = 0; i < 5; i++) {
			s.addData({
				x: { refId: s.data[0].x.refId },
				y: { refId: mkCol([1, 2, 3], 'number', `series ${i}`) }
			});
		}
		flushSync();
		const k = s.encodingKeys;
		const lp = k.legendPlaced;
		// The room left under the legend is less than the bar's minimum ...
		expect(s.plotheight - (lp.y + lp.height + k.margin)).toBeLessThan(k.minLength);
		// ... so the bar is the minimum (not squeezed under it), and its ends do not crowd.
		expect(k.placement.length).toBeCloseTo(minBarLength(k.fontPx), 9);
		const c = draw(wrapper);
		const texts = [...c.querySelectorAll('g.colour-scale text.colour-scale-tick')].map(
			(t) => t.textContent
		);
		expect(texts).toEqual(['24', '0']);
	});

	it('a stored bar length is kept: the keys stack as before', () => {
		const { s } = hysteresis({ width: 400, height: 220, place: 'right' });
		s.colourScale.barLength = 60;
		flushSync();
		expect(s.encodingKeys.sizeBeside).toBe(false);
		expect(s.encodingKeys.placement.length).toBe(60);
	});
});

describe('save and load', () => {
	it('round-trips the column, the settings and the size key', () => {
		const { s, d } = mkPlot([0, 1, 2], [1, 2, 3], [3, 4, 5]);
		d.sizeEncoding.minRadius = 3;
		d.sizeEncoding.maxRadius = 14;
		d.sizeEncoding.domainMax = 9;
		s.sizeScale.position = 'bottomleft';
		const json = JSON.parse(JSON.stringify(s));
		expect(json.sizeScale.position).toBe('bottomleft');
		expect(json.colourScale).toBeUndefined();
		const back = Scatterplotclass.fromJSON(s.parentBox, json);
		const bd = back.data[0];
		expect(bd.sizeBy.refId).toBe(d.sizeBy.refId);
		expect(bd.sizeEncoding.toJSON()).toEqual(d.sizeEncoding.toJSON());
		expect(back.sizeScale.position).toBe('bottomleft');
		expect(JSON.parse(JSON.stringify(back))).toEqual(json);
	});

	it('a file from before size by loads with it off; a broken encoding falls back', () => {
		const { s } = mkPlot([0, 1], [1, 2], null);
		const json = JSON.parse(JSON.stringify(s));
		expect(json.sizeScale).toBeUndefined();
		const back = Scatterplotclass.fromJSON(s.parentBox, json);
		expect(back.data[0].sizeBy).toBeNull();
		expect(back.data[0].sizeEncoding).toBeNull();
		json.data[0].sizeBy = { refId: 99999 };
		json.data[0].sizeEncoding = { id: -2, mode: 'hourOfDay', minRadius: 'x', maxRadius: 0.1 };
		const odd = Scatterplotclass.fromJSON(s.parentBox, json).data[0];
		expect(odd.sizeEncoding.toJSON()).toEqual({
			id: 1,
			mode: 'auto',
			minRadius: 2,
			maxRadius: 1,
			domainMin: null,
			domainMax: null
		});
		expect(odd.sizeActive).toBe(false);
	});

	it('a series’ colour and size ports share its id; pasted duplicates get distinct ids', () => {
		const { s, d } = mkPlot([0, 1], [1, 2], [1, 2], { cs: [1, 2] });
		expect(d.sizeEncoding.id).toBe(d.colourEncoding.id);
		const json = JSON.parse(JSON.stringify(s));
		json.data.push(JSON.parse(JSON.stringify(json.data[0])));
		const back = Scatterplotclass.fromJSON(s.parentBox, json);
		expect(new Set(back.data.map((x) => x.sizeEncoding.id)).size).toBe(2);
		expect(new Set(back.data.map((x) => x.colourEncoding.id)).size).toBe(2);
	});
});

describe('the canvas: port, edge, wiring', () => {
	function sessionPlot() {
		const x = mkCol([0, 1, 2], 'number', 'x');
		const y = mkCol([1, 2, 3], 'number', 'y');
		const c = mkCol([5, 6, 7], 'number', 'humidity');
		core.plots.push(
			new Plot({
				type: 'scatterplot',
				name: 'sc',
				plot: { data: [{ x: { refId: x }, y: { refId: y } }] }
			})
		);
		return { plot: core.plots[core.plots.length - 1], c };
	}
	const nodeOf = (plot) =>
		getCachedProcessNodeGraph(core, appConsts).nodes.find((n) => n.id === `plot_${plot.id}`);

	it('a size port appears under the colour port, with an edge once wired', () => {
		const { plot, c } = sessionPlot();
		const d = plot.plot.data[0];
		d.enableColourBy();
		d.enableSizeBy();
		clearProcessNodeGraphCache();
		let node = nodeOf(plot);
		const port = node.ports.inputs.find((p) => p.name === 'enc1_size');
		expect(port).toBeTruthy();
		expect(port.display).toBe('size');
		expect(describeNodePort(node, port, 'in')).toMatch(/sizes this series/);
		const rows = plotNodeSlots(node.ports.inputs, node.ports.outputs)
			.inputRows.filter((r) => r.kind === 'port')
			.map((r) => r.port.name);
		expect(rows.indexOf('enc1_colour')).toBe(rows.indexOf('ys1') + 1);
		expect(rows.indexOf('enc1_size')).toBe(rows.indexOf('ys1') + 2);
		expect(applyEncodingWire(plot.plot, 'enc1_size', c)).toBe(true);
		expect(d.sizeBy.refId).toBe(c);
		expect(d.colourBy.refId).toBe(-1);
		clearProcessNodeGraphCache();
		const graph = getCachedProcessNodeGraph(core, appConsts);
		node = graph.nodes.find((n) => n.id === `plot_${plot.id}`);
		expect(
			graph.connections.some(
				(e) => e.toId === node.id && e.toPort === 'enc1_size' && e.fromId === `data_${c}`
			)
		).toBe(true);
		expect(node.ports.outputs.some((p) => p.name === `col_${c}`)).toBe(false);
		expect(encodingPortSelection(plot.plot, 'enc1_size')).toEqual({ many: false, ids: [c] });
		expect(clearEncodingPort(plot.plot, 'enc1_size')).toBe(true);
		expect(d.sizeBy.refId).toBe(-1);
	});

	it('deleting the size column unwires it and keeps the series', () => {
		const { plot, c } = sessionPlot();
		const d = plot.plot.data[0];
		d.enableSizeBy();
		d.sizeBy.refId = c;
		removeColumn(c);
		expect(plot.plot.data.length).toBe(1);
		expect(plot.plot.data[0].sizeBy.refId).toBe(-1);
	});
});

describe('facets share one size range', () => {
	it('every panel uses the generator setting and the range over all panels', () => {
		const x = mkCol([0, 1, 2], 'number', 'x');
		const ya = mkCol([1, 2, 3], 'number', 'a');
		const yb = mkCol([3, 2, 1], 'number', 'b');
		const sa = mkCol([0, 1, 2], 'number', 'sa');
		const sb = mkCol([10, 20, 30], 'number', 'sb');
		core.plots.push(
			new Plot({
				type: 'scatterplot',
				name: 'f',
				plot: {
					data: [
						{ x: { refId: x }, y: { refId: ya } },
						{ x: { refId: x }, y: { refId: yb } }
					]
				}
			})
		);
		const gen = core.plots[0];
		gen.plot.data[0].enableSizeBy();
		gen.plot.data[0].sizeBy.refId = sa;
		gen.plot.data[1].enableSizeBy();
		gen.plot.data[1].sizeBy.refId = sb;
		gen.facet = true;
		const panels = panelsFor(gen);
		for (const p of panels) projectPanel(p);
		for (const p of panels) expect(p.plot.data[0].sizeDomain).toMatchObject({ lo: 0, hi: 30 });
		// Panel a's values 0..2 are small on the shared scale; panel b's 30 is the largest.
		expect(panels[0].plot.data[0].sizeRadii.r[2]).toBeCloseTo(sizeRadius(2 / 30, 2, 10), 12);
		expect(panels[1].plot.data[0].sizeRadii.r[2]).toBe(10);
		gen.plot.data[0].sizeEncoding.maxRadius = 20;
		projectPanel(panels[0]);
		expect(panels[0].plot.data[0].sizeRadiusRange.rMax).toBe(20);
	});
});

describe('monochrome leaves sizes alone', () => {
	it('the same radii with the figure monochrome', () => {
		const ss = [0, 5, 10];
		const { d, wrapper } = mkPlot([0, 1, 2], [0, 1, 2], ss, { cs: [0, 1, 2] });
		const before = [...d.sizeRadii.r];
		wrapper.style = { monochrome: true };
		flushSync();
		expect(d.colourMonochrome).toBe(true);
		expect([...d.sizeRadii.r]).toEqual(before);
	});
});

describe('downloads and the AI editor', () => {
	it('the CSV carries the size value of each point as s_<label>', () => {
		const { s } = mkPlot([0, 1, 2], [3, 4, 5], [7, null, 9]);
		const { headers, rows } = s.getDownloadData();
		const k = headers.findIndex((h) => h.startsWith('s_'));
		expect(k).toBeGreaterThan(-1);
		expect(rows.map((r) => r[k])).toEqual([7, '', 9]);
	});

	it('offer a sized series’ settings as restyle paths (no hour of day), not its wiring', async () => {
		const { plotProps } = await import('$lib/utils/aiEdit.js');
		const x = mkCol([0, 1, 2], 'number', 'x');
		const y = mkCol([1, 2, 3], 'number', 'y');
		const c = mkCol([5, 6, 7], 'number', 'humidity');
		core.plots.push(
			new Plot({
				type: 'scatterplot',
				name: 'sc',
				plot: { data: [{ x: { refId: x }, y: { refId: y } }] }
			})
		);
		const plot = core.plots[0];
		plot.plot.data[0].enableSizeBy();
		plot.plot.data[0].sizeBy.refId = c;
		const props = Object.fromEntries(plotProps(plot).map((p) => [p.path, p]));
		expect(props['plot.data[0].sizeEncoding.mode']).toMatchObject({
			value: 'auto',
			options: ['auto', 'value', 'dayOfYear', 'daysSinceStart']
		});
		expect(props['plot.data[0].sizeEncoding.maxRadius']).toMatchObject({
			input: 'number',
			value: 10
		});
		expect(props['plot.data[0].sizeEncoding.id']).toBeUndefined();
		expect(Object.keys(props).some((k) => k.includes('sizeBy'))).toBe(false);
	});

	it('copy and paste: a pasted sized plot lands unwired and keeps its size key settings', async () => {
		const { clearPlotInputs } = await import('$lib/core/nodeClipboard.js');
		const x = mkCol([0, 1, 2], 'number', 'x');
		const y = mkCol([1, 2, 3], 'number', 'y');
		const c = mkCol([5, 6, 7], 'number', 'humidity');
		core.plots.push(
			new Plot({
				type: 'scatterplot',
				name: 'sc',
				plot: { data: [{ x: { refId: x }, y: { refId: y } }] }
			})
		);
		const plot = core.plots[0];
		plot.plot.data[0].enableSizeBy();
		plot.plot.data[0].sizeBy.refId = c;
		plot.plot.sizeScale.position = 'topleft';
		const envelope = clearPlotInputs(JSON.parse(JSON.stringify(plot)));
		delete envelope.id;
		const pasted = Plot.fromJSON(envelope);
		expect(pasted.plot.sizeScale.position).toBe('topleft');
		expect(pasted.plot.sizeKey).toBeNull();
		expect(plot.plot.data[0].sizeBy.refId).toBe(c);
	});
});

describe('a large series', () => {
	it('200k points sized (and sized and coloured) render as at most 8 x 65 paths; timed', () => {
		const n = 200_000;
		const lcg = (seed) => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
		const lcgA = lcg(1);
		const lcgB = lcg(987654321);
		const xs = new Array(n);
		const ys = new Array(n);
		const ss = new Array(n);
		const cs = new Array(n);
		for (let i = 0; i < n; i++) {
			xs[i] = i;
			ys[i] = Math.sin(i / 1000);
			// Two independent sequences (an LCG each), so the (size, colour) pairs fill the groups.
			ss[i] = i % 1009 === 0 ? null : lcgA();
			cs[i] = i % 997 === 0 ? null : lcgB();
		}
		const time = (setup) => {
			cleanup();
			core.data = [];
			core.rawData = new Map();
			const p = setup();
			p.d.points.shape = 'circle';
			flushSync();
			const t = performance.now();
			const c = draw(p.wrapper);
			return { ms: performance.now() - t, c };
		};
		const plain = time(() => mkPlot(xs, ys, null));
		const sized = time(() => mkPlot(xs, ys, ss));
		const sizedPaths = sized.c.querySelectorAll('path[data-size-layer]').length;
		expect(sizedPaths).toBe(SIZE_BUCKETS);
		const both = time(() => mkPlot(xs, ys, ss, { cs }));
		const bothPaths = both.c.querySelectorAll('path[data-size-layer]').length;
		expect(bothPaths).toBeLessThanOrEqual(SIZE_BUCKETS * (COLOUR_BUCKETS + 1));
		expect(bothPaths).toBeGreaterThan(SIZE_BUCKETS * COLOUR_BUCKETS * 0.9);
		process.stdout.write(
			`[size by 200k] plain ${plain.ms.toFixed(0)} ms, sized ${sized.ms.toFixed(0)} ms (${sizedPaths} paths), sized+coloured ${both.ms.toFixed(0)} ms (${bothPaths} paths)\n`
		);
		// Loose bound: a regression to one DOM node per point (seconds) fails, timing noise not.
		expect(both.ms).toBeLessThan(Math.max(8000, plain.ms * 8));
	}, 120000);
});
