// @ts-nocheck
// Layout data for the pairs (scatterplot-matrix) plot: the correlation grid for the lower
// triangle, per-column ranges + histograms for the diagonal, and a null-safe linear fit for
// the upper-triangle scatter cells. Pure and unit-tested; the correlation maths comes from the
// scipy-pinned correlationGrid, the fit line from the shared linearRegression.
import { correlationGrid } from './correlationGrid.js';
import { validPairs } from './validPairs.js';
import { isInvalidValue } from './stats.js';
import { linearRegression } from '$lib/components/plotbits/helpers/wrangleData.js';

/**
 * Equal-width histogram bins over [min, max] of the finite values.
 * @param {number[]} values
 * @param {number} nBins
 * @returns {{binStarts:number[], counts:number[], binWidth:number, min:number, max:number, maxCount:number}}
 */
export function histogramBins(values, nBins = 12) {
	const clean = (values ?? []).filter((v) => !isInvalidValue(v)).map(Number);
	if (clean.length === 0) return { binStarts: [], counts: [], binWidth: 0, min: 0, max: 0, maxCount: 0 };
	let min = clean[0];
	let max = clean[0];
	for (const v of clean) {
		if (v < min) min = v;
		if (v > max) max = v;
	}
	if (max === min) {
		// A constant column: one bin holding everything (avoids a zero-width divide).
		return { binStarts: [min], counts: [clean.length], binWidth: 1, min, max, maxCount: clean.length };
	}
	const binWidth = (max - min) / nBins;
	const counts = new Array(nBins).fill(0);
	for (const v of clean) {
		let b = Math.floor((v - min) / binWidth);
		if (b >= nBins) b = nBins - 1; // the max value lands in the last bin
		if (b < 0) b = 0;
		counts[b]++;
	}
	const binStarts = counts.map((_, i) => min + i * binWidth);
	return { binStarts, counts, binWidth, min, max, maxCount: Math.max(...counts) };
}

/**
 * Least-squares line through the pairwise-complete rows.
 * @returns {{slope:number, intercept:number}} NaN pair when fewer than two usable points.
 */
export function linearFit(x, y) {
	const { tt, yy } = validPairs(x, y);
	if (tt.length < 2) return { slope: NaN, intercept: NaN };
	const reg = linearRegression(tt, yy);
	return { slope: reg.slope, intercept: reg.intercept };
}

/**
 * Everything the pairs plot needs to render its N×N grid.
 * @param {number[][]} columns
 * @param {string[]|null} names
 * @param {'pearson'|'spearman'} method
 * @returns {{labels:string[], r:number[][], p:number[][], cols:number[][],
 *            ranges:{min:number,max:number}[], hists:ReturnType<typeof histogramBins>[]}}
 */
export function pairsLayout(columns, names, method = 'pearson') {
	const cols = (columns ?? []).map((c) => (c ?? []).map((v) => (isInvalidValue(v) ? NaN : Number(v))));
	if (cols.length === 0) return { labels: [], r: [], p: [], cols: [], ranges: [], hists: [] };
	const grid = correlationGrid(cols, names, method);
	const ranges = cols.map((c) => {
		const finite = c.filter(Number.isFinite);
		if (!finite.length) return { min: 0, max: 1 };
		let min = finite[0];
		let max = finite[0];
		for (const v of finite) {
			if (v < min) min = v;
			if (v > max) max = v;
		}
		return { min, max };
	});
	const hists = cols.map((c) => histogramBins(c));
	return { labels: grid.labels, r: grid.r, p: grid.p, cols, ranges, hists };
}
