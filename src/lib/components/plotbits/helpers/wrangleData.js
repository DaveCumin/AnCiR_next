//Bin data in binSize bins starting at binStart - takes the average y-value and returns the starting x positions

export function binData(x, y, binSize, binStart = 0) {
	if (binSize <= 0) {
		throw new Error('binSize must be greater than 0');
	}

	// Initialize arrays for bin sums and counts
	const numBins = Math.ceil((max(x) - binStart) / binSize) + 1;
	const binSums = new Array(numBins).fill(0);
	const binCounts = new Array(numBins).fill(0);
	const bins = new Array(numBins).fill(0).map((_, i) => binStart + i * binSize);

	// Single pass over x and y to assign bins
	for (let i = 0; i < x.length; i++) {
		const valX = x[i];
		const valY = y[i];
		if (!isNaN(valX) && !isNaN(valY)) {
			const binIndex = Math.floor((valX - binStart) / binSize);
			if (binIndex >= 0 && binIndex < numBins) {
				binSums[binIndex] += valY;
				binCounts[binIndex]++;
			}
		}
	}

	// Compute y_out as averages; NaN if no data in the bin
	const y_out = binSums.map((sum, i) => (binCounts[i] > 0 ? sum / binCounts[i] : NaN));

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
