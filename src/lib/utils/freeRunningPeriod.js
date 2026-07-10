// @ts-nocheck
// Free-running period auto-estimation.
//
// estimateFreeRunningPeriod finds the dominant circadian period (tau) of a
// time series by locating the peak of a chi-squared (Sokolove-Bushell)
// periodogram over a candidate period window. It is a thin, pure wrapper around
// runPeriodogramCalculation (periodogram.js) so the numerically-critical spectral
// core is shared with Rhythmicity Analysis rather than re-implemented here.
//
// Reference: Sokolove PG & Bushell WN (1978) "The chi square periodogram: its
// utility for analysis of circadian rhythms." J Theor Biol 72(1):131-160.

import { runPeriodogramCalculation } from '$lib/utils/periodogram.js';

/**
 * @typedef {Object} FreeRunningPeriodResult
 * @property {number} period - period (hours) at the periodogram peak, NaN if none
 * @property {number} power  - periodogram power at that peak, NaN if none
 * @property {number} pValue - significance p-value at that peak (chi-squared
 *   method only; NaN for Lomb-Scargle / Enright which have no analytic p here)
 */

const EMPTY = Object.freeze({ period: NaN, power: NaN, pValue: NaN });

/**
 * Estimate the free-running period as the peak of a chi-squared periodogram.
 *
 * @param {number[]} t - sample times (hours). NaN/null pairs are dropped.
 * @param {number[]} y - sample values, index-aligned with `t`.
 * @param {Object} [opts]
 * @param {number} [opts.pMin=20]  - minimum candidate period (hours)
 * @param {number} [opts.pMax=28]  - maximum candidate period (hours)
 * @param {number} [opts.step=0.1] - period grid resolution (hours)
 * @param {string} [opts.method='Chi-squared'] - 'Chi-squared' | 'Lomb-Scargle' | 'Enright'
 * @param {number} [opts.binSize=1] - fold bin width (hours), chi-squared/Enright
 * @param {number} [opts.alpha=0.05] - family-wise significance level (chi-squared)
 * @returns {FreeRunningPeriodResult}
 */
export function estimateFreeRunningPeriod(t, y, opts = {}) {
	const {
		pMin = 20,
		pMax = 28,
		step = 0.1,
		method = 'Chi-squared',
		binSize = 1,
		alpha = 0.05
	} = opts;

	if (!Array.isArray(t) || !Array.isArray(y)) return { ...EMPTY };
	if (!(pMax > pMin) || !(step > 0)) return { ...EMPTY };

	// Drop NaN/null pairs and keep the two axes aligned.
	const tt = [];
	const yy = [];
	const n = Math.min(t.length, y.length);
	for (let i = 0; i < n; i++) {
		const ti = t[i];
		const yi = y[i];
		if (ti == null || yi == null || isNaN(ti) || isNaN(yi)) continue;
		tt.push(ti);
		yy.push(yi);
	}
	if (tt.length < 3) return { ...EMPTY };

	const res = runPeriodogramCalculation({
		method,
		xData: tt,
		yData: yy,
		periodMin: pMin,
		periodMax: pMax,
		periodSteps: step,
		binSize,
		chiSquaredAlpha: alpha
	});

	const xs = res?.x ?? [];
	const powers = res?.y ?? [];
	const pvals = res?.pvalue ?? [];
	if (powers.length === 0) return { ...EMPTY };

	// Peak = the largest finite power over the window.
	let bestIdx = -1;
	let bestPow = -Infinity;
	for (let i = 0; i < powers.length; i++) {
		const v = powers[i];
		if (Number.isFinite(v) && v > bestPow) {
			bestPow = v;
			bestIdx = i;
		}
	}
	if (bestIdx < 0) return { ...EMPTY };

	return {
		period: xs[bestIdx],
		power: powers[bestIdx],
		pValue: Number.isFinite(pvals[bestIdx]) ? pvals[bestIdx] : NaN
	};
}
