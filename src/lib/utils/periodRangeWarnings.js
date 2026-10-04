// @ts-nocheck
// The free-period fits (Cosinor, Rectangular wave, Double logistic) refuse an empty period
// range (min >= max, or a range lying entirely below the Nyquist period of the sampling).
// This says why, instead of leaving the panel blank. Same text as Cosinor.svelte's own copy
// (added there in v77); shared here for the two waveform nodes (review finding FIT-1).
import { FREE_PERIOD_DEFAULTS, resolvePeriodRange } from './cosinor.js';

/**
 * @param {Array<number|null>} t  the fit's x in hours (hoursSinceStart for a time column)
 * @param {number} minPeriod
 * @param {number} maxPeriod
 * @returns {string[]}
 */
export function periodRangeWarnings(t, minPeriod, maxPeriod) {
	const lo = Number(minPeriod ?? FREE_PERIOD_DEFAULTS.minPeriod);
	const hi = Number(maxPeriod ?? FREE_PERIOD_DEFAULTS.maxPeriod);
	if (!(lo > 0 && hi > lo)) {
		return [
			`Period range ${lo} to ${hi} h is empty: the minimum period must be above 0 and below the maximum. Set a range that contains the rhythm you expect (default ${FREE_PERIOD_DEFAULTS.minPeriod} to ${FREE_PERIOD_DEFAULTS.maxPeriod} h).`
		];
	}
	const finite = (t ?? []).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
	if (finite.length >= 2 && !resolvePeriodRange(finite, lo, hi)) {
		return [
			`Period range ${lo} to ${hi} h lies below what the sampling can resolve (the shortest resolvable period is twice the sampling interval). Raise the maximum period.`
		];
	}
	return [];
}
