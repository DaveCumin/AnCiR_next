/**
 * The actogram's size limits, both sides of each.
 *
 * 1. Rows vs plot height. The gaps between rows used to eat the whole plot once there were
 *    more than about plotheight / (gap + 1) rows: rowHeight went to 0 and the actogram drew
 *    NOTHING, silently (a year of 1 min data, 348 rows, in a canvas node). Now the gap
 *    shrinks to keep 1 px rows, and under 1 px the rows are drawn into one image.
 * 2. The 20,000-row limit (a plain number column of seconds read as hours gives 20,834 rows
 *    for 500,000 samples): past it nothing was drawn and nothing said why. Now the plot
 *    says why.
 * 3. The image is the picture the SVG rows would rasterise to: its per-pixel coverage is the
 *    area the SVG bars (legendObstacles lays them out exactly as the plot snippet does)
 *    cover in that pixel.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { core, appConsts, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { rasterizeRows } from './actogramRaster.js';

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
});

beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
});

/** An actogram of `n` samples every `stepH` hours (activity by day, quiet by night). */
function actogram(n, stepH, { xType = 'time', height = 300, period = 24 } = {}) {
	const t0 = Date.UTC(2026, 0, 5);
	const x = new Column({ type: xType, data: -1 });
	core.rawData.set(
		x.id,
		Array.from({ length: n }, (_, i) => (xType === 'time' ? t0 + i * stepH * 3_600_000 : i * stepH))
	);
	x.data = x.id;
	pushObj(x);
	const y = new Column({ type: 'number', data: -1 });
	let s = 11;
	const u = () => (s = (s * 16807) % 2147483647) / 2147483647;
	core.rawData.set(
		y.id,
		Array.from({ length: n }, (_, i) => {
			const h = (i * stepH) % 24;
			return (h > 6 && h < 18 ? 50 : 5) * u();
		})
	);
	y.data = y.id;
	pushObj(y);
	const plot = new Plot({
		type: 'actogram',
		name: 'A',
		x: 0,
		y: 0,
		width: 600,
		height,
		plot: { data: [] }
	});
	plot.plot.periodHrs = period;
	plot.plot.addData({ x: { refId: x.id }, y: { refId: y.id } });
	core.plots.push(plot);
	plot.parentBox = { id: plot.id, width: 600, height };
	return plot.plot;
}

describe('rows vs plot height', () => {
	it('rows that fit with their gaps: the user gap, SVG rows (unchanged)', () => {
		const a = actogram(14 * 96, 0.25); // two weeks of 15 min samples
		expect(a.Ndays).toBe(14);
		expect(a.rowGap).toBe(a.spaceBetween);
		expect(a.eachplotheight).toBeGreaterThan(1);
		expect(a.rasterRows).toBe(false);
	});

	it('more rows than the gaps leave room for (was 0 px rows, a blank plot): gap shrinks, 1 px rows', () => {
		const a = actogram(200 * 96, 0.25);
		const h = a.plotheight;
		expect(a.Ndays).toBe(200);
		expect(h).toBeGreaterThan(200);
		expect((h - 199 * a.spaceBetween) / 200).toBeLessThan(1); // the old height: invisible
		expect(a.eachplotheight).toBeCloseTo(1, 9);
		expect(a.rowGap).toBeLessThan(a.spaceBetween);
		expect(a.rasterRows).toBe(false);
	});

	it('more rows than pixels: no gap, rows share the height, drawn as an image', () => {
		const a = actogram(70_080, 0.25); // two years of 15 min samples
		expect(a.Ndays).toBe(730);
		expect(a.plotheight).toBeLessThan(730);
		expect(a.rowGap).toBe(0);
		expect(a.eachplotheight * a.Ndays).toBeCloseTo(a.plotheight, 9);
		expect(a.rasterRows).toBe(true);
		expect(a.rowsRefusedMessage).toBe('');
	});
});

describe('the row limit (20,000)', () => {
	it('20,000 rows are drawn', () => {
		const a = actogram(20_000 * 24, 1, { xType: 'number' });
		expect(a.rowsNeeded).toBe(20_000);
		expect(a.Ndays).toBe(20_000);
		expect(a.rasterRows).toBe(true);
		expect(a.rowsRefusedMessage).toBe('');
	});

	it('20,001 rows: nothing drawn, and the plot says why and what to do', () => {
		const a = actogram(20_000 * 24 + 1, 1, { xType: 'number' });
		expect(a.rowsNeeded).toBe(20_001);
		expect(a.Ndays).toBe(0);
		expect(a.rowsRefusedMessage).toBe(
			'Not drawn: the data span 20,001 periods of 24 h, and an actogram draws at most 20,000 ' +
				'rows. A plain number column is read as hours: convert seconds or minutes to hours ' +
				'(or import it as time), or set a longer period.'
		);
	});
});

