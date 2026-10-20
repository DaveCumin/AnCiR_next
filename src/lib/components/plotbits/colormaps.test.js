// The shared colormaps (components/plotbits/colormaps.js) against matplotlib.
//
// colormapStops.json is generated from matplotlib by tools/gen_colormap_stops.py, and
// tools/test_colormap_stops.py checks the file still equals matplotlib's live values, so
// these tests compare the app with matplotlib itself: stops exactly, interpolated bucket
// colours within 1/255 (colour-by plan 2026-10-20, sections 3.4 and 6).
import { describe, it, expect } from 'vitest';
import STOP_TABLES from './colormapStops.json';
import {
	COLORMAPS,
	COLORMAP_LABELS,
	COLORMAP_META,
	CYCLIC_COLORMAP_LABELS,
	colormapRGB,
	isCyclicColormap,
	monochromeColormap,
	colormapChoices
} from './colormaps.js';
import * as legacyPath from '$lib/plots/Actogram/colormaps.js';
import { bucketColours, COLOUR_BUCKETS } from './encodings.js';

const rgb = (s) => s.match(/\d+/g).map(Number);
const MATPLOTLIB_MAPS = ['viridis', 'magma', 'twilight_shifted'];

describe('matplotlib maps', () => {
	it('are the generated stop tables, 65 stops each', () => {
		for (const name of MATPLOTLIB_MAPS) {
			expect(COLORMAPS[name]).toEqual(STOP_TABLES.stops[name]);
			expect(COLORMAPS[name]).toHaveLength(65);
		}
		// The first viridis and magma stops are matplotlib's well-known ends.
		expect(COLORMAPS.viridis[0]).toEqual([68, 1, 84]);
		expect(COLORMAPS.viridis[64]).toEqual([253, 231, 37]);
		expect(COLORMAPS.magma[0]).toEqual([0, 0, 4]);
	});

	it('every bucket colour is within 1/255 of matplotlib at the bucket centre', () => {
		const ref = STOP_TABLES.reference.bucketCentres;
		expect(STOP_TABLES.reference.buckets).toBe(COLOUR_BUCKETS);
		for (const name of MATPLOTLIB_MAPS) {
			const app = bucketColours(name).map(rgb);
			expect(app).toHaveLength(64);
			for (let b = 0; b < 64; b++) {
				for (let k = 0; k < 3; k++) {
					expect(Math.abs(app[b][k] - ref[name][b][k]), `${name} bucket ${b}`).toBeLessThanOrEqual(
						1
					);
				}
			}
		}
	});
});

describe('cyclic maps', () => {
	it('twilight_shifted and greysCyclic close the loop: first stop = last stop', () => {
		for (const name of ['twilight_shifted', 'greysCyclic']) {
			const s = COLORMAPS[name];
			expect(s[0]).toEqual(s[s.length - 1]);
			expect(colormapRGB(name, 0)).toBe(colormapRGB(name, 1));
		}
	});

	it('twilight_shifted is dark at midnight and light at noon', () => {
		const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
		const s = COLORMAPS.twilight_shifted;
		expect(lum(s[0])).toBeLessThan(60);
		expect(lum(s[32])).toBeGreaterThan(200);
	});

	it('greysCyclic is grey with the luminance of twilight_shifted at every stop', () => {
		const lin = (v) => {
			const u = v / 255;
			return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
		};
		const Y = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
		COLORMAPS.greysCyclic.forEach((g, i) => {
			expect(g[0]).toBe(g[1]);
			expect(g[1]).toBe(g[2]);
			// Same luminance, to the rounding of one 8-bit grey step.
			const step = Math.abs(lin(Math.min(255, g[0] + 1)) - lin(g[0]));
			expect(Math.abs(Y(g) - Y(COLORMAPS.twilight_shifted[i]))).toBeLessThanOrEqual(step);
		});
	});

	it('metadata: which maps are cyclic, and what monochrome swaps each to', () => {
		expect(Object.keys(COLORMAP_META).sort()).toEqual(Object.keys(COLORMAPS).sort());
		expect(isCyclicColormap('twilight_shifted')).toBe(true);
		expect(isCyclicColormap('greysCyclic')).toBe(true);
		expect(isCyclicColormap('viridis')).toBe(false);
		expect(isCyclicColormap('nope')).toBe(false);
		expect(monochromeColormap('twilight_shifted')).toBe('greysCyclic');
		expect(monochromeColormap('viridis')).toBe('greys');
		expect(monochromeColormap('rdbu')).toBe('greys');
		for (const [name, meta] of Object.entries(COLORMAP_META)) {
			expect(meta.cyclic, name).toBe(meta.kind === 'cyclic');
			// A cyclic map's monochrome twin is cyclic too, so the wrap survives monochrome.
			expect(isCyclicColormap(meta.monochrome), name).toBe(meta.cyclic);
		}
	});

	it('the heatmap selects keep offering only the non-cyclic maps; cyclic maps are offered for cyclic data', () => {
		expect(Object.keys(COLORMAP_LABELS)).toEqual(['viridis', 'magma', 'greys', 'rdbu']);
		expect(Object.keys(colormapChoices())).toEqual(Object.keys(COLORMAP_LABELS));
		expect(Object.keys(colormapChoices({ cyclic: true }))).toEqual(
			Object.keys(CYCLIC_COLORMAP_LABELS)
		);
		for (const name of Object.keys(CYCLIC_COLORMAP_LABELS))
			expect(isCyclicColormap(name)).toBe(true);
		for (const name of Object.keys(COLORMAP_LABELS)) expect(isCyclicColormap(name)).toBe(false);
	});
});

