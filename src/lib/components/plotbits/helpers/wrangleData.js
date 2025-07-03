//Bin data in binSize bins starting at binStart - takes the average y-value and returns the starting x positions
// eg
/*
x = [2,3, 5,6,7,9,11,12,13];
y = [2,10,9,7,1,3,4 ,6, 6 ];
binSize = 3;
binStart = 0;
binData(x, y, binSize, binStart) //{ bins: [ 0, 3, 6, 9, 12 ], y_out: [ 2, 9.5, 4, 3.5, 6 ] }
*/
export function binData(x, y, binSize, binStart = 0) {
	//check
	if (binSize <= 0) {
		throw new Error('binSize must be greater than 0');
	}

	// Initialize output arrays
	const bins = [];
	const y_out = [];

	// Calculate bin edges starting from Bstart
	let start = binStart;
	let end = start + binSize;

	// Iterate through x and y to bin values
	while (start < Math.max(...x)) {
		// Find indices of x values that fall within the current bin
		let indices = x.map((val, i) => (val >= start && val < end ? i : -1)).filter((i) => i !== -1);

		// If there are values in this bin
		if (indices.length > 0) {
			// Calculate bin center
			bins.push(start);

			// Calculate average of y values for this bin
			let ySum = indices.reduce((sum, i) => sum + y[i], 0);
			y_out.push(ySum / indices.length);
		} else {
			bins.push(start);
			y_out.push(0);
		}

		// Move to next bin
		start += binSize;
		end += binSize;
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

	// Calculate R-squared
	let ssTotal = 0;
	let ssResidual = 0;
	let sumSquaredErrors = 0;
	const meanY = sumY / n;

	for (let i = 0; i < n; i++) {
		const predictedY = slope * x[i] + intercept;
		ssTotal += (y[i] - meanY) ** 2;
		ssResidual += (y[i] - predictedY) ** 2;
		sumSquaredErrors += (y[i] - predictedY) ** 2;
	}

	const rSquared = 1 - ssResidual / ssTotal;
	const rmse = Math.sqrt(sumSquaredErrors / n);

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
export function mean(arr) {
	return arr.reduce((acc, val) => acc + val, 0) / arr.length;
}
