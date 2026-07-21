// @ts-nocheck
// Cross-correlation between two series at a range of lags — the cross-correlogram.
//
// At lag k, r(k) is the (Pearson or Spearman) correlation between x[t] and y[t+k], computed on
// the overlapping segment only. A peak at k>0 means y leads x by k samples (x lags y);
// k<0 means x leads. This is the standard tool for the phase/delay relationship between two
// rhythms. The per-lag coefficient reuses the reference-validated `correlate`; the lag windowing
// is pinned to numpy in the parity harness.
//
// Returns NaN coefficients rather than throwing on degenerate overlaps.
import { correlate } from './correlation.js';

/**
 * @param {number[]} x
 * @param {number[]} y
 * @param {{maxLag?:number, method?:'pearson'|'spearman'}} [opts]
 * @returns {{lags:number[], r:number[], pvalue:number[], n:number[], peakLag:number, peakR:number}}
 */
export function crossCorrelation(x, y, opts = {}) {
	const method = opts.method === 'spearman' ? 'spearman' : 'pearson';
	const nx = x?.length ?? 0;
	const ny = y?.length ?? 0;
	// Default lag window: a quarter of the shorter series, capped so most lags keep enough overlap.
	const cap = Math.max(1, Math.floor(Math.min(nx, ny) / 4));
	const maxLag = Number.isFinite(opts.maxLag) && opts.maxLag > 0 ? Math.min(Math.floor(opts.maxLag), Math.min(nx, ny) - 1) : cap;

	const lags = [];
	const r = [];
	const pvalue = [];
	const n = [];
	for (let k = -maxLag; k <= maxLag; k++) {
		// overlap indices i where both x[i] and y[i+k] exist
		const iStart = Math.max(0, -k);
		const iEnd = Math.min(nx - 1, ny - 1 - k);
		const xs = [];
		const ys = [];
		for (let i = iStart; i <= iEnd; i++) {
			xs.push(x[i]);
			ys.push(y[i + k]);
		}
		const c = correlate(xs, ys, method);
		lags.push(k);
		r.push(c.r);
		pvalue.push(c.pvalue);
		n.push(c.n);
	}

	// Peak = lag of maximum |r| among evaluable lags.
	let peakLag = NaN;
	let peakR = NaN;
	let best = -Infinity;
	for (let idx = 0; idx < lags.length; idx++) {
		const mag = Math.abs(r[idx]);
		if (Number.isFinite(mag) && mag > best) {
			best = mag;
			peakLag = lags[idx];
			peakR = r[idx];
		}
	}
	return { lags, r, pvalue, n, peakLag, peakR };
}
