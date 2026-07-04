// @ts-nocheck
// Sample statistics (n-1 variance) for the hypothesis-test nodes. These differ
// from stats.js on purpose:
//   - stats.js uses the POPULATION denominator (÷n) and filters null/NaN,
//     returning null for empty input — right for plot ranges/means.
//   - these use the SAMPLE denominator (÷(n-1)) and assume the caller has
//     already cleaned the array, returning NaN for empty/insufficient input —
//     what ANOVA / t-tests (GroupComparison) require.
// Keep the two families separate; do not "unify" them or the statistics change.

/** Arithmetic mean; NaN for empty. Assumes a pre-cleaned numeric array. */
export function mean(arr) {
	if (!arr.length) return NaN;
	return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** Unbiased sample variance (÷(n-1)); NaN for fewer than 2 values. */
export function sampleVariance(arr) {
	if (arr.length < 2) return NaN;
	const m = mean(arr);
	let ss = 0;
	for (const x of arr) ss += (x - m) ** 2;
	return ss / (arr.length - 1);
}

/** Sample standard deviation (sqrt of sampleVariance); NaN when undefined. */
export function sampleStd(arr) {
	const v = sampleVariance(arr);
	return Number.isFinite(v) ? Math.sqrt(v) : NaN;
}

/** Median; NaN for empty. Assumes a pre-cleaned numeric array. */
export function median(arr) {
	if (!arr.length) return NaN;
	const sorted = [...arr].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
