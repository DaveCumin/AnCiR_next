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
	if (n === 0 || n !== yValues.length) return { bins: [], y_out: [] };

	const step = stepSize > 0 ? stepSize : binSize;

	// Pair and sort by x once — O(N log N)
	const paired = xValues.map((x, i) => ({ x, y: yValues[i] })).sort((a, b) => a.x - b.x);

	const xs = paired.map((p) => p.x);
	const ys = paired.map((p) => p.y);

	const aggFunctions = {
		mean: (arr, start, end) => {
			let sum = 0;
			for (let i = start; i < end; i++) sum += arr[i];
			return sum / (end - start);
		},
		min: (arr, start, end) => Math.min(...arr.slice(start, end)),
		max: (arr, start, end) => Math.max(...arr.slice(start, end)),
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

	while (true) {
		const binEnd = currentStart + binSize;

		bins.push(currentStart);
		const start = xs.findIndex((x) => x >= currentStart);
		const end = xs.findIndex((x) => x >= binEnd);
		y_out.push(func(ys, start === -1 ? n : start, end === -1 ? n : end));

		// Stop if next bin cannot contain any data
		if (currentStart >= xs[n - 1]) break;

		currentStart += step;

		// Early exit if we've passed all data
		if (currentStart + binSize >= xs[xs.length - 1]) break;
	}

	console.log('bins: ', bins);
	console.log('y', y_out);
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

	let sumX = 0;
	let sumY = 0;
	let sumXY = 0;
	let sumXSquare = 0;

	for (let i = 0; i < n; i++) {
		sumX += x[i];
		sumY += y[i];
		sumXY += x[i] * y[i];
		sumXSquare += x[i] * x[i];
	}

	const slope = (n * sumXY - sumX * sumY) / (n * sumXSquare - sumX * sumX);
	const intercept = (sumY - slope * sumX) / n;

	// Calculate R-squared and rmse
	let ssTotal = 0;
	let ssResidual = 0;
	const meanY = sumY / n;

	for (let i = 0; i < n; i++) {
		const predictedY = slope * x[i] + intercept;
		ssTotal += (y[i] - meanY) ** 2;
		ssResidual += (y[i] - predictedY) ** 2;
	}

	const rSquared = 1 - ssResidual / ssTotal;
	const rmse = Math.sqrt(ssResidual / n);

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
	let sum = 0;
	let count = 0;
	for (let i = 0; i < data.length; i++) {
		if (data[i] !== undefined && !isNaN(data[i])) {
			sum += data[i];
			count++;
		}
	}
	return count > 0 ? sum / count : 0;
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
