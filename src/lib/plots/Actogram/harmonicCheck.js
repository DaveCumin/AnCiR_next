// The HARMONIC CHECK of an actogram marker line's tau (pure; no Svelte state).
//
// A line fitted to activity onsets can lock onto a harmonic of the real rhythm: a record
// whose onsets were detected every other cycle fits 2 tau, one with a split rhythm fits
// tau / 2. So the fitted slope is checked against the data itself: three single-period
// Lomb-Scargle evaluations, at tau, tau / 2 and 2 tau, and the candidate with the most
// power wins. The UI's "tau (h)" readouts and a marker rule's `r<id>_tau` output port are
// `strongest.peakPeriod` (Decision 2b of docs/plans/2026-09-30-actogram-marker-rules-and-outputs.md).
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
//  - ties keep the EARLIER candidate (order tau, tau / 2, 2 tau): `b.power > a.power`.
import { runPeriodogramCalculation } from '$lib/utils/periodogram.js';
import { validEnds } from '$lib/utils/validPairs.js';

/**
 * @param {object} args
 * @param {ArrayLike<number>} args.xData  sample times, hours since the series start
 * @param {ArrayLike<number>} args.yData  sample values, same length
 * @param {number} [args.binSize]         the series' bin size in hours (0/absent: 0.25)
 * @param {number} args.tau               the fitted slope in hours (falsy: no check)
 * @returns {null | {
 *   candidates: Array<{ label: string, period: number, peakPeriod: number, power: number }>,
 *   strongest: { label: string, period: number, peakPeriod: number, power: number }
 * }} null when there is no tau, no data, or no candidate inside the record
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

	const strongest = results.reduce((a, b) => (b.power > a.power ? b : a));
	return { candidates: results, strongest };
}
