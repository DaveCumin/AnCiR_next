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
	const maxLag =
		Number.isFinite(opts.maxLag) && opts.maxLag > 0
			? Math.min(Math.floor(opts.maxLag), Math.min(nx, ny) - 1)
			: cap;

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

	const peak = findPeak(lags, r);
	return { lags, r, pvalue, n, peakLag: peak.lag, peakR: peak.r };
}

// Two lags whose |r| differ by less than this are a TIE, not a ranking. Exact
// structural relationships (a series against itself, a pure sine against a
// shifted copy) land on 1 and -1 to within a few ulps, so a raw `>` lets
// floating-point noise at a repeat lag outrank lag 0 by 2e-16.
const TIE = 1e-12;

/**
 * Peak convention, in order:
 *   1. the strongest association: the largest |r| (sign-blind, so an inverse
 *      relationship is still a peak);
 *   2. on a tie in |r|, the POSITIVE r: an exact +1 is never beaten by an
 *      exact -1 at the anti-phase lag;
 *   3. still tied, the smallest |lag|: a periodic series repeats its own peak
 *      once per period, and the nearest one is the honest answer;
 *   4. still tied (+k and -k), the smaller (negative) lag, purely so the result
 *      is deterministic.
 * Lags whose correlation is not finite (a degenerate overlap) never win.
 * @param {number[]} lags
 * @param {number[]} r
 */
function findPeak(lags, r) {
	let peak = { lag: NaN, r: NaN, mag: -Infinity };
	for (let idx = 0; idx < lags.length; idx++) {
		const mag = Math.abs(r[idx]);
		if (!Number.isFinite(mag)) continue;
		const cand = { lag: lags[idx], r: r[idx], mag };
		if (mag > peak.mag + TIE || beatsOnTie(cand, peak)) peak = cand;
	}
	return peak;
}

/** Rules 2-4, applied only when `cand` and `peak` tie on |r| (rule 1). */
function beatsOnTie(cand, peak) {
	if (!(Math.abs(cand.mag - peak.mag) <= TIE)) return false;
	if (cand.r >= 0 !== peak.r >= 0) return cand.r >= 0;
	const dc = Math.abs(cand.lag);
	const dp = Math.abs(peak.lag);
	if (dc !== dp) return dc < dp;
	return cand.lag < peak.lag;
}
