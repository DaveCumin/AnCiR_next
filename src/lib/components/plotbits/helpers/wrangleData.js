import { KahanSum } from '$lib/utils/numerics.js';
export { min, max, minMax, mean } from '$lib/utils/stats.js';

//Bin data in binSize bins starting at binStart - takes the average y-value and returns the starting x positions
//
// When `cuts` is a sorted ascending array of length >= 2, edges define non-uniform
// bins: bin i spans [cuts[i], cuts[i+1]) for i < n-2 and [cuts[n-2], cuts[n-1]] for
// the final bin (right-inclusive on the last edge only). `binSize`/`binStart`/
// `stepSize` are ignored in cuts mode.
//
// `aggFunc='count'` returns the number of finite x/y rows landing in each bin and
// ignores y values; callers histogramming a single column can pass it for both x
// and y.
//
// Return shape: { bins, binEnds, y_out, droppedCount }. `binEnds[i]` is the
// exclusive (or right-inclusive on the final cuts bin) right edge so consumers
// like Hist.svelte can render variable-width bars without re-deriving widths.
// `droppedCount` is finite x/y rows that fall outside the bin range — below
// `binStart`/`cuts[0]` or above `cuts[n-1]` in cuts mode.
export function binData(
	xValues,
	yValues,
	binSize,
	binStart = 0,
	stepSize = null,
	aggFunc = 'mean',
	cuts = null
) {
	const useCuts = Array.isArray(cuts) && cuts.length >= 2;

	if (!xValues || xValues.length === 0) {
		return { bins: [], binEnds: [], y_out: [], droppedCount: 0 };
	}

	if (useCuts) {
		// Reject non-strictly-ascending cuts; caller (TP) is responsible for sort+dedupe
		for (let i = 1; i < cuts.length; i++) {
			if (!(cuts[i] > cuts[i - 1])) {
				return { bins: [], binEnds: [], y_out: [], droppedCount: 0 };
			}
		}
	} else {
		const step = stepSize > 0 ? stepSize : binSize;
		if (!(step > 0) || !isFinite(step)) {
			return { bins: [], binEnds: [], y_out: [], droppedCount: 0 };
		}
	}

	// Pair, drop non-finite x/y values (e.g. NaN from failed time parses), then sort by x
	const paired = xValues
		.map((x, i) => ({ x, y: yValues[i] }))
		.filter((p) => isFinite(p.x) && isFinite(p.y))
		.sort((a, b) => a.x - b.x);

	const n = paired.length;
	if (n === 0) {
		return { bins: [], binEnds: [], y_out: [], droppedCount: 0 };
	}

	const xs = paired.map((p) => p.x);
	const ys = paired.map((p) => p.y);

	const aggFunctions = {
		count: (arr, start, end) => end - start,
		mean: (arr, start, end) => {
			if (end - start === 0) return NaN;
			let sum = 0;
			for (let i = start; i < end; i++) sum += arr[i];
			return sum / (end - start);
		},
		min: (arr, start, end) => {
			const s = start === -1 ? n : start;
			const e = end === -1 ? n : end;
			let out = Infinity;
			for (let i = s; i < e; i++) {
				if (arr[i] !== undefined && !isNaN(arr[i]) && arr[i] < out) {
					out = arr[i];
				}
			}
			return out === Infinity ? null : out;
		},
		max: (arr, start, end) => {
			const s = start === -1 ? n : start;
			const e = end === -1 ? n : end;
			let out = -Infinity;
			for (let i = s; i < e; i++) {
				if (arr[i] !== undefined && !isNaN(arr[i]) && arr[i] > out) {
					out = arr[i];
				}
			}
			return out === -Infinity ? null : out;
		},
		median: (arr, start, end) => {
			const slice = arr.slice(start, end);
			slice.sort((a, b) => a - b);
			const mid = Math.floor(slice.length / 2);
			return slice.length % 2 === 0 ? (slice[mid - 1] + slice[mid]) / 2 : slice[mid];
		},
		stddev: (arr, start, end) => {
			if (end - start < 2) return 0;
			const mean = aggFunctions.mean(arr, start, end);
			let sumSq = 0;
			for (let i = start; i < end; i++) {
				const diff = arr[i] - mean;
				sumSq += diff * diff;
			}
			return Math.sqrt(sumSq / (end - start - 1));
		}
	};

	const func = aggFunctions[aggFunc] || aggFunctions.mean;
	const EPSILON = 1e-10;

	if (useCuts) {
		const numBins = cuts.length - 1;
		const bins = new Array(numBins);
		const binEnds = new Array(numBins);
		const y_out = new Array(numBins);
		let droppedCount = 0;

		// Skip points below the first cut
		let pointer = 0;
		while (pointer < n && xs[pointer] < cuts[0] - EPSILON) {
			pointer++;
			droppedCount++;
		}

		for (let i = 0; i < numBins; i++) {
			bins[i] = cuts[i];
			binEnds[i] = cuts[i + 1];

			const startIdx = pointer;
			let endIdx = startIdx;
			if (i === numBins - 1) {
				// Final bin: right-inclusive on cuts[n-1]
				while (endIdx < n && xs[endIdx] <= cuts[i + 1] + EPSILON) endIdx++;
			} else {
				while (endIdx < n && xs[endIdx] < cuts[i + 1] - EPSILON) endIdx++;
			}

			y_out[i] = func(ys, startIdx, endIdx);
			pointer = endIdx;
		}

		// Anything past the last cut is out-of-range
		droppedCount += n - pointer;

		return { bins, binEnds, y_out, droppedCount };
	}

	// ── uniform mode (existing behaviour, with binEnds + droppedCount added) ──
	const step = stepSize > 0 ? stepSize : binSize;
	const bins = [];
	const binEnds = [];
	const y_out = [];
	let droppedCount = 0;

	let currentStart = binStart;
	let binIndex = 0;
	let pointer = 0; // tracks position in xs array (assumes sorted, per above)

	// Count points below binStart as dropped (one-time, before first bin)
	while (pointer < n && xs[pointer] < currentStart - EPSILON) {
		pointer++;
		droppedCount++;
	}

	while (true) {
		const binEnd = currentStart + binSize;

		bins.push(currentStart);
		binEnds.push(binEnd);

		// Advance pointer to find start of this bin (re-runs in overlap mode where
		// currentStart may move ahead of pointer between iterations)
		while (pointer < n && xs[pointer] < currentStart - EPSILON) pointer++;

		// Collect all points in this bin [currentStart, binEnd)
		const startIdx = pointer;
		let endIdx = startIdx;
		while (endIdx < n && xs[endIdx] < binEnd - EPSILON) endIdx++;

		y_out.push(func(ys, startIdx, endIdx));

		if (!isFinite(xs[n - 1]) || currentStart >= xs[n - 1]) break;

		binIndex++;
		currentStart = binStart + binIndex * step;
	}

	return { bins, binEnds, y_out, droppedCount };
}

