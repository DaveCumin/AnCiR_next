// @ts-nocheck
// The sampling interval of a time column: the median gap, and the step of a (mostly) regular
// record. Kept apart from periodogram.js so the moving-window starts (movinganalysis.js) can
// use it without pulling in the periodogram (whose tests mock that module).
import { isInvalidValue } from './stats.js';

/**
 * The series' median sampling interval: the median of the positive gaps between consecutive
 * valid times (sorted; repeated times are not a gap). NaN with fewer than two distinct times.
 *
 * The default bin size of a NEW binned periodogram (Chi-squared or Enright), so that one
 * bin holds one sample: a bin narrower than the sampling leaves most bins empty, a wider one
 * averages samples together (SPEC-8). The Periodogram plot's data warnings compare the bin
 * size against the same number.
 *
 * @param {ArrayLike<any>} times
 * @returns {number}
 */
export function medianSamplingInterval(times) {
	const xs = [];
	for (let i = 0; i < (times?.length ?? 0); i++) {
		if (isInvalidValue(times[i])) continue;
		const v = Number(times[i]); // Number-ok: checked with isInvalidValue on the line above
		if (Number.isFinite(v)) xs.push(v);
	}
	xs.sort((a, b) => a - b);
	const gaps = [];
	for (let i = 1; i < xs.length; i++) if (xs[i] > xs[i - 1]) gaps.push(xs[i] - xs[i - 1]);
	if (gaps.length === 0) return NaN;
	gaps.sort((a, b) => a - b);
	const mid = Math.floor(gaps.length / 2);
	return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

/**
 * The sampling step of a (mostly) regular record: the mean of the gaps within 10% of the
 * median gap (medianSamplingInterval). Rounding errors in consecutive stored times cancel in
 * the sum, so for rounded times this is the true step to ~1e-7, where the median of the
 * rounded gaps (0.0167 h for 1-min data written to 4 dp) is 0.2% off and walks a long record
 * off its own grid. The median when no gap is near it; NaN with fewer than two distinct times. Mirrored in
 * tools/ancir_runtime.py (sampling_step) and tools/ancir_runtime.R (sampling_step).
 *
 * @param {ArrayLike<any>} times
 * @returns {number}
 */
export function samplingStep(times) {
	const xs = [];
	for (let i = 0; i < (times?.length ?? 0); i++) {
		if (isInvalidValue(times[i])) continue;
		const v = Number(times[i]); // Number-ok: checked with isInvalidValue on the line above
		if (Number.isFinite(v)) xs.push(v);
	}
	const median = medianSamplingInterval(xs);
	if (!(median > 0)) return NaN;
	xs.sort((a, b) => a - b);
	let sum = 0;
	let count = 0;
	for (let i = 1; i < xs.length; i++) {
		const gap = xs[i] - xs[i - 1];
		if (Math.abs(gap - median) <= 0.1 * median) {
			sum += gap;
			count++;
		}
	}
	// No gap near the median (two interleaved spacings, 0.25 / 0.75 h: the median is 0.5 h,
	// which no gap is near): the median itself.
	return count > 0 ? sum / count : median;
}
