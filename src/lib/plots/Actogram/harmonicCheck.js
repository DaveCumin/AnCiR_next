// The HARMONIC CHECK of an actogram marker line's tau (pure; no Svelte state).
//
// A line fitted to activity onsets can lock onto a harmonic of the real rhythm: a record
// whose onsets were detected every other cycle fits 2 tau, one with a split rhythm fits
// tau / 2. So the fitted slope is checked against the data itself: three single-period
// Lomb-Scargle evaluations, at tau, tau / 2 and 2 tau. The UI's "tau (h)" readouts and a
// marker rule's `r<id>_tau` output port are `strongest.peakPeriod` (Decision 2b of
// docs/plans/2026-09-30-actogram-marker-rules-and-outputs.md).
//
// THE FITTED tau IS KEPT UNLESS AN ALTERNATIVE CLEARS A MARGIN (review findings SPEC-5 and
// FIT-10, 2026-10-03). Power alone is the wrong judge: any waveform with two bouts per cycle
// (Drosophila morning and evening peaks, crepuscular activity) or one short bout has as much
// or more Lomb-Scargle power at tau / 2 as at tau, so the check exported 12 h from a correctly
// fitted 24 h line (bimodal, morning bout 0.6x evening: power 8.8 at tau against 115.4 at
// tau / 2; 0.8x: 1.9 against 124.0; evening at ZT9: 19.2 against 87.6), and about 12.25 h for
// 1 h bouts every 24.5 h in 6 of 20 records. No power ratio separates those from a genuine
// switch: the pinned rest-activity cases with tau fixed at 47 h must switch to 23.5 h and
// have ratios of 300 and 94, while the 0.8x bimodal case must not and has 65 (the 1 h bouts:
// about 1). A threshold would sit in a gap too narrow to trust. So the margin tests the one
// thing that does distinguish them, by nested harmonic regression:
//  - tau / 2 is eligible only when the data give NO evidence that the two halves of a tau
//    cycle differ: the F-test of tau's odd harmonics (k = 1, 3, ..., 2H - 1, given the even
//    ones, i.e. the harmonics of tau / 2) has p >= ALPHA. A bimodal or short-bout day has
//    halves that differ (p from 1e-8 down to 0 in the reviewer's cases), so tau stays.
//  - 2 tau is eligible only when the data DO show that alternate tau cycles differ: the same
//    F-test at 2 tau (its odd harmonics given tau's) has p < ALPHA.
//  - among tau and the eligible alternatives, the most Lomb-Scargle power wins, as before.
// H = min(3, floor(L / (4 * binSize))) harmonic pairs of the shorter period (so the highest
// harmonic of the longer period L stays above twice the bin), at least 1; each regression is
// fitCosinorFixed on the finite (x, y) pairs. Autocorrelated activity inflates the F-test's
// rejections, which errs toward keeping tau for tau / 2 (the conservative direction); for
// 2 tau the power condition must also hold. `powerStrongest` keeps the power-only pick, and
// tauReadout.js explains in its tooltip when the margin overrode it.
//
// Extracted from PhaseMarkerClass (Phase B) unchanged, so the Python and R ports can mirror
// it function by function; harmonicCheck.pin.svelte.test.js holds the numbers the class
// produced before the extraction.
//
// Details a port must reproduce exactly:
//  - candidates are kept only when binSize * 2 < period < dataSpan / 2, with
//    dataSpan = xData[j] - xData[i] over the first and last PRESENT samples i and j (the
//    samples' order, not their min and max; a missing end is skipped, not read as 0, see
//    harmonicCheck.missingEnds.test.js);
//  - binSize falls back to 0.25 h when it is 0, null or undefined;
//  - each evaluation is runPeriodogramCalculation with method 'Lomb-Scargle',
//    periodMin = periodMax = the candidate (margin 0) and periodSteps 0.001, so it is exactly
//    one trial period and `peakPeriod` equals `period`;
//  - an evaluation that returns no points scores power 0 at the candidate's own period;
//  - ties keep the EARLIER candidate (order tau, tau / 2, 2 tau): `b.power > a.power`;
//  - the margin above: `candidate.test` = { period: L, harmonics: 2H, F, df1: 2H,
//    df2: n - 1 - 4H, pValue } with pValue = 1 - Fcdf(F; df1, df2); a test that cannot be
//    computed (too few points, singular fit) makes its alternative INELIGIBLE; tau is always
//    eligible; `strongest` is the most powerful eligible candidate, or, when tau itself was
//    filtered out and no alternative is eligible, { label 'τ', period = peakPeriod = tau,
//    power NaN, eligible true, inRecord false } (the fitted slope, unchecked).
import { runPeriodogramCalculation } from '$lib/utils/periodogram.js';
import { validEnds } from '$lib/utils/validPairs.js';
import { fitCosinorFixed } from '$lib/utils/cosinor.js';
import { isInvalidValue } from '$lib/utils/stats.js';
import { pUpperFromF } from '$lib/utils/fdist.js';

/** Significance level of the half-cycle test that gates a switch away from the fitted tau. */
export const HARMONIC_SWITCH_ALPHA = 0.05;
const MAX_HARMONIC_PAIRS = 3;

/**
 * Do the two halves of a cycle of period L differ? F-test of L's odd harmonics given its even
 * ones (the harmonics of L / 2), by nested fixed-period cosinor regressions.
 * @param {ArrayLike<number|null>} xData  sample times (hours)
 * @param {ArrayLike<number|null>} yData  sample values
 * @param {number} L                      the longer period (hours)
 * @param {number} [binSize]              the series' bin size (0/absent: 0.25 h)
 * @returns {null | {period:number, harmonics:number, F:number, df1:number, df2:number, pValue:number}}
 */
