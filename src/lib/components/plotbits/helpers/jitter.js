// Deterministic horizontal jitter for overlaying raw data points on a boxplot.
//
// Plots re-render constantly (any $state touch) and exports must be reproducible
// across save/load, so Math.random() per render is out: the points would crawl on
// every frame and every reopened session would look different. Instead each point's
// offset is a pure hash of WHERE it sits (series, category, point index) — same
// data, same jitter, forever.
//
// The mix is mulberry32's finalizer over an xor-folded seed. It only has to look
// uniform to the eye, not survive cryptanalysis.

/**
 * Deterministic pseudo-random offset in [-1, 1) for one data point.
 *
 * @param {number} seriesIndex - index of the data series within the plot
 * @param {number} categoryIndex - index of the point's x category
 * @param {number} pointIndex - index of the point within its category
 * @returns {number} offset fraction in [-1, 1); multiply by (half box width × jitter amount)
 */
export function jitterOffset(seriesIndex, categoryIndex, pointIndex) {
	// Fold the three indices into one 32-bit seed. The +1s keep index 0 from
	// zeroing out its term; the constants are the usual avalanche primes.
	let h =
		(Math.imul(seriesIndex + 1, 0x9e3779b9) ^
			Math.imul(categoryIndex + 1, 0x85ebca6b) ^
			Math.imul(pointIndex + 1, 0xc2b2ae35)) >>>
		0;

	// mulberry32-style finalizer
	h = Math.imul(h ^ (h >>> 15), h | 1);
	h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
	h = (h ^ (h >>> 14)) >>> 0;

	return (h / 4294967296) * 2 - 1;
}
