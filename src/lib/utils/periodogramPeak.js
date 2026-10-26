// @ts-check
// The periodogram's reported peak and its family-wise significance, shared by the Periodogram
// plot, RhythmicityAnalysis and MovingAnalysis (and mirrored in tools/ancir_runtime.py / .R).
// Kept apart from periodogram.js (the compute) so node tests that mock the compute still get
// the real peak rule.
import { chisqSf } from './chisqSf.js';
import gammaln from '@stdlib/math-base-special-gammaln';

/**
 * Index of the periodogram's reported PEAK in a runPeriodogramCalculation result, or -1 when
 * there is none. One rule for every place that reports a periodogram peak (the plot, the
 * RhythmicityAnalysis and MovingAnalysis nodes; mirrored in tools/ancir_runtime.py and .R).
 *
 * Chi-squared (any finite `threshold`): the period whose Qp exceeds its own Sidak threshold by
 * the MOST, i.e. the largest Qp - threshold. Qp is approximately chi-square on df = bins per
 * period - 1, so its noise level and its threshold both grow with the period; the largest raw
 * Qp therefore drifts to long periods (and to the 2x subharmonic) whenever the rhythm is not
 * overwhelming. A 24 h sinusoid at amplitude 0.3 SD over 10 days, scanned 16 to 48 h, peaked at
 * 47.75 h by raw Qp and at 24.0 h by the excess (SPEC-9). Whether that peak is significant is
 * peakFamilywiseP below (below alpha exactly when the excess is positive).
 *
 * Lomb-Scargle and Enright (no threshold): the largest power, as before (spectralPeakIndex).
 * Lomb-Scargle's family-wise p is Baluev's false-alarm probability (lombScargleFamilywiseP).
 *
 * Either way a non-positive or non-finite power is never a peak, so flat or all-zero data
 * reports no peak (ROB-13).
 *
 * @param {{y:number[], threshold?:number[]}} res
 * @param {number[]} [candidateIndices] restrict the search (e.g. the visible period range)
 * @returns {number}
 */
export function periodogramPeakIndex(res, candidateIndices) {
	const y = res?.y;
	if (!y) return -1;
	const thr = res.threshold ?? [];
	const idxs = candidateIndices ?? Array.from(y.keys());
	// Chi-squared emits a finite threshold at every period it keeps; LS/Enright emit NaN.
	const useExcess = idxs.some((i) => Number.isFinite(thr[i]));
	let best = -1;
	let bestScore = -Infinity;
	for (const i of idxs) {
		const v = y[i];
		if (!Number.isFinite(v) || !(v > 0)) continue;
		const score = useExcess ? v - thr[i] : v;
		if (useExcess && !Number.isFinite(score)) continue;
		if (best < 0 || score > bestScore) {
			best = i;
			bestScore = score;
		}
	}
	return best;
}

/**
 * The Lomb-Scargle peak's FAMILY-WISE p: the probability that pure noise puts a peak this high
 * ANYWHERE in the band, Baluev's (2008, MNRAS 385:1279-1285, eq. 6 and Table 1) "alias-free"
 * false-alarm probability, in the form astropy implements (LombScargle.false_alarm_probability,
 * method 'baluev', normalization 'standard', VanderPlas 2018 ApJS 236:16 section 7.4):
 *
 *   z     = 2 P / (N - 1)   the app's power P (Horne and Baliunas 1986, ApJ 302:757, normalised
 *                           by the sample variance) as the fraction of variance explained
 *   FAP_1 = (1 - z)^((N - 3) / 2)                                     one pre-chosen frequency
 *   tau   = gamma(N - 1) W (1 - z)^((N - 4) / 2) sqrt((N - 1) z / 2)   Davies' upcrossing term
 *   FAP   = 1 - (1 - FAP_1) exp(-tau)
 *
 * with W = fmax sqrt(4 pi var(t)) (fmax the highest frequency searched, var(t) the population
 * variance of the sample times) and gamma(m) = sqrt(2 / m) Gamma(m / 2) / Gamma((m - 1) / 2).
 * It is an upper bound, close to the true FAP when that is small, and it treats the band as
 * running from 0 to fmax, so it is conservative for a band that starts above 0. Unlike the
 * Horne and Baliunas M_eff rule it needs no simulation and holds for uneven sampling.
 *
 * @param {number} power the peak's normalised power P
 * @param {number} n the number of samples the spectrum used
 * @param {number} timeVar population variance of their times
 * @param {number} fmax highest frequency searched (1 / shortest period), per time unit
 * @returns {number} in [0, 1]; NaN for n < 5, no time spread or a non-finite input
 */