export function halfCycleTest(xData, yData, L, binSize) {
	/** @type {number[]} */
	const t = [];
	/** @type {number[]} */
	const y = [];
	const n0 = Math.min(xData?.length ?? 0, yData?.length ?? 0);
	for (let i = 0; i < n0; i++) {
		// The house rule for a usable value (null, '', NaN and non-numeric strings are not).
		if (isInvalidValue(xData[i]) || isInvalidValue(yData[i])) continue;
		t.push(Number(xData[i]));
		y.push(Number(yData[i]));
	}
	const H = Math.max(1, Math.min(MAX_HARMONIC_PAIRS, Math.floor(L / (4 * (binSize || 0.25)))));
	const n = t.length;
	const df1 = 2 * H;
	const df2 = n - 1 - 4 * H;
	if (!(df2 > 0)) return null;
	const full = fitCosinorFixed(t, y, L, 2 * H);
	const reduced = fitCosinorFixed(t, y, L / 2, H);
	if (!full || !reduced) return null;
	const rssFull = full.RMSE ** 2 * df2;
	const rssReduced = reduced.RMSE ** 2 * (n - 1 - 2 * H);
	if (!Number.isFinite(rssFull) || !Number.isFinite(rssReduced)) return null;
	let F;
	if (rssFull > 0) F = Math.max(0, rssReduced - rssFull) / df1 / (rssFull / df2);
	else F = rssReduced > 0 ? Infinity : 0;
	const pValue = pUpperFromF(F, df1, df2);
	return { period: L, harmonics: 2 * H, F, df1, df2, pValue };
}

/**
 * @param {object} args
 * @param {ArrayLike<number>} args.xData  sample times, hours since the series start
 * @param {ArrayLike<number>} args.yData  sample values, same length
 * @param {number} [args.binSize]         the series' bin size in hours (0/absent: 0.25)
 * @param {number} args.tau               the fitted slope in hours (falsy: no check)
 * @returns {null | {
 *   candidates: Array<{ label: string, period: number, peakPeriod: number, power: number,
 *     eligible?: boolean, test?: object|null }>,
 *   strongest: { label: string, period: number, peakPeriod: number, power: number },
 *   powerStrongest: { label: string, period: number, peakPeriod: number, power: number }
 * }} null when there is no tau, no data, or no candidate inside the record. `strongest` is
 *   the pick (the most powerful ELIGIBLE candidate; the τ port); `powerStrongest` the most
 *   powerful candidate, eligible or not.
 */
export function harmonicCheck({ xData, yData, binSize, tau }) {
	if (!tau) return null;
	if (!xData?.length || !yData?.length) return null;

	const bin = binSize || 0.25;
	// First and last PRESENT samples: xData is hoursSinceStart, which keeps a missing time as
	// null, and `null - x0` made a missing LAST time a span of about 0 (no candidate at all).
	const { first, last } = validEnds(xData);
	const dataSpan = first < 0 ? NaN : Number(xData[last]) - Number(xData[first]);

	const candidates = [
		{ label: 'τ', period: tau },
		{ label: 'τ/2', period: tau / 2 },
		{ label: '2τ', period: tau * 2 }
	].filter((c) => c.period > bin * 2 && c.period < dataSpan / 2);

	if (candidates.length === 0) return null;

	const margin = 0;
	const step = 0.001;
	/**
	 * @typedef {{ label: string, period: number, peakPeriod: number, power: number,
	 *   eligible?: boolean, test?: ReturnType<typeof halfCycleTest>, inRecord?: boolean }} Candidate
	 */
	/** @type {Candidate[]} */
	const results = candidates.map((c) => {
		const result = runPeriodogramCalculation({
			xData,
			yData,
			binSize: bin,
			method: 'Lomb-Scargle',
			chiSquaredAlpha: 0.05,
			periodMin: c.period - margin,
			periodMax: c.period + margin,
			periodSteps: step
		});
		if (!result.y.length) return { ...c, peakPeriod: c.period, power: 0 };
		const peakIdx = result.y.indexOf(Math.max(...result.y));
		return { ...c, peakPeriod: result.x[peakIdx], power: result.y[peakIdx] };
	});

	// The margin (see the header): tau always; tau / 2 only if tau's halves do not differ;
	// 2 tau only if alternate tau cycles do.
	for (const c of results) {
		if (c.label === 'τ') {
			c.eligible = true;
			continue;
		}
		const L = c.label === 'τ/2' ? tau : 2 * tau;
		c.test = halfCycleTest(xData, yData, L, bin);
		const p = c.test?.pValue;
		c.eligible =
			typeof p === 'number' &&
			Number.isFinite(p) &&
			(c.label === 'τ/2' ? p >= HARMONIC_SWITCH_ALPHA : p < HARMONIC_SWITCH_ALPHA);
	}
	/** @param {Candidate[]} list */
	const pick = (list) => list.reduce((a, b) => (b.power > a.power ? b : a));
	const eligible = results.filter((c) => c.eligible);
	// tau itself can fall outside the record (2 tau > span) while tau / 2 is inside it; if tau / 2
	// then fails its margin, nothing is eligible and the pick is the fitted tau, unchecked.
	const strongest = eligible.length
		? pick(eligible)
		: { label: 'τ', period: tau, peakPeriod: tau, power: NaN, eligible: true, inRecord: false };
	const powerStrongest = pick(results);
	return { candidates: results, strongest, powerStrongest };
}
