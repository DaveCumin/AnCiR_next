// STAT-31: a histogram with UNEQUAL bin widths (custom cut edges) drew raw counts, so a wide
// bin looked more populous than it was, and the density overlay, scaled by the MEAN bin width,
// matched no bar. With unequal widths the bars are now the density, count / (N * width), whose
// area (not height) is the fraction of values in the bin, and the curve is the plain density on
// the same axis; this is R's hist() rule (freq = FALSE unless the breaks are equidistant).
// Equal widths, uniform or cuts, are unchanged: counts, and the curve scaled by N * width.
import { describe, it, expect, beforeEach } from 'vitest';
import { core } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Histogramclass } from './Histogram.svelte';
import { gaussianKDE } from '$lib/utils/kde.js';

function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1, name });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

const X = [0.5, 1.2, 1.7, 2.1, 2.4, 2.9, 3.3, 4.8, 6.1, 9.5];

function hist(series, inner = {}) {
	const parentBox = { id: 1, width: 400, height: 300, data: [] };
	return new Histogramclass(parentBox, {
		...inner,
		data: series.map((s) => ({ column: { refId: mkCol('x', s.values ?? X) }, ...s.settings }))
	});
}

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
});

describe('Histogram with unequal bin widths shows density', () => {
	it('bars are count / (N * width), as R hist(x, breaks)$density', () => {
		const h = hist([
			{ settings: { binMode: 'cuts', cuts: [0, 1, 2, 3, 5, 10], showDensity: true } }
		]);
		expect(h.densityScale).toBe(true);
		const d = h.data[0];
		expect(d.binned.y_out).toEqual([1, 2, 3, 2, 2]);
		// R 4.5.2: hist(X, breaks = c(0, 1, 2, 3, 5, 10), right = FALSE)$density.
		const R = [0.1, 0.2, 0.3, 0.1, 0.04];
		d.barHeights.forEach((v, i) => expect(v).toBeCloseTo(R[i], 14));
		// The curve is the plain density on the same axis (no count scaling).
		const kde = gaussianKDE(X, { gridSize: 128 });
		d.density.y.forEach((v, i) => expect(v).toBeCloseTo(kde.density[i], 14));
		expect(h.defaultYLabel).toBe('Density');
	});

	it('N counts every present value, so the bar areas sum to the in-range fraction', () => {
		// 12.0 is past the last edge: dropped from the bars, still in N (and in the curve).
		const h = hist([
			{ values: [...X, 12], settings: { binMode: 'cuts', cuts: [0, 1, 2, 3, 5, 10] } }
		]);
		const d = h.data[0];
		const area = d.barHeights.reduce(
			(s, v, i) => s + v * (d.binned.binEnds[i] - d.binned.bins[i]),
			0
		);
		expect(area).toBeCloseTo(10 / 11, 14);
	});

	it('equal widths stay counts: uniform bins, and cuts that happen to be equally spaced', () => {
		const u = hist([{ settings: { binSize: 2, binStart: 0, showDensity: true } }]);
		expect(u.densityScale).toBe(false);
		expect(u.data[0].barHeights).toEqual(u.data[0].binned.y_out);
		const kde = gaussianKDE(X, { gridSize: 128 });
		u.data[0].density.y.forEach((v, i) => expect(v).toBeCloseTo(kde.density[i] * 10 * 2, 12));
		expect(u.defaultYLabel).toBe('Count');
		const c = hist([{ settings: { binMode: 'cuts', cuts: [0, 2.5, 5, 7.5, 10] } }]);
		expect(c.densityScale).toBe(false);
		expect(c.data[0].barHeights).toEqual([5, 3, 1, 1]);
	});

	it('one unequal series puts every series on the density axis (one shared y axis)', () => {
		const h = hist([
			{ settings: { binSize: 2, binStart: 0 } },
			{ settings: { binMode: 'cuts', cuts: [0, 1, 2, 3, 5, 10] } }
		]);
		expect(h.densityScale).toBe(true);
		// Equal-width series: count / (10 * 2).
		const a = h.data[0];
		a.barHeights.forEach((v, i) => expect(v).toBeCloseTo(a.binned.y_out[i] / 20, 14));
		// The y range follows the drawn heights, not the counts.
		expect(h.ylims[1]).toBeLessThan(1);
	});

	it('an old session with the stored default "Count" label reads "Density" here; a typed label stays', () => {
		const legacy = hist([{ settings: { binMode: 'cuts', cuts: [0, 1, 2, 3, 5, 10] } }], {
			yAxis: { label: 'Count' }
		});
		expect(legacy.yAxis.label).toBe('');
		expect(legacy.defaultYLabel).toBe('Density');
		const typed = hist([{ settings: { binMode: 'cuts', cuts: [0, 1, 2, 3, 5, 10] } }], {
			yAxis: { label: 'Frequency density' }
		});
		expect(typed.yAxis.label).toBe('Frequency density');
	});

	it('the data export carries the drawn density and the counts', () => {
		const h = hist([{ settings: { binMode: 'cuts', cuts: [0, 1, 2, 3, 5, 10], label: 's' } }]);
		const { headers, rows } = h.getDownloadData();
		expect(headers).toEqual(['series', 'kind', 'x_start', 'x_end', 'value', 'count']);
		const bins = rows.filter((r) => r[1] === 'bin');
		expect(bins.map((r) => r[5])).toEqual([1, 2, 3, 2, 2]);
		expect(bins[4][4]).toBeCloseTo(0.04, 14);
		// Equal widths: the export is unchanged (no count column).
		const e = hist([{ settings: { binSize: 2, binStart: 0 } }]);
		expect(e.getDownloadData().headers).toEqual(['series', 'kind', 'x_start', 'x_end', 'value']);
	});
});