/// Make a sequential array
export function makeSeqArray(from, to, step) {
	let out = [];
	for (let i = from; i <= to; i += step) {
		out.push(i);
	}
	return out;
}

////Perform a linear regression

export function linearRegression(x, y) {
	const n = x.length;

	if (n !== y.length || n === 0) {
		throw new Error('Input arrays must have the same non-zero length');
	}

	const kX = new KahanSum();
	const kY = new KahanSum();
	const kXY = new KahanSum();
	const kXX = new KahanSum();

	for (let i = 0; i < n; i++) {
		kX.add(x[i]);
		kY.add(y[i]);
		kXY.add(x[i] * y[i]);
		kXX.add(x[i] * x[i]);
	}

	const sumX = kX.value;
	const sumY = kY.value;
	const sumXY = kXY.value;
	const sumXSquare = kXX.value;

	const slope = (n * sumXY - sumX * sumY) / (n * sumXSquare - sumX * sumX);
	const intercept = (sumY - slope * sumX) / n;

	// Calculate R-squared and rmse
	const kSSTot = new KahanSum();
	const kSSRes = new KahanSum();
	const meanY = sumY / n;

	for (let i = 0; i < n; i++) {
		const predictedY = slope * x[i] + intercept;
		kSSTot.add((y[i] - meanY) ** 2);
		kSSRes.add((y[i] - predictedY) ** 2);
	}

	const rSquared = 1 - kSSRes.value / kSSTot.value;
	const rmse = Math.sqrt(kSSRes.value / n);

	return { slope, intercept, rSquared, rmse };
}

//----
export function removeNullsFromXY(x, y) {
	let outX = [];
	let outY = [];
	for (let i = 0; i < x.length; i++) {
		if (x[i] !== null && y[i] !== null && !isNaN(x[i]) && !isNaN(y[i])) {
			outX.push(x[i]);
			outY.push(y[i]);
		}
	}
	return [outX, outY];
}
