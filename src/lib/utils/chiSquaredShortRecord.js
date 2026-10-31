// @ts-nocheck
/**
 * The chi-squared periodogram's short-record warning (decision 2026-11-01: the test is not
 * changed; the user is told).
 *
 * The test refers Qp = N x SS_between / SS_total to chi-square(P - 1). For i.i.d. normal data
 * SS_between / SS_total is exactly Beta((P - 1) / 2, (N - P) / 2), so Qp is bounded by N and
 * its tail is lighter than the chi-square's: the test is conservative, and the fewer cycles
 * the record holds, the more so (periodogram.shortRecordSize.test.js). The exact pointwise
 * size of the nominal 5% cut-off depends almost only on the number of cycles K = N / P
 * (scipy beta.sf, P from 6 to 144 bins per cycle):
 *
 *     K = 3: 0.022 to 0.026    K = 5: 0.033 to 0.039    K = 7: 0.038 to 0.043
 *     K = 10: 0.042 to 0.046   K = 14: 0.044 to 0.047   K = 30: 0.047 to 0.049
 *
 * and the Sidak line across the tested periods makes the family-wise rate far lower still
 * (about 0.002 on 3 days of hourly white noise, where 0.05 is nominal). Below 7 cycles the
 * pointwise size is under about four fifths of nominal at the usual 12 to 144 bins per cycle,
 * so that is where the warning starts. The cycles are counted at the LONGEST period tested,
 * where the test is weakest, so the warning does not depend on where the peak happens to fall.
 *
 * The record length is the span of the valid times plus one median sampling interval (72
 * hourly samples are 3 days), or, for a moving window, the window length.
 *
 * tools/ancir_runtime.py and tools/ancir_runtime.R chi_squared_short_record_warning print the
 * same text.
 */
import { medianSamplingInterval } from './periodogram.js';
import { isInvalidValue } from './stats.js';

/** Below this many cycles of the longest period tested, the warning shows. */
export const CHI_SQUARED_MIN_CYCLES = 7;

/** A number as the warning prints it: at most one decimal, no trailing zero. */
function fmt(v) {
	return String(Number(v.toFixed(1)));
}

/**
 * The record length a periodogram sees: the span of the valid times plus one median sampling
 * interval. NaN with fewer than two distinct times.
 * @param {ArrayLike<any>} times
 */
export function recordLength(times) {
	let lo = Infinity;
	let hi = -Infinity;
	for (let i = 0; i < (times?.length ?? 0); i++) {
		if (isInvalidValue(times[i])) continue;
		const v = Number(times[i]); // Number-ok: checked with isInvalidValue on the line above
		if (!Number.isFinite(v)) continue;
		if (v < lo) lo = v;
		if (v > hi) hi = v;
	}
	const dt = medianSamplingInterval(times);
	if (!(hi > lo) || !Number.isFinite(dt)) return NaN;
	return hi - lo + dt;
}

/**
 * The warning text, or '' when the record is long enough (or nothing can be said).
 * @param {object} o
 * @param {number} o.length      record (or window) length in the x units, which are hours on a time x
 * @param {number} o.periodMax   the longest period tested, same units
 * @param {boolean} [o.hours]    x is a time column (lengths in hours, so days can be named)
 * @param {boolean} [o.perWindow] the length is a moving window's
 * @returns {string}
 */
export function chiSquaredShortRecordWarning({
	length,
	periodMax,
	hours = true,
	perWindow = false
}) {
	const L = Number(length);
	const P = Number(periodMax);
	if (!(L > 0) || !(P > 0) || !Number.isFinite(L) || !Number.isFinite(P)) return '';
	const cycles = L / P;
	if (cycles >= CHI_SQUARED_MIN_CYCLES) return '';
	const what = perWindow ? 'each window holding' : '';
	const c = fmt(cycles);
	const nCycles = `${c} ${c === '1' ? 'cycle' : 'cycles'}`;
	const tested = `the longest period tested, ${fmt(P)}${hours ? ' h' : ''}`;
	let lead;
	if (!hours) {
		lead = perWindow
			? `With ${what} only ${nCycles} of ${tested}`
			: `With only ${nCycles} of ${tested}`;
	} else {
		const days = fmt(L / 24);
		const d = `${days} ${days === '1' ? 'day' : 'days'}`;
		lead = perWindow
			? `With ${what} only ${d} of data (${nCycles} of ${tested})`
			: `With only ${d} of data (${nCycles} of ${tested})`;
	}
	return (
		`${lead}, the chi-squared test is very conservative and can miss a rhythm that is there; ` +
		`consider Lomb-Scargle or a longer ${perWindow ? 'window' : 'record'} (at least ` +
		`${CHI_SQUARED_MIN_CYCLES} cycles).`
	);
}