// Colour-blind safety of the hour-of-day map is checked, not assumed (plan 3.14): simulate
// protanopia and deuteranopia with the severity-1.0 matrices of Machado, Oliveira and
// Fernandes (2009), "A physiologically-based model for simulation of color vision
// deficiency", IEEE TVCG 15(6), applied in linear RGB; then compare the 0 h, 6 h, 12 h and
// 18 h colours by CIE76 colour difference in CIELAB (D65).
describe('twilight_shifted under colour-vision deficiency', () => {
	const MACHADO = {
		protanopia: [
			[0.152286, 1.052583, -0.204868],
			[0.114503, 0.786281, 0.099216],
			[-0.003882, -0.048116, 1.051998]
		],
		deuteranopia: [
			[0.367322, 0.860646, -0.227968],
			[0.280085, 0.672501, 0.047413],
			[-0.01182, 0.04294, 0.968881]
		]
	};
	const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
	const enc = (y) => {
		const v = y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055;
		return Math.max(0, Math.min(1, v));
	};
	const simulate = (c, m) => {
		const l = c.map((v) => lin(v / 255));
		return m.map((r) => enc(r[0] * l[0] + r[1] * l[1] + r[2] * l[2]));
	};
	const lab = (c01) => {
		const l = c01.map(lin);
		const X = 0.4124 * l[0] + 0.3576 * l[1] + 0.1805 * l[2];
		const Y = 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
		const Z = 0.0193 * l[0] + 0.1192 * l[1] + 0.9505 * l[2];
		const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
		const [fx, fy, fz] = [f(X / 0.95047), f(Y), f(Z / 1.08883)];
		return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
	};
	const hourColour = (h) => rgb(colormapRGB('twilight_shifted', h / 24));

	for (const [kind, m] of Object.entries(MACHADO)) {
		it(`${kind}: 0 h, 6 h, 12 h and 18 h stay clearly apart (CIE76 above 20)`, () => {
			const hours = [0, 6, 12, 18];
			const labs = hours.map((h) => lab(simulate(hourColour(h), m)));
			for (let i = 0; i < 4; i++) {
				for (let j = i + 1; j < 4; j++) {
					const d = Math.hypot(...labs[i].map((v, k) => v - labs[j][k]));
					expect(d, `${hours[i]} h vs ${hours[j]} h`).toBeGreaterThan(20);
				}
			}
		});
	}
});

describe('the old import path', () => {
	it('re-exports the shared module', () => {
		expect(legacyPath.COLORMAPS).toBe(COLORMAPS);
		expect(legacyPath.colormapRGB).toBe(colormapRGB);
	});
});
