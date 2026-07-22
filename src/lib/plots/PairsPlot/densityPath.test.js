import { describe, it, expect } from 'vitest';
import { densityPath } from './PairsPlot.svelte';

// The diagonal cells of a pairs plot are histograms; the density curve is a smoothed reading of
// the SAME distribution, so the contract that matters is that it shares the histogram's geometry
// (same x range, same baseline, peak at the same height as the tallest bar).
const CELL = 100;
const PAD = 10;
const INNER = CELL - 2 * PAD;
const range = (min, max) => ({ min, max });

/** Parse "M x,y L x,y ..." back into points so the geometry can be asserted. */
function points(d) {
	return d
		.replace(/^M/, '')
		.split('L')
		.map((p) => p.split(',').map(Number))
		.map(([x, y]) => ({ x, y }));
}

const normalish = Array.from({ length: 200 }, (_, i) => Math.sin(i * 12.9898) * 43758.5453) // deterministic
	.map((v) => v - Math.floor(v))
	.map((u, i, arr) => (i % 2 ? u : (u + arr[(i + 1) % arr.length]) / 2)); // mild smoothing → unimodal-ish

describe('densityPath', () => {
	it('draws a curve for a normal-ish sample', () => {
		const d = densityPath(normalish, range(0, 1), PAD, CELL);
		expect(d).toBeTruthy();
		expect(d.startsWith('M')).toBe(true);
		expect(points(d).length).toBeGreaterThan(10);
	});

	it('stays inside the cell, so it cannot bleed into neighbouring panels', () => {
		const pts = points(densityPath(normalish, range(0, 1), PAD, CELL));
		for (const { x, y } of pts) {
			expect(x).toBeGreaterThanOrEqual(PAD - 0.01);
			expect(x).toBeLessThanOrEqual(CELL - PAD + 0.01);
			expect(y).toBeGreaterThanOrEqual(PAD - 0.01);
			expect(y).toBeLessThanOrEqual(CELL - PAD + 0.01);
		}
	});

	it('peaks at full inner height, matching the tallest histogram bar', () => {
		const pts = points(densityPath(normalish, range(0, 1), PAD, CELL));
		const top = Math.min(...pts.map((p) => p.y)); // smallest y = tallest point
		expect(top).toBeCloseTo(CELL - PAD - INNER, 1); // i.e. exactly the bar-height ceiling
	});

	it('rises above the baseline (y decreases) somewhere', () => {
		const pts = points(densityPath(normalish, range(0, 1), PAD, CELL));
		expect(Math.min(...pts.map((p) => p.y))).toBeLessThan(CELL - PAD);
	});

	it('puts the peak near the data, not at a fixed position', () => {
		// Two samples differing only in location must produce peaks in different places.
		const low = normalish.map((v) => v * 0.2);
		const high = normalish.map((v) => 0.8 + v * 0.2);
		const peakX = (vals) => {
			const pts = points(densityPath(vals, range(0, 1), PAD, CELL));
			return pts.reduce((best, p) => (p.y < best.y ? p : best), pts[0]).x;
		};
		expect(peakX(low)).toBeLessThan(peakX(high));
	});

	it('returns null rather than a degenerate path when there is nothing to estimate', () => {
		expect(densityPath([], range(0, 1), PAD, CELL)).toBeNull();
		expect(densityPath([1, 2], range(0, 1), PAD, CELL)).toBeNull(); // < 3 points
		expect(densityPath([5, 5, 5, 5], range(5, 5), PAD, CELL)).toBeNull(); // zero spread
		expect(densityPath(null, range(0, 1), PAD, CELL)).toBeNull();
	});

	it('ignores non-finite values instead of skewing the estimate', () => {
		const dirty = [...normalish, NaN, Infinity, null, undefined];
		expect(densityPath(dirty, range(0, 1), PAD, CELL)).toBe(
			densityPath(normalish, range(0, 1), PAD, CELL)
		);
	});
});
