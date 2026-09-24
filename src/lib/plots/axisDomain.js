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

/**
 * Widen [min, max] just enough that a mark `padPx` wide at either end of a `lengthPx` axis
 * stays inside the plot area.
 *
 * For plots whose domain is the data's exact range (the scatterplot): a point at the maximum
 * sits ON the edge, so half of its marker is drawn outside the plot area, over the axis or
 * the margin. Solving for the span S' whose px-per-unit leaves `padPx` at each end:
 * S' = S / (1 - 2 padPx / lengthPx). The pad is capped at a quarter of the axis, so a tiny
 * plot with a large marker is not squeezed to nothing. On a log axis the same is done in
 * log space. Non-finite input is returned unchanged.
 *
 * @param {number} min
 * @param {number} max
 * @param {number} padPx
 * @param {number} lengthPx
 * @param {{log?: boolean}} [opts]
 * @returns {[number, number]}
 */
export function markerPaddedDomain(min, max, padPx, lengthPx, { log = false } = {}) {
	if (!Number.isFinite(min) || !Number.isFinite(max)) return [min, max];
	if (!(padPx > 0) || !(lengthPx > 0)) return [min, max];
	const f = Math.min(padPx / lengthPx, 0.25);
	const widen = (lo, hi) => {
		const span = hi - lo || Math.abs(hi) || 1;
		const extra = (span / (1 - 2 * f) - span) / 2;
		return [lo - extra, hi + extra];
	};
	if (log) {
		if (!(min > 0) || !(max > 0)) return [min, max];
		const [a, b] = widen(Math.log10(min), Math.log10(max));
		return [10 ** a, 10 ** b];
	}
	return widen(min, max);
}

/**
 * Keep a NICE domain, but never let the data sit on (or within `gapPx` of) an automatic end.
 *
 * For plots whose domain is rounded to nice numbers (boxplot, Mean +/- SEM): usually the
 * rounding leaves room, but when the data minimum is itself close to a round number the
 * lowest whisker cap is drawn ON the x axis line. Only an end that is too close moves, and
 * only by the minimum that restores the gap, so the ticks and every other domain stay as
 * they were. An end the user set (`autoLo` / `autoHi` false) is never moved.
 *
 * @param {[number, number]} domain the rounded [lo, hi]
 * @param {number} min data minimum
 * @param {number} max data maximum
 * @param {number} gapPx wanted clearance at each end, px
 * @param {number} lengthPx axis length, px
 * @param {{autoLo?: boolean, autoHi?: boolean}} [opts]
 * @returns {[number, number]}
 */
export function clearEnds(
	[lo, hi],
	min,
	max,
	gapPx,
	lengthPx,
	{ autoLo = true, autoHi = true } = {}
) {
	if (![lo, hi, min, max].every(Number.isFinite) || !(hi > lo)) return [lo, hi];
	const L = lengthPx;
	const g = Math.min(gapPx, L / 4);
	if (!(g > 0) || !(L > 0)) return [lo, hi];
	const px = (v, a, b) => ((v - a) / (b - a)) * L;
	// Solving (min - lo') / (hi - lo') * L = g for lo', and likewise for hi'. Two passes,
	// because widening one end shrinks the px-per-unit at the other.
	for (let pass = 0; pass < 2; pass++) {
		if (autoLo && px(min, lo, hi) < g) lo = (min * L - g * hi) / (L - g);
		if (autoHi && L - px(max, lo, hi) < g) hi = (max * L - g * lo) / (L - g);
	}
	return [lo, hi];
}
