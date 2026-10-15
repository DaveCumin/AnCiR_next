// @ts-check
// The periodogram's reported peak and its family-wise significance, shared by the Periodogram
// plot, RhythmicityAnalysis and MovingAnalysis (and mirrored in tools/ancir_runtime.py / .R).
// Kept apart from periodogram.js (the compute) so node tests that mock the compute still get
// the real peak rule.
import { chisqSf } from './chisqSf.js';

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
 * The chi-squared peak's FAMILY-WISE p: 1 - (1 - p)^M, with p the per-period upper-tail p at
 * the peak and M the number of folds that carry a statistic, the same M the Sidak line is
 * drawn with (runPeriodogramCalculation). The peak crosses the drawn line exactly when this p
 * is below the line's alpha. The per-period p alone is the probability for ONE pre-chosen
 * period, but the peak is the maximum over all M, so on white noise it was below 0.05 in 34%
 * of records while the line was crossed in 3% (SPEC-6).
 *
 * @param {{y:number[], pvalue:number[], df?:number[]}} periodData
 * @param {number} idx the peak's index
 * @returns {number} NaN for Lomb-Scargle/Enright (no analytic p)
 */
export function peakFamilywiseP(periodData, idx) {
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
