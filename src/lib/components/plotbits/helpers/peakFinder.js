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
