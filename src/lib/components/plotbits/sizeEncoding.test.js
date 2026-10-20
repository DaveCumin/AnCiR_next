// Size by: the area-proportional scale, its drawing layers, the modes it offers, the size
// key's entries and the marker path grouping (colour-by plan 2026-10-20, sections 3.7 and 6,
// "Size scale"; phase 3). Pure functions: encodings.js, encodingHost.js, markerPaths.js.
import { describe, it, expect } from 'vitest';
import { quadtree } from 'd3-quadtree';
import {
	SIZE_BUCKETS,
	DEFAULT_MIN_RADIUS,
	DEFAULT_MAX_RADIUS,
	MIN_RADIUS_FLOOR,
	sizeRadius,
	sizeRange,
	sizeLayer,
	sizeRadii,
	sizeModesFor,
	encodingDomain,
	encodingValues
} from './encodings.js';
import {
	effectiveSizeMode,
	sizeKeyItems,
	encodingPortName,
	parseEncodingPort,
	nextEncodingId,
	resolveEncodingPort,
	placeKey
} from './encodingHost.js';
import { markerPaths, findMarkerHit } from './markerPaths.js';

const markerCount = (d) => (d.match(/M/g) ?? []).length;

describe('the area-proportional scale', () => {
	it('both ends land on the smallest and largest radius', () => {
		expect(sizeRadius(0, 2, 10)).toBe(2);
		expect(sizeRadius(1, 2, 10)).toBe(10);
	});

	it('the middle of the range is the AREA midpoint, not the radius midpoint', () => {
		const r = sizeRadius(0.5, 2, 10);
		expect(r * r).toBeCloseTo((2 * 2 + 10 * 10) / 2, 12);
		expect(r).not.toBeCloseTo(6, 3);
		// Area is linear in t: equal steps of t add equal area.
		const a = (t) => sizeRadius(t, 2, 10) ** 2;
		expect(a(0.75) - a(0.5)).toBeCloseTo(a(0.5) - a(0.25), 10);
	});

	it('positions outside [0, 1] clamp; no position is no radius', () => {
		expect(sizeRadius(-3, 2, 10)).toBe(2);
		expect(sizeRadius(7, 2, 10)).toBe(10);
		expect(sizeRadius(NaN, 2, 10)).toBeNaN();
	});

	it('the range is floored at 1 px and defaults to 2 to 10 px', () => {
		expect(sizeRange(null, null)).toEqual({ rMin: DEFAULT_MIN_RADIUS, rMax: DEFAULT_MAX_RADIUS });
		expect(sizeRange(0.2, -4)).toEqual({ rMin: MIN_RADIUS_FLOOR, rMax: MIN_RADIUS_FLOOR });
		expect(sizeRange('3', 'x')).toEqual({ rMin: 3, rMax: DEFAULT_MAX_RADIUS });
		expect(DEFAULT_MIN_RADIUS).toBe(2);
		expect(DEFAULT_MAX_RADIUS).toBe(10);
	});

	it('a manual value range clamps values beyond it to the end sizes', () => {
		const dom = encodingDomain([[0, 5, 10, 20]], { domainIN: [5, 10] });
		const { r } = sizeRadii([0, 5, 7.5, 10, 20], dom, { rMin: 2, rMax: 10, fallback: 4 });
		expect([...r].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([
			2,
			2,
			Math.round(Math.sqrt((4 + 100) / 2) * 1e9) / 1e9,
			10,
			10
		]);
	});

	it('a value with no size keeps the series size; a missing value is not dropped', () => {
		const dom = encodingDomain([[0, 10]]);
		const values = encodingValues('value', [0, null, 'abc', 10, NaN]).values;
		const { r, layer, noValueLayer } = sizeRadii(values, dom, {
			rMin: 2,
			rMax: 10,
			fallback: 4
		});
		expect([...r]).toEqual([2, 4, 4, 10, 4]);
		expect(layer[1]).toBe(noValueLayer);
		expect(noValueLayer).toBe(sizeLayer(4, 2, 10));
	});

	it('a reversed size range (largest first) reverses the scale and keeps the layers by size', () => {
		const dom = encodingDomain([[0, 10]]);
		const { r, layer } = sizeRadii([0, 10], dom, { rMin: 10, rMax: 2, fallback: 4 });
		expect([...r]).toEqual([10, 2]);
		expect(layer[0]).toBe(SIZE_BUCKETS - 1);
		expect(layer[1]).toBe(0);
	});
});

describe('drawing layers (8), both sides of each gate', () => {
	it('a radius lands in the layer of its AREA position', () => {
		// Area positions just over the gates k / 8, and just under them (a radius squared back
		// is exact to about 1e-15, so the gate itself is a float coin toss either way).
		for (let k = 1; k < SIZE_BUCKETS; k++) {
			const at = (t) => Math.sqrt(4 + t * (100 - 4));
			expect(sizeLayer(at(k / SIZE_BUCKETS + 1e-9), 2, 10), `gate ${k}`).toBe(k);
			expect(sizeLayer(at(k / SIZE_BUCKETS - 1e-9), 2, 10), `under ${k}`).toBe(k - 1);
		}
		expect(sizeLayer(10, 2, 10)).toBe(SIZE_BUCKETS - 1);
		expect(sizeLayer(1, 2, 10)).toBe(0);
		expect(sizeLayer(50, 2, 10)).toBe(SIZE_BUCKETS - 1);
	});
});

describe('modes and ports', () => {
	it('hour of day is never offered for size (a cycle has no "bigger")', () => {
		for (const col of [{ type: 'time' }, { type: 'number' }, { type: 'bin', originTime_ms: 0 }]) {
			expect(sizeModesFor(col).map((m) => m.mode)).not.toContain('hourOfDay');
		}
		expect(effectiveSizeMode('hourOfDay', { type: 'time' })).toBe('daysSinceStart');
		expect(effectiveSizeMode('auto', { type: 'number' })).toBe('value');
		expect(effectiveSizeMode('dayOfYear', { type: 'time' })).toBe('dayOfYear');
	});

	it('ports round-trip enc<id>_size, and a series pairs its colour and size ids', () => {
		expect(encodingPortName(4, 'size')).toBe('enc4_size');
		expect(parseEncodingPort('enc4_size')).toEqual({ id: 4, channel: 'size' });
		const a = { colourEncoding: { id: 3 }, colourBy: { refId: 1 }, sizeEncoding: null };
		const b = { colourEncoding: null, sizeEncoding: { id: 3 }, sizeBy: { refId: 2 } };
		const inner = { data: [a, b] };
		// a's colour id 3 is taken on the size channel by b, so a gets the next free one.
		expect(nextEncodingId(inner, 'size', a)).toBe(4);
		// With b gone, a's size id pairs with its colour id.
		expect(nextEncodingId({ data: [a] }, 'size', a)).toBe(3);
		expect(resolveEncodingPort(inner, 'enc3_size').datum).toBe(b);
		expect(resolveEncodingPort(inner, 'enc3_colour').datum).toBe(a);
		expect(resolveEncodingPort(inner, 'enc3_size').column).toBe(b.sizeBy);
	});
});

describe('the size key', () => {
	it('three reference circles at the ends and the middle, drawn at the scale’s own radii', () => {
		const items = sizeKeyItems({ lo: 0, hi: 100 }, 'value', { rMin: 2, rMax: 10 });
		expect(items.map((i) => i.label)).toEqual(['0', '50', '100']);
		expect(items.map((i) => i.r)).toEqual([2, sizeRadius(0.5, 2, 10), 10]);
	});

	it('marks manual ends, and a one-value range has one entry', () => {
		const items = sizeKeyItems({ lo: 1, hi: 3 }, 'value', {
			rMin: 2,
			rMax: 8,
			manualLo: true,
			manualHi: true
		});
		expect(items.map((i) => i.label)).toEqual(['≤ 1', '2', '≥ 3']);
		expect(sizeKeyItems({ lo: 5, hi: 5 }, 'value', { rMin: 2, rMax: 8 })).toHaveLength(1);
		expect(sizeKeyItems({ lo: NaN, hi: NaN }, 'value', { rMin: 2, rMax: 8 })).toEqual([]);
	});
});

describe('marker paths sized and coloured', () => {
	const r = Float64Array.from([2, 10, 6, 2]);
	const layer = Int8Array.from([0, 7, 3, 0]);

	it('every marker at its exact radius, largest layer drawn first', () => {
		const out = markerPaths([10, 20, 30, 40], [5, 5, 5, 5], {
			shape: 'square',
			radius: 4,
			colour: 'red',
			sizeBy: { r, layer, S: 8 }
		});
		expect(out.map((p) => p.key)).toEqual(['s7', 's3', 's0']);
		expect(out.map((p) => p.layer)).toEqual([7, 3, 0]);
		// Squares: M(cx - r) (cy - r) h(2r): the radius read back exactly.
		const radii = out.flatMap((p) =>
			[...p.d.matchAll(/M([-\d.e]+) [-\d.e]+h([-\d.e]+)/g)].map((m) => Number(m[2]) / 2)
		);
		expect(radii).toEqual([10, 6, 2, 2]);
		expect(out.every((p) => p.fill === 'red')).toBe(true);
	});

	it('size x colour groups: within a layer, "no value" first, then buckets in order', () => {
		const out = markerPaths([1, 2, 3, 4], [1, 1, 1, 1], {
			radius: 4,
			colour: 'grey',
			colourBy: {
				idx: Int16Array.from([5, -1, 2, 1]),
				colours: ['c0', 'c1', 'c2', 'c3', 'c4', 'c5']
			},
			sizeBy: { r, layer, S: 8 }
		});
		expect(out.map((p) => [p.key, p.fill])).toEqual([
			['s7-none', 'grey'],
			['s3-b2', 'c2'],
			['s0-b1', 'c1'],
			['s0-b5', 'c5']
		]);
	});

	it('the path count is capped at 8 x 65, whatever the number of points', () => {
		const n = 8 * 65 * 3;
		const px = Array.from({ length: n }, (_, i) => i);
		const py = px.map(() => 0);
		const idx = Int16Array.from(px, (i) => (i % 65) - 1);
		const lay = Int8Array.from(px, (i) => Math.floor(i / 65) % 8);
		const out = markerPaths(px, py, {
			radius: 3,
			colour: 'k',
			colourBy: { idx, colours: Array.from({ length: 64 }, (_, b) => `c${b}`) },
			sizeBy: { r: Float64Array.from(px, () => 3), layer: lay, S: 8 }
		});
		expect(out.length).toBe(8 * 65);
		expect(out.reduce((s, p) => s + markerCount(p.d), 0)).toBe(n);
	});

	it('7, 8 and 9 distinct sizes give 7, 8 and 8 paths (the layer gate)', () => {
		for (const [distinct, paths] of [
			[7, 7],
			[8, 8],
			[9, 8]
		]) {
			const values = Array.from({ length: distinct }, (_, i) => i);
			const dom = encodingDomain([values]);
			const sb = sizeRadii(values, dom, { rMin: 1, rMax: 1 + distinct, fallback: 4 });
			// Spread the areas evenly so `distinct` values hit distinct layers where they can.
			const evenLayers = Int8Array.from(values, (v) =>
				Math.min(7, Math.floor((v / Math.max(1, distinct - 1)) * 8))
			);
			const out = markerPaths(values, values, {
				radius: 4,
				colour: 'k',
				sizeBy: { r: sb.r, layer: evenLayers, S: 8 }
			});
			expect(new Set(out.map((p) => p.key)).size, `${distinct} sizes`).toBe(paths);
		}
	});

	it('no encoding draws the one path exactly as before', () => {
		const out = markerPaths([1, 2], [3, 4], { shape: 'circle', radius: 4, colour: 'red' });
		expect(out).toHaveLength(1);
		expect(out[0].key).toBe('all');
	});
});

describe('hover with each point’s own radius', () => {
	const pts = [
		{ x: 0, y: 0, r: 10 },
		{ x: 12, y: 0, r: 2 }
	];
	const qt = quadtree()
		.x((d) => d.x)
		.y((d) => d.y)
		.addAll(pts);
	it('a small point on a large one stays reachable; a far cursor hits nothing', () => {
		expect(findMarkerHit(qt, 12, 0, (d) => d.r, 10)).toBe(pts[1]);
		expect(findMarkerHit(qt, 2, 0, (d) => d.r, 10)).toBe(pts[0]);
		// 19 px from the big centre: within twice its radius.
		expect(findMarkerHit(qt, -19, 0, (d) => d.r, 10)).toBe(pts[0]);
		expect(findMarkerHit(qt, -25, 0, (d) => d.r, 10)).toBeUndefined();
		// 5 px past the small point, beyond twice its radius, and 17 from the big one: the big.
		expect(findMarkerHit(qt, 17, 0, (d) => d.r, 10)).toBe(pts[0]);
	});
});

describe('placing a key after others (legend, colour bar, size key)', () => {
	const base = { plotW: 400, plotH: 300, margin: 10 };
	it('beside the plot: under every box already in the right margin', () => {
		const p = placeKey({
			...base,
			position: 'right',
			box: { width: 50, height: 60 },
			stack: [
				{ x: 410, y: 0, width: 80, height: 40, outside: true },
				{ x: 410, y: 50, width: 40, height: 100, outside: true },
				{ x: 0, y: 0, width: 80, height: 300, outside: false, corner: 'topright' }
			]
		});
		expect(p).toEqual({ x: 410, y: 160, maxLength: 140 });
	});
	it('in a corner: past every box in the same corner, either way up', () => {
		const top = placeKey({
			...base,
			position: 'topleft',
			box: { width: 50, height: 60 },
			stack: [
				{ x: 10, y: 10, width: 80, height: 40, outside: false, corner: 'topleft' },
				{ x: 10, y: 60, width: 80, height: 50, outside: false, corner: 'topleft' },
				{ x: 300, y: 10, width: 80, height: 200, outside: false, corner: 'topright' }
			]
		});
		expect(top.y).toBe(120);
		const bottom = placeKey({
			...base,
			position: 'bottomright',
			box: { width: 50, height: 60 },
			stack: [{ x: 300, y: 250, width: 80, height: 40, outside: false, corner: 'bottomright' }]
		});
		expect(bottom.y).toBe(250 - 60 - 10);
	});
});
