// @ts-nocheck
// Automatic value-axis domains with room at the ends.
//
// Every line plot draws its series inside a clipPath the exact size of the plot area
// (Line.svelte). A domain that ends EXACTLY at the data maximum therefore puts the highest
// point on the clip edge, and half the stroke (a 4 to 8 px periodogram line) is cut off: the
// peak reads as flat-topped. The periodogram did exactly that (`Math.ceil(max)`), and it also
// ignored its own significance threshold, so a threshold above the data could leave the plot
// entirely.
//
// The fix is shared rather than per plot: pad the extent by a fraction of its span, then
// optionally round outward to tick values ("nice"), so the top of the axis carries a labelled
// tick rather than stopping at an arbitrary number just above the peak.
import { scaleLinear } from 'd3-scale';

/**
 * @param {number} min smallest value that must be visible
 * @param {number} max largest value that must be visible
 * @param {object} [opts]
 * @param {number} [opts.pad] fraction of the span added at each end (default 0.05)
 * @param {number} [opts.lowerBound] the domain never starts below this (e.g. 0 for power),
 *   applied only when the data themselves are not below it
 * @param {number} [opts.upperBound] the domain never ends above this, likewise
 * @param {number|null} [opts.nice] round outward to this many ticks' worth of nice values
 *   (d3 `nice`); null or 0 leaves the padded ends as they are
 * @returns {[number, number]}
 */
export function paddedDomain(
	min,
	max,
	{ pad = 0.05, lowerBound = -Infinity, upperBound = Infinity, nice = null } = {}
) {
	if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
	if (min > max) [min, max] = [max, min];

	// A flat series has no span to take a fraction of; use its magnitude instead so a
	// constant 50 gets a visible band rather than a zero-height domain.
	const span = max - min || Math.abs(max) || 1;
	let lo = min - span * pad;
	let hi = max + span * pad;

	// A bound only applies when the data respect it. Power cannot be negative, so a
	// periodogram whose minimum is 0 must start AT 0, not at -5% of the peak; but if the data
	// somehow cross the bound, showing them wins over the bound.
	if (min >= lowerBound) lo = Math.max(lo, lowerBound);
	if (max <= upperBound) hi = Math.min(hi, upperBound);

	if (nice) {
		const [nlo, nhi] = scaleLinear().domain([lo, hi]).nice(nice).domain();
		lo = min >= lowerBound ? Math.max(nlo, lowerBound) : nlo;
		hi = max <= upperBound ? Math.min(nhi, upperBound) : nhi;
	}
	return [lo, hi];
}

/**
 * Min and max over several arrays, skipping null, NaN and infinities.
 *
 * @param {Array<ArrayLike<number>|null|undefined>} arrays
 * @returns {{min: number|null, max: number|null}}
 */
export function finiteExtent(arrays) {
	let min = Infinity;
	let max = -Infinity;
	for (const arr of arrays) {
		if (!arr) continue;
		for (let i = 0; i < arr.length; i++) {
			const v = arr[i];
			if (typeof v !== 'number' || !Number.isFinite(v)) continue;
			if (v < min) min = v;
			if (v > max) max = v;
		}
	}
	return min === Infinity ? { min: null, max: null } : { min, max };
}