/** The rows' bins as the plot snippet reads them (getBinsForPeriods). */
const rowBinsOf = (a) => (day) => {
	const out = { xStart: [], xEnd: [], y: [] };
	for (let p = day; p < day + a.doublePlot; p++)
		for (const b of a.data[0].binsByPeriod[p] ?? []) {
			out.xStart.push(b.xStart - day * a.periodHrs);
			out.xEnd.push(b.xEnd - day * a.periodHrs);
			out.y.push(b.y);
		}
	return out;
};

/** The largest per-pixel difference between the raster and the rectangles' exact areas. */
function maxCoverDiff(rects, cover, W, H) {
	const ref = new Float64Array(W * H);
	for (const [x0, y0, x1, y1] of rects) {
		for (let r = Math.max(0, Math.floor(y0)); r < Math.min(H, Math.ceil(y1)); r++) {
			const cy = Math.min(y1, r + 1) - Math.max(y0, r);
			for (let c = Math.max(0, Math.floor(x0)); c < Math.min(W, Math.ceil(x1)); c++) {
				const cx = Math.min(x1, c + 1) - Math.max(x0, c);
				if (cx > 0 && cy > 0) ref[r * W + c] += cx * cy;
			}
		}
	}
	let maxDiff = 0;
	let total = 0;
	for (let k = 0; k < ref.length; k++) {
		maxDiff = Math.max(maxDiff, Math.abs(ref[k] - cover[k]));
		total += ref[k];
	}
	return { maxDiff, total };
}

describe('the image is the picture the SVG rows rasterise to', () => {
	it('bars, rows under 1 px: per-pixel coverage equals the area the SVG bars cover there', () => {
		const a = actogram(70_080, 0.25);
		expect(a.rasterRows).toBe(true);
		const W = Math.round(a.plotwidth);
		const H = Math.round(a.plotheight);
		// The SVG bars, laid out exactly as the plot snippet draws them (legendObstacles).
		const rects = a.legendObstacles(W, H)[0].rects;
		expect(rects.length).toBeGreaterThan(10_000);
		const lims = a.ylims[0];
		const { cover } = rasterizeRows({
			nRows: a.Ndays,
			widthPx: W,
			heightPx: H,
			span: a.periodHrs * a.doublePlot,
			mode: 'bars',
			rowBins: rowBinsOf(a),
			yFrac: (day, y) => (y - lims[day][0]) / (lims[day][1] - lims[day][0])
		});
		const { maxDiff, total } = maxCoverDiff(rects, cover, W, H);
		expect(total).toBeGreaterThan(1000);
		expect(maxDiff).toBeLessThan(1e-3);
	});

	it('a heatmap past 20,000 cells (rows over 1 px, with gaps): the same cells, as an image', () => {
		const small = actogram(4000, 0.25);
		small.renderMode = 'heatmap';
		expect(small.heatmapCells).toBeLessThanOrEqual(20_000);
		expect(small.rasterRows).toBe(false); // SVG cells, as before

		const a = actogram(14_000, 0.25, { height: 900 });
		a.renderMode = 'heatmap';
		expect(a.heatmapCells).toBeGreaterThan(20_000);
		expect(a.eachplotheight).toBeGreaterThan(1);
		expect(a.rowGap).toBeGreaterThan(0);
		expect(a.rasterRows).toBe(true);
		const W = Math.round(a.plotwidth);
		const H = Math.ceil(a.Ndays * (a.eachplotheight + a.rowGap));
		// Every cell; the last obstacle is the colour-scale bar, not a cell.
		const rects = a.legendObstacles(W, a.plotheight)[0].rects.slice(0, -1);
		const { cover } = rasterizeRows({
			nRows: a.Ndays,
			widthPx: W,
			heightPx: H,
			span: a.periodHrs * a.doublePlot,
			rowH: a.eachplotheight,
			gap: a.rowGap,
			mode: 'heatmap',
			rowBins: rowBinsOf(a),
			colour: () => [0, 0, 0]
		});
		const { maxDiff, total } = maxCoverDiff(rects, cover, W, H);
		expect(total).toBeGreaterThan(1000);
		expect(maxDiff).toBeLessThan(1e-3);
	});
});
