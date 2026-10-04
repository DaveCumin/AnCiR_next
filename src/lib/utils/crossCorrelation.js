// @ts-nocheck
// Cross-correlation between two series at a range of lags: the cross-correlogram.
//
// At lag k, r(k) is the (Pearson or Spearman) correlation between x[t] and y[t+k], computed on
// the overlapping segment only. A peak at k > 0 means y follows x by k samples: x LEADS y
// (y[t] = x[t - 3] peaks at k = +3). A peak at k < 0 means y leads x. This is the standard
// tool for the phase/delay relationship between two rhythms. The per-lag coefficient reuses
// the reference-validated `correlate`; the lag windowing is pinned to numpy in the parity
// harness.
//
// SIGNIFICANCE (STAT-7, SPEC-12). The raw r(k) are what the correlogram draws, but their
// textbook p-values assume independent observations. For two INDEPENDENT autocorrelated
// series r(k) has variance (1/n) sum_j rho_x(j) rho_y(j), not 1/n (Bartlett's formula), so
// those p-values reject far too often: at AR(1) phi = 0.9 with n = 168 half of all
// independent pairs were "significant" at lag 0 and every pair at some lag. The p-values
// here are therefore computed on PREWHITENED series: an AR(p) model is fitted to x
// (Yule-Walker, order by AIC up to min(n - 1, floor(10 log10 n)), the defaults of R's
// ar()), and the same filter is applied to both x and y. The filtered x is close to white
// noise, which makes the variance of the cross-correlation 1/n again whatever y's own
// structure (a rhythm included), while a lead-lag relationship between x and y survives
// the common filter at the same lag. p-values are PER LAG; `familywiseP` is the Sidak
// correction of the smallest one for the number of lags tested.
//
// Returns NaN coefficients rather than throwing on degenerate overlaps.
import { correlate } from './correlation.js';

const finite = (v) => v != null && v !== '' && Number.isFinite(Number(v));

/**
 * Yule-Walker AR fit with the order chosen by AIC (Levinson-Durbin recursion).
 *
 * Mirrors R's `ar(x, method = "yule-walker")` defaults: autocovariances divide by n,
 * `order.max = min(n - 1, floor(10 * log10(n)))`, and the order minimises
 * n * log(innovation variance) + 2 * order. Missing values are skipped in the sums
 * (each lag's autocovariance is over the pairs that are both present).
 *
 * @param {Array<number|null>} x
 * @param {{maxOrder?:number}} [opts]
 * @returns {{order:number, coef:number[], mean:number, variance:number}}
 */
export function fitAR(x, opts = {}) {
	const vals = [];
	for (const v of x ?? []) if (finite(v)) vals.push(Number(v));
	const nObs = vals.length;
	const none = { order: 0, coef: [], mean: NaN, variance: NaN };
	if (nObs < 3) return none;
	const mean = vals.reduce((a, b) => a + b, 0) / nObs;
	const n = x.length;
	const dev = new Array(n);
	for (let i = 0; i < n; i++) dev[i] = finite(x[i]) ? Number(x[i]) - mean : NaN;

	const maxOrder = Math.max(
		0,
		Math.min(
			opts.maxOrder ?? Infinity,
			nObs - 1,
			Math.floor(10 * Math.log10(nObs)),
			// A lag can only be estimated from the samples it overlaps.
			n - 2
		)
	);
	const acov = new Array(maxOrder + 1);
	for (let k = 0; k <= maxOrder; k++) {
		let s = 0;
		for (let i = k; i < n; i++) {
			const a = dev[i];
			const b = dev[i - k];
			if (a === a && b === b) s += a * b;
		}
		acov[k] = s / nObs;
	}
	if (!(acov[0] > 0)) return { ...none, mean, variance: 0 };

	// Levinson-Durbin, tracking the AIC of every order.
	let phi = [];
	let v = acov[0];
	let best = { order: 0, coef: [], variance: v, aic: nObs * Math.log(v) };
	for (let m = 1; m <= maxOrder; m++) {
		let num = acov[m];
		for (let j = 0; j < m - 1; j++) num -= phi[j] * acov[m - 1 - j];
		const kappa = num / v;
		if (!Number.isFinite(kappa) || Math.abs(kappa) >= 1) break;
		const next = new Array(m);
		for (let j = 0; j < m - 1; j++) next[j] = phi[j] - kappa * phi[m - 2 - j];
		next[m - 1] = kappa;
		phi = next;
		v *= 1 - kappa * kappa;
		if (!(v > 0)) break;
		const aic = nObs * Math.log(v) + 2 * m;
		if (aic < best.aic) best = { order: m, coef: [...phi], variance: v, aic };
	}
	return { order: best.order, coef: best.coef, mean, variance: best.variance };
}

