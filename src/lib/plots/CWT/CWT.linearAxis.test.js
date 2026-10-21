// The scalogram image on a LINEAR period axis.
//
// REPORTED (v82.53 export work; reproduced 2026-10-21 in headless Chromium on
// demo-cwt-period-change with "Log period axis" off): the image's rows stayed evenly spaced
// (they are log2-spaced scales) while the ticks, the cone, the ridge and the overlays moved to
// the linear axis, so the 24 h power sat around 26 h on its own axis.
//
// The image is now resampled onto the axis it is drawn against: on a linear axis each image
// row sits at the period of its centre and blends the two scales whose periods bracket it,
// by its distance from each in log period (the log axis's own picture, moved), so every
// scale's colour is exactly at its own period. On a log axis the image is unchanged (one row
// per scale, the longest at the top).
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
	scalogramImageRows,
	renderScalogramURI,
	periodToY,
	SCALOGRAM_LINEAR_ROWS
} from './CWT.svelte';

// Periods as cwt.js builds them: s0 * 2^(j dj), here 4 h to 32 h at dj = 0.125 (25 scales).
const PERIODS = Array.from({ length: 25 }, (_, j) => 4 * 2 ** (j * 0.125));

describe('scalogramImageRows', () => {
	it('log axis: one image row per scale, the longest period at the top (unchanged)', () => {
		const { j0, j1, w } = scalogramImageRows(PERIODS, true);
		const want = PERIODS.map((_, r) => PERIODS.length - 1 - r);
		expect(Array.from(j0)).toEqual(want);
		expect(Array.from(j1)).toEqual(want);
		expect(Array.from(w).every((v) => v === 0)).toBe(true);
	});

	it('linear axis: each row blends the two scales bracketing its period, in log period', () => {
		const { j0, j1, w } = scalogramImageRows(PERIODS, false);
		const R = j0.length;
		expect(R).toBe(Math.max(PERIODS.length, SCALOGRAM_LINEAR_ROWS));
		const lo = PERIODS[0];
		const hi = PERIODS.at(-1);
		const n = PERIODS.length;
		for (let r = 0; r < R; r++) {
			// The period at the centre of row r (row 0 at the top, the longest period).
			const p = lo + (1 - (r + 0.5) / R) * (hi - lo);
			expect(j1[r], `row ${r}`).toBe(j0[r] + 1);
			expect(PERIODS[j0[r]]).toBeLessThanOrEqual(p);
			expect(PERIODS[j1[r]]).toBeGreaterThanOrEqual(p);
			// The scales are geometric, so the blend is the fractional scale index of p.
			const f = (Math.log(p / lo) / Math.log(hi / lo)) * (n - 1);
			expect(j0[r] + w[r], `row ${r}`).toBeCloseTo(f, 9);
		}
	});

	it('linear axis: each scale is at full weight where the axis puts its period', () => {
		const { j0, j1, w } = scalogramImageRows(PERIODS, false);
		const R = j0.length;
		const H = 300;
		// The weight a row gives scale j.
		const weightOf = (r, j) => (j0[r] === j ? 1 - w[r] : 0) + (j1[r] === j ? w[r] : 0);
		for (let j = 1; j < PERIODS.length - 1; j++) {
			const y = periodToY(PERIODS[j], PERIODS, H, false);
			const r = Math.min(R - 1, Math.floor((y / H) * R));
			expect(weightOf(r, j), `scale ${j}`).toBeGreaterThan(0.9);
			// and none at its neighbours' periods
			for (const k of [j - 1, j + 1]) {
				const yk = periodToY(PERIODS[k], PERIODS, H, false);
				const rk = Math.min(R - 1, Math.floor((yk / H) * R));
				expect(weightOf(rk, j), `scale ${j} at ${k}`).toBeLessThan(0.1);
			}
		}
	});

	it('a single scale is one row', () => {
		expect(Array.from(scalogramImageRows([24], false).j0)).toEqual([0]);
	});
});

/** A fake 2-D canvas that keeps what was painted. */
function stubCanvas() {
	const painted = {};
	const real = document.createElement.bind(document);
	vi.spyOn(document, 'createElement').mockImplementation((tag) => {
		if (tag !== 'canvas') return real(tag);
		const canvas = {
			width: 0,
			height: 0,
			getContext: () => ({
				createImageData: (w, h) => ({
					width: w,
					height: h,
					data: new Uint8ClampedArray(w * h * 4)
				}),
				putImageData: (img) => (painted.img = img)
			}),
			toDataURL: () => 'data:image/png;base64,stub'
		};
		painted.canvas = canvas;
		return canvas;
	});
	return painted;
}
afterEach(() => vi.restoreAllMocks());

describe('renderScalogramURI on a linear axis', () => {
	// Power only in the scale nearest 24 h, none anywhere else.
	const j24 = PERIODS.reduce(
		(b, p, j) => (Math.abs(p - 24) < Math.abs(PERIODS[b] - 24) ? j : b),
		0
	);
	const power = PERIODS.map((_, j) => [j === j24 ? 1 : 0, j === j24 ? 1 : 0]);

	/** The green channel down the first column (viridis: 0 power is dark, 1 is bright). */
	const greens = (img) =>
		Array.from({ length: img.height }, (_, r) => img.data[r * img.width * 4 + 1]);

	it('paints the 24 h scale where the linear axis puts 24 h, fading to its neighbours', () => {
		const painted = stubCanvas();
		const uri = renderScalogramURI(power, 'viridis', 1, scalogramImageRows(PERIODS, false));
		expect(uri).toMatch(/^data:image\/png/);
		const img = painted.img;
		expect(img.height).toBe(scalogramImageRows(PERIODS, false).j0.length);
		const g = greens(img);
		const H = 300;
		const rowOf = (period) =>
			Math.min(img.height - 1, Math.floor((periodToY(period, PERIODS, H, false) / H) * img.height));
		// Brightest at 24 h's place on the axis (to within a row) ...
		const peak = g.indexOf(Math.max(...g));
		expect(Math.abs(peak - rowOf(PERIODS[j24]))).toBeLessThanOrEqual(1);
		// ... and dark from its neighbours' periods outward.
		const dark = g[0];
		const above = rowOf(PERIODS[j24 + 1]);
		const below = rowOf(PERIODS[j24 - 1]);
		for (let r = 0; r < img.height; r++) {
			if (r <= above - 1 || r >= below + 1) expect(g[r], `row ${r}`).toBe(dark);
			if (r > above + 1 && r < below - 1) expect(g[r], `row ${r}`).toBeGreaterThan(dark);
		}
	});

	it('a log axis paints one row per scale, as before', () => {
		const painted = stubCanvas();
		renderScalogramURI(power, 'viridis', 1, scalogramImageRows(PERIODS, true));
		expect(painted.img.height).toBe(PERIODS.length);
		const lit = (img) => greens(img).flatMap((v, r) => (v > greens(img)[0] ? [r] : []));
		expect(lit(painted.img)).toEqual([PERIODS.length - 1 - j24]);
		// And with no row map at all (the old call) the same.
		const again = stubCanvas();
		renderScalogramURI(power, 'viridis', 1);
		expect(lit(again.img)).toEqual([PERIODS.length - 1 - j24]);
	});
});
