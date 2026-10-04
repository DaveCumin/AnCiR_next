// @ts-nocheck
// Peak detection shared by the spectral plots (FFT, Periodogram, Correlogram).
// Each of those finds the index of the maximum value in an array — either over
// the whole array (from an optional start offset, e.g. Correlogram skips lag 0)
// or over a pre-filtered set of visible indices. These two helpers are that
// argmax; the plot keeps the domain-specific mapping from index → { period, … }.

/**
 * Index of the maximum value in `values`, scanning from `startIndex` to the end.
 * @param {number[]} values
 * @param {number} [startIndex=0]
 * @returns {number} the winning index, or -1 if the range is empty
 */
export function argMax(values, startIndex = 0) {
	if (!values || values.length <= startIndex) return -1;
	let maxIdx = startIndex;
	for (let i = startIndex + 1; i < values.length; i++) {
		if (values[i] > values[maxIdx]) maxIdx = i;
	}
	return maxIdx;
}

/**
 * Index (into `values`) of the maximum value among `candidateIndices`. Used for
 * the visible-range peak, where the caller has already filtered the indices that
 * fall inside the current x-axis window.
 * @param {number[]} values
 * @param {number[]} candidateIndices
 * @returns {number} the winning index, or -1 if there are no candidates
 */
export function argMaxAmong(values, candidateIndices) {
	if (!values || !candidateIndices || candidateIndices.length === 0) return -1;
	let maxIdx = candidateIndices[0];
	for (let i = 1; i < candidateIndices.length; i++) {
		const idx = candidateIndices[i];
		if (values[idx] > values[maxIdx]) maxIdx = idx;
	}
	return maxIdx;
}

/**
 * Index of the spectral PEAK: the largest finite power, optionally among
 * `candidateIndices`, or -1 when there is no peak to report.
 *
 * Differs from argMax in two ways that matter for a periodogram or a magnitude
 * spectrum (never for a correlogram, whose values can be negative):
 *  - non-finite entries are skipped, so a NaN at index 0 cannot win by default;
 *  - a maximum that is not positive is NO peak. Constant or all-zero data has zero
 *    power at every period, and argMax then returned index 0, so a flat recording was
 *    reported as rhythmic at the shortest trial period (MovingAnalysis gave 18 h on
 *    off-wrist windows; ROB-13).
 *
 * @param {number[]} values  powers (or magnitudes), >= 0 when defined
 * @param {number[]} [candidateIndices]  restrict the search (e.g. the visible range)
 * @returns {number}
 */
export function spectralPeakIndex(values, candidateIndices) {
	if (!values) return -1;
	let best = -1;
	const consider = (i) => {
		const v = values[i];
		if (Number.isFinite(v) && v > 0 && (best < 0 || v > values[best])) best = i;
	};
	if (candidateIndices) for (const i of candidateIndices) consider(i);
	else for (let i = 0; i < values.length; i++) consider(i);
	return best;
}