/**
 * Apply an AR filter: e[t] = (z[t] - mean) - sum_i coef[i] (z[t-1-i] - mean). The first
 * `order` samples have no complete history and are NaN, as is any sample whose history
 * includes a missing value.
 */
export function arFilter(z, ar, mean) {
	const n = z?.length ?? 0;
	const p = ar.coef.length;
	const out = new Array(n).fill(NaN);
	for (let t = p; t < n; t++) {
		if (!finite(z[t])) continue;
		let e = Number(z[t]) - mean;
		let ok = true;
		for (let i = 0; i < p; i++) {
			const prev = z[t - 1 - i];
			if (!finite(prev)) {
				ok = false;
				break;
			}
			e -= ar.coef[i] * (Number(prev) - mean);
		}
		if (ok) out[t] = e;
	}
	return out;
}

function ccfAtLags(x, y, maxLag, method) {
	const nx = x.length;
	const ny = y.length;
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
	return { lags, r, pvalue, n };
}

/**
 * @param {number[]} x
 * @param {number[]} y
 * @param {{maxLag?:number, method?:'pearson'|'spearman'}} [opts]
 * @returns {{lags:number[], r:number[], pvalue:number[], n:number[], peakLag:number,
 *            peakR:number, pwR:number[], pwPeakLag:number, pwPeakR:number, arOrder:number,
 *            minP:number, minPLag:number, familywiseP:number, nLags:number}}
 *   `r`, `n`, `peakLag`, `peakR`: the raw cross-correlogram. `pvalue`: per-lag p of the
 *   PREWHITENED correlation `pwR` (see the header). `familywiseP`: 1 - (1 - minP)^L over the
 *   L lags with a p-value, so it can be read against alpha for "is there a lead-lag
 *   relationship at ANY lag in the window".
 */
export function crossCorrelation(x, y, opts = {}) {
	const method = opts.method === 'spearman' ? 'spearman' : 'pearson';
	const xs = x ?? [];
	const ys = y ?? [];
	const nx = xs.length;
	const ny = ys.length;
	// Default lag window: a quarter of the shorter series, capped so most lags keep enough overlap.
	const cap = Math.max(1, Math.floor(Math.min(nx, ny) / 4));
	const maxLag =
		Number.isFinite(opts.maxLag) && opts.maxLag > 0
			? Math.min(Math.floor(opts.maxLag), Math.min(nx, ny) - 1)
			: cap;

	const raw = ccfAtLags(xs, ys, maxLag, method);

	// Prewhitening: x's AR filter applied to both series (see the header).
	const ar = fitAR(xs);
	let pw = raw;
	if (ar.order > 0) {
		const ym = (() => {
			let s = 0;
			let c = 0;
			for (const v of ys) if (finite(v)) ((s += Number(v)), c++);
			return c ? s / c : NaN;
		})();
		pw = ccfAtLags(arFilter(xs, ar, ar.mean), arFilter(ys, ar, ym), maxLag, method);
	}

	let minP = Infinity;
	let minPLag = NaN;
	let minIdx = -1;
	let nLags = 0;
	for (let i = 0; i < pw.pvalue.length; i++) {
		const pv = pw.pvalue[i];
		if (!Number.isFinite(pv)) continue;
		nLags++;
		// Equal p (strong lags all underflow to 0) is settled by the peak convention on the
		// prewhitened r: larger |r|, then positive r, then the smaller |lag|.
		const tie =
			pv === minP &&
			(Math.abs(pw.r[i]) > Math.abs(pw.r[minIdx]) + TIE ||
				beatsOnTie(
					{ lag: pw.lags[i], r: pw.r[i], mag: Math.abs(pw.r[i]) },
					{ lag: pw.lags[minIdx], r: pw.r[minIdx], mag: Math.abs(pw.r[minIdx]) }
				));
		if (pv < minP || tie) {
			minP = pv;
			minPLag = pw.lags[i];
			minIdx = i;
		}
	}
	if (!nLags) minP = NaN;
	// Sidak, written with log1p/expm1 so a tiny minP is not rounded to 0 by 1 - (1 - p)^L.
	const familywiseP = nLags ? -Math.expm1(nLags * Math.log1p(-Math.min(minP, 1))) : NaN;

	const peak = findPeak(raw.lags, raw.r);
	const pwPeak = findPeak(pw.lags, pw.r);
	return {
		lags: raw.lags,
		r: raw.r,
		pvalue: pw.pvalue,
		n: raw.n,
		peakLag: peak.lag,
		peakR: peak.r,
		pwR: pw.r,
		pwPeakLag: pwPeak.lag,
		pwPeakR: pwPeak.r,
		arOrder: ar.order,
		minP,
		minPLag,
		familywiseP,
		nLags
	};
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
