import { describe, it, expect } from 'vitest';
import { COLORMAPS, colormapRGB, normaliseTo01, DEFAULT_COLORMAP } from './colormaps.js';

const rgb = (s) => s.match(/\d+/g).map(Number);

describe('colormapRGB', () => {
	it('t=0 returns the first stop, t=1 the last stop', () => {
		for (const name of Object.keys(COLORMAPS)) {
			const stops = COLORMAPS[name];
			expect(rgb(colormapRGB(name, 0))).toEqual(stops[0]);
			expect(rgb(colormapRGB(name, 1))).toEqual(stops[stops.length - 1]);
		}
	});

	it('clamps out-of-range t to the endpoints', () => {
		const stops = COLORMAPS.viridis;
		expect(rgb(colormapRGB('viridis', -5))).toEqual(stops[0]);
		expect(rgb(colormapRGB('viridis', 5))).toEqual(stops[stops.length - 1]);
	});

	it('non-finite t maps to the low end', () => {
		expect(rgb(colormapRGB('viridis', NaN))).toEqual(COLORMAPS.viridis[0]);
		expect(rgb(colormapRGB('viridis', undefined))).toEqual(COLORMAPS.viridis[0]);
	});

	it('interpolates between stops (midpoint of first segment)', () => {
		// 9 stops → 8 segments; t = 1/16 is the midpoint of segment 0.
		const [a, b] = [COLORMAPS.viridis[0], COLORMAPS.viridis[1]];
		const mid = rgb(colormapRGB('viridis', 1 / 16));
		expect(mid).toEqual([
			Math.round((a[0] + b[0]) / 2),
			Math.round((a[1] + b[1]) / 2),
			Math.round((a[2] + b[2]) / 2)
		]);
	});

	it('unknown colormap falls back to the default', () => {
		expect(colormapRGB('does-not-exist', 0)).toBe(colormapRGB(DEFAULT_COLORMAP, 0));
	});

	it('always yields a valid rgb() string', () => {
		expect(colormapRGB('magma', 0.42)).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
	});
});

describe('normaliseTo01', () => {
	it('maps value across the domain to [0,1]', () => {
		expect(normaliseTo01(0, 0, 10)).toBe(0);
		expect(normaliseTo01(5, 0, 10)).toBe(0.5);
		expect(normaliseTo01(10, 0, 10)).toBe(1);
	});

	it('clamps values outside the domain', () => {
		expect(normaliseTo01(-3, 0, 10)).toBe(0);
		expect(normaliseTo01(20, 0, 10)).toBe(1);
	});

	it('degenerate or non-finite domain returns 0', () => {
		expect(normaliseTo01(5, 7, 7)).toBe(0); // min === max
		expect(normaliseTo01(5, 10, 0)).toBe(0); // max < min
		expect(normaliseTo01(NaN, 0, 10)).toBe(0);
		expect(normaliseTo01(5, NaN, 10)).toBe(0);
	});
});
