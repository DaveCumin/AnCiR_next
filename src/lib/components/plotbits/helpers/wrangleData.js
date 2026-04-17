import { KahanSum, kahanMean } from '$lib/utils/numerics.js';

//Bin data in binSize bins starting at binStart - takes the average y-value and returns the starting x positions
export function binData(
	xValues,
	yValues,
	binSize,
	binStart = 0,
	stepSize = null,
	aggFunc = 'mean'
) {
	const n = xValues.length;

	if (n === 0) return { bins: [], y_out: [] };

	const step = stepSize > 0 ? stepSize : binSize;
	if (!(step > 0) || !isFinite(step)) return { bins: [], y_out: [] };

	// Pair and sort by x once
	const paired = xValues.map((x, i) => ({ x, y: yValues[i] })).sort((a, b) => a.x - b.x);

	const xs = paired.map((p) => p.x);
	const ys = paired.map((p) => p.y);

	const aggFunctions = {
		mean: (arr, start, end) => {
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

	const bins = [];
	const y_out = [];

	let currentStart = binStart;

	const EPSILON = 1e-10;
	let binIndex = 0;
	let pointer = 0; // tracks position in xs array (assumes sorted, per above)

	while (true) {
		const binEnd = currentStart + binSize;

		bins.push(currentStart);

		// Advance pointer to find start of this bin
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

	return { bins, y_out };
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

//Calculate mean
export function mean(data) {
	return kahanMean(data);
}

//Calculate min and max
export function min(data) {
	let out = Infinity;
	for (let i = 0; i < data.length; i++) {
		if (data[i] !== undefined && !isNaN(data[i]) && data[i] < out) {
			out = data[i];
		}
	}
	return out === Infinity ? null : out;
}

export function max(data) {
	let out = -Infinity;
	for (let i = 0; i < data.length; i++) {
		if (data[i] !== undefined && !isNaN(data[i]) && data[i] > out) {
			out = data[i];
		}
	}
	return out === -Infinity ? null : out;
}

//DO MIN AND MAX TOGETHER TO SAVE COMPUTATION TIME
export function minMax(data) {
	let minVal = Infinity;
	let maxVal = -Infinity;
	for (let i = 0; i < data.length; i++) {
		if (data[i] !== undefined && !isNaN(data[i])) {
			if (data[i] < minVal) {
				minVal = data[i];
			}
			if (data[i] > maxVal) {
				maxVal = data[i];
			}
		}
	}
	return { min: minVal === Infinity ? null : minVal, max: maxVal === -Infinity ? null : maxVal };
}