export function lombScargleFamilywiseP(power, n, timeVar, fmax) {
	if (!(n >= 5) || !(timeVar > 0) || !(fmax > 0) || !Number.isFinite(power)) return NaN;
	const z = Math.min(1, Math.max(0, (2 * power) / (n - 1)));
	const nh = n - 1;
	const nk = n - 3;
	const fapSingle = Math.pow(1 - z, nk / 2);
	const gammaFactor = Math.sqrt(2 / nh) * Math.exp(gammaln(nh / 2) - gammaln((nh - 1) / 2));
	const w = fmax * Math.sqrt(4 * Math.PI * timeVar);
	const tau = gammaFactor * w * Math.pow(1 - z, (nk - 1) / 2) * Math.sqrt((nh * z) / 2);
	// 1 - (1 - FAP_1) e^-tau, written so that a tiny FAP stays tiny (as astropy does).
	return Math.min(1, -Math.expm1(-tau) + fapSingle * Math.exp(-tau));
}

/**
 * The chi-squared peak's FAMILY-WISE p: 1 - (1 - p)^M, with p the per-period upper-tail p at
 * the peak and M the number of folds that carry a statistic, the same M the Sidak line is
 * drawn with (runPeriodogramCalculation). The peak crosses the drawn line exactly when this p
 * is below the line's alpha. The per-period p alone is the probability for ONE pre-chosen
 * period, but the peak is the maximum over all M, so on white noise it was below 0.05 in 34%
 * of records while the line was crossed in 3% (SPEC-6).
 *
 * A Lomb-Scargle result (one that carries `nObs` and `timeVar` from runPeriodogramCalculation)
 * gets lombScargleFamilywiseP instead, over the band searched: the periods at
 * `candidateIndices` (the visible range for the plot's visible peak), else every period.
 *
 * @param {{x?:number[], y:number[], pvalue:number[], df?:number[], nObs?:number,
 *          timeVar?:number}} periodData
 * @param {number} idx the peak's index
 * @param {number[]} [candidateIndices] the periods the peak was searched over (Lomb-Scargle)
 * @returns {number} NaN for Enright (no analytic p)
 */
export function peakFamilywiseP(periodData, idx, candidateIndices) {
	if (Number.isFinite(periodData?.nObs)) {
		const x = periodData.x ?? [];
		let pMin = Infinity;
		for (const i of candidateIndices ?? x.keys()) if (x[i] > 0 && x[i] < pMin) pMin = x[i];
		if (!(idx >= 0) || !Number.isFinite(pMin)) return NaN;
		return lombScargleFamilywiseP(
			periodData.y?.[idx],
			periodData.nObs,
			periodData.timeVar,
			1 / pMin
		);
	}
	const pv = periodData?.pvalue ?? [];
	let M = 0;
	for (const v of pv) if (Number.isFinite(v)) M++;
	if (!M || !Number.isFinite(pv[idx])) return NaN;
	const df = periodData.df?.[idx];
	const q = periodData.y?.[idx];
	const p = Number.isFinite(df) && Number.isFinite(q) ? chisqSf(q, df) : pv[idx];
	// 1 - (1 - p)^M without cancellation, so a tiny p stays tiny instead of becoming 0.
	return -Math.expm1(M * Math.log1p(-Math.min(1, Math.max(0, p))));
}
