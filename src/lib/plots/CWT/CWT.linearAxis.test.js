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
// scale's colour is exactly at its own period.
//
// REPORTED (2026-10-22): on a LOG axis the image was still one row per scale, stretched over
// the axis, so the shortest and longest periods drew half a row inside the plot (row centre
// at (j + 0.5) / n of the height, tick at j / (n - 1)). The log axis is now resampled the
// same way, at the period of each row's centre on the log axis.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
	scalogramImageRows,
	renderScalogramURI,
	periodToY,
	SCALOGRAM_IMAGE_ROWS
} from './CWT.svelte';

// Periods as cwt.js builds them: s0 * 2^(j dj), here 4 h to 32 h at dj = 0.125 (25 scales).
const PERIODS = Array.from({ length: 25 }, (_, j) => 4 * 2 ** (j * 0.125));

describe('scalogramImageRows', () => {
	it('log axis: each row blends the two scales bracketing its period, in log period', () => {
		const { j0, j1, w } = scalogramImageRows(PERIODS, true);
		const R = j0.length;
		expect(R).toBe(Math.max(PERIODS.length, SCALOGRAM_IMAGE_ROWS));
		const n = PERIODS.length;
		for (let r = 0; r < R; r++) {
			// Row r's centre is (r + 0.5) / R down the axis; on a log axis of geometric scales
			// that is a fractional scale index linear in the row.
			const f = (1 - (r + 0.5) / R) * (n - 1);
			expect(j1[r], `row ${r}`).toBe(j0[r] + 1);
			expect(j0[r] + w[r], `row ${r}`).toBeCloseTo(f, 9);
		}
		// The top row shows (almost only) the longest period, the bottom row the shortest.
		expect(j1[0]).toBe(n - 1);
		expect(w[0]).toBeGreaterThan(0.98);
		expect(j0[R - 1]).toBe(0);
		expect(w[R - 1]).toBeLessThan(0.02);
	});

	it('linear axis: each row blends the two scales bracketing its period, in log period', () => {
		const { j0, j1, w } = scalogramImageRows(PERIODS, false);
		const R = j0.length;
		expect(R).toBe(Math.max(PERIODS.length, SCALOGRAM_IMAGE_ROWS));
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

	it.each([false, true])(
		'each scale is at full weight where the axis puts its period (log %s)',
		(log) => {
			const { j0, j1, w } = scalogramImageRows(PERIODS, log);
			const R = j0.length;
			const H = 300;
			// The weight a row gives scale j.
			const weightOf = (r, j) => (j0[r] === j ? 1 - w[r] : 0) + (j1[r] === j ? w[r] : 0);
			for (let j = 0; j < PERIODS.length; j++) {
				const y = periodToY(PERIODS[j], PERIODS, H, log);
				const r = Math.min(R - 1, Math.floor((y / H) * R));
				expect(weightOf(r, j), `scale ${j}`).toBeGreaterThan(0.9);
				// and none at its neighbours' periods
				for (const k of [j - 1, j + 1].filter((k) => k >= 0 && k < PERIODS.length)) {
					const yk = periodToY(PERIODS[k], PERIODS, H, log);
					const rk = Math.min(R - 1, Math.floor((yk / H) * R));
					expect(weightOf(rk, j), `scale ${j} at ${k}`).toBeLessThan(0.1);
				}
			}
		}
	);

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

describe('renderScalogramURI on either axis', () => {
	// Power only in the scale nearest 24 h, none anywhere else.
	const j24 = PERIODS.reduce(
		(b, p, j) => (Math.abs(p - 24) < Math.abs(PERIODS[b] - 24) ? j : b),
		0
	);
	const power = PERIODS.map((_, j) => [j === j24 ? 1 : 0, j === j24 ? 1 : 0]);

	/** The green channel down the first column (viridis: 0 power is dark, 1 is bright). */
	const greens = (img) =>
		Array.from({ length: img.height }, (_, r) => img.data[r * img.width * 4 + 1]);

	it.each([false, true])(
		'paints the 24 h scale where the axis puts 24 h, fading to its neighbours (log %s)',
		(log) => {
			const painted = stubCanvas();
			const uri = renderScalogramURI(power, 'viridis', 1, scalogramImageRows(PERIODS, log));
			expect(uri).toMatch(/^data:image\/png/);
			const img = painted.img;
			expect(img.height).toBe(scalogramImageRows(PERIODS, log).j0.length);
			const g = greens(img);
			const H = 300;
			const rowOf = (period) =>
				Math.min(img.height - 1, Math.floor((periodToY(period, PERIODS, H, log) / H) * img.height));
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
		}
	);

	// The edges: power only in the longest (or shortest) scale is brightest at the top (or
	// bottom) edge of the image, where the axis puts that period, not half a row inside. The
	// image is stretched over the plot, so a row's centre is (r + 0.5) / rows of the height.
	it.each([false, true])('the longest and shortest periods paint at the edges (log %s)', (log) => {
		const n = PERIODS.length;
		for (const j of [n - 1, 0]) {
			const painted = stubCanvas();
			const only = PERIODS.map((_, k) => [k === j ? 1 : 0]);
			renderScalogramURI(only, 'viridis', 1, scalogramImageRows(PERIODS, log));
			const g = greens(painted.img);
			const peak = g.indexOf(Math.max(...g));
			const drawnAt = (peak + 0.5) / g.length; // fraction of the height, from the top
			const tickAt = periodToY(PERIODS[j], PERIODS, 1, log);
			// Under a pixel on a 1000 px tall plot (it was 1 / 50 of the height at 25 scales).
			expect(Math.abs(drawnAt - tickAt), `scale ${j}`).toBeLessThan(0.001);
		}
	});

	it('with no row map, the scales are taken as evenly spaced on a log axis', () => {
		const painted = stubCanvas();
		renderScalogramURI(power, 'viridis', 1);
		const img = painted.img;
		expect(img.height).toBe(Math.max(PERIODS.length, SCALOGRAM_IMAGE_ROWS));
		const g = greens(img);
		const peak = g.indexOf(Math.max(...g));
		const want = Math.floor(periodToY(PERIODS[j24], PERIODS, 1, true) * img.height);
		expect(Math.abs(peak - want)).toBeLessThanOrEqual(1);
	});
});
