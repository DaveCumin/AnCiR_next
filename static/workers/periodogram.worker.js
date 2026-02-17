// Periodogram calculation worker
// This runs in a separate thread to avoid blocking the UI

// Import BigNumber from CDN
importScripts('https://cdn.jsdelivr.net/npm/bignumber.js@9.1.2/bignumber.min.js');

// Configure BigNumber for high precision
BigNumber.config({
	DECIMAL_PLACES: 50,
	ROUNDING_MODE: BigNumber.ROUND_HALF_UP
});

// ========== Helper Functions ==========

function mean(data) {
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

function makeSeqArray(from, to, step) {
	let out = [];
	for (let i = from; i <= to; i += step) {
		out.push(i);
	}
	return out;
}

function binData(xValues, yValues, binSize, binStart = 0) {
	const n = xValues.length;
	if (n === 0 || n !== yValues.length) return { bins: [], y_out: [] };

	// Pair and sort by x once
	const paired = xValues.map((x, i) => ({ x, y: yValues[i] })).sort((a, b) => a.x - b.x);
	const xs = paired.map((p) => p.x);
	const ys = paired.map((p) => p.y);

	const meanFunc = (arr, start, end) => {
		let sum = 0;
		for (let i = start; i < end; i++) sum += arr[i];
		return sum / (end - start);
	};

	const bins = [];
	const y_out = [];
	let currentStart = binStart;
	const EPSILON = 1e-10;
	let pointer = 0;

	while (true) {
		const binEnd = currentStart + binSize;
		bins.push(currentStart);

		while (pointer < n && xs[pointer] < currentStart - EPSILON) pointer++;

		const startIdx = pointer;
		let endIdx = startIdx;
		while (endIdx < n && xs[endIdx] < binEnd - EPSILON) endIdx++;

		y_out.push(meanFunc(ys, startIdx, endIdx));

		if (currentStart >= xs[n - 1]) break;
		currentStart += binSize;
	}

	return { bins, y_out };
}

// ========== CDF Functions ==========
// Simplified versions - you may want to import the full versions

function pchisq(x, df) {
	// Approximation of chi-squared CDF
	// For production, use the actual implementation from CDFs.js
	if (x <= 0) return 0;
	if (df <= 0) return NaN;

	// Simple gamma function approximation for small df
	const k = df / 2;
	const halfX = x / 2;

	// Very rough approximation - replace with actual implementation
	const p = 1 - Math.exp(-halfX) * Math.pow(halfX, k - 1);
	return Math.max(0, Math.min(1, p));
}

function qchisq(p, df) {
	// Approximation of inverse chi-squared CDF
	// For production, use the actual implementation from CDFs.js
	if (p <= 0) return 0;
	if (p >= 1) return Infinity;
	if (df <= 0) return NaN;

	// Very rough approximation - replace with actual implementation
	return df * Math.pow(-Math.log(1 - p), 1 / df);
}

// ========== Periodogram Calculation Functions ==========

function calculateLombScarglePower(times, values, frequencies, onProgress) {
	if (!times || !values || times.length < 2 || values.length < 2 || times.length !== values.length) {
		return new Array(frequencies.length).fill(NaN);
	}

	const validIndices = times
		.map((t, i) => (isNaN(t) || isNaN(values[i]) ? -1 : i))
		.filter((i) => i !== -1);
	const t = validIndices.map((i) => times[i]);
	const y = validIndices.map((i) => values[i]);

	if (t.length === 0) return new Array(frequencies.length).fill(0);

	const yMean = mean(y);

	// Calculate variance using BigNumber
	let yVarianceBN = new BigNumber(0);
	for (let i = 0; i < y.length; i++) {
		const diff = new BigNumber(y[i]).minus(yMean);
		yVarianceBN = yVarianceBN.plus(diff.times(diff));
	}
	yVarianceBN = yVarianceBN.dividedBy(y.length - 1);

	const powers = frequencies.map((f, freqIndex) => {
		const omega = 2 * Math.PI * f;

		// Calculate cosSum and sinSum using BigNumber
		let cosSum = new BigNumber(0);
		let sinSum = new BigNumber(0);
		for (let i = 0; i < t.length; i++) {
			cosSum = cosSum.plus(Math.cos(omega * t[i]));
			sinSum = sinSum.plus(Math.sin(omega * t[i]));
		}
		const tau = Math.atan2(sinSum.toNumber(), cosSum.toNumber()) / (2 * omega);

		// Calculate cosTerm and sinTerm using BigNumber
		let cosTerm = new BigNumber(0);
		let sinTerm = new BigNumber(0);
		for (let i = 0; i < y.length; i++) {
			const yDiff = new BigNumber(y[i]).minus(yMean);
			const cosVal = Math.cos(omega * (t[i] - tau));
			const sinVal = Math.sin(omega * (t[i] - tau));
			cosTerm = cosTerm.plus(yDiff.times(cosVal));
			sinTerm = sinTerm.plus(yDiff.times(sinVal));
		}

		// Calculate denominators using BigNumber
		let cosDenom = new BigNumber(0);
		let sinDenom = new BigNumber(0);
		for (let i = 0; i < t.length; i++) {
			const cosVal = Math.cos(omega * (t[i] - tau));
			const sinVal = Math.sin(omega * (t[i] - tau));
			cosDenom = cosDenom.plus(new BigNumber(cosVal).times(cosVal));
			sinDenom = sinDenom.plus(new BigNumber(sinVal).times(sinVal));
		}

		// Calculate power using BigNumber
		const term1 = cosTerm.times(cosTerm).dividedBy(cosDenom);
		const term2 = sinTerm.times(sinTerm).dividedBy(sinDenom);
		const power = term1.plus(term2).dividedBy(yVarianceBN.times(2));

		// Send progress update every 10 frequencies
		if (onProgress && freqIndex % 10 === 0) {
			onProgress(freqIndex, frequencies.length);
		}

		return power.toNumber();
	});

	return powers;
}

function calculateEnrightPower(times, values, periods, binSize, onProgress) {
	if (!times || !values || times.length < 2 || values.length < 2) {
		return new Array(periods.length).fill(NaN);
	}

	const binnedData = binData(times, values, binSize, 0);
	if (binnedData.bins.length === 0) {
		return new Array(periods.length).fill(0);
	}

	const data = binnedData.y_out;
	const n = data.length;
	const dataMean = mean(data.filter((v) => !isNaN(v)));
	const centeredData = data.map((v) => (isNaN(v) ? 0 : v - dataMean));

	const powers = periods.map((period, periodIndex) => {
		const binsPerPeriod = Math.round(period / binSize);
		if (binsPerPeriod < 1 || binsPerPeriod > n) return 0;

		let qp = new BigNumber(0);
		let count = 0;

		for (let k = 1; k * binsPerPeriod < n; k++) {
			const lag = k * binsPerPeriod;
			let correlation = new BigNumber(0);
			let validPairs = 0;

			for (let i = 0; i < n - lag; i++) {
				if (!isNaN(centeredData[i]) && !isNaN(centeredData[i + lag])) {
					correlation = correlation.plus(
						new BigNumber(centeredData[i]).times(centeredData[i + lag])
					);
					validPairs++;
				}
			}

			if (validPairs > 0) {
				qp = qp.plus(correlation.dividedBy(validPairs));
				count++;
			}
		}

		if (count > 0) {
			qp = qp.dividedBy(count);
		}

		// Calculate variance using BigNumber
		let variance = new BigNumber(0);
		for (let i = 0; i < centeredData.length; i++) {
			const val = centeredData[i];
			if (!isNaN(val)) {
				variance = variance.plus(new BigNumber(val).times(val));
			}
		}
		variance = variance.dividedBy(n);

		// Send progress update every 10 periods
		if (onProgress && periodIndex % 10 === 0) {
			onProgress(periodIndex, periods.length);
		}

		return variance.isGreaterThan(0) ? qp.dividedBy(variance).toNumber() : 0;
	});

	return powers;
}

function calculateChiSquaredPower(data, binSize, period, avgAll, denominator) {
	const colNum = Math.round(period / binSize);
	if (colNum < 1) return NaN;

	const rowNum = Math.ceil(data.length / colNum);

	// Use BigNumber arrays for column sums
	let colSums = new Array(colNum).fill(0).map(() => new BigNumber(0));
	let colCounts = new Array(colNum).fill(0);

	for (let i = 0; i < data.length; i++) {
		const col = i % colNum;
		const val = data[i];
		if (!isNaN(val)) {
			colSums[col] = colSums[col].plus(val);
			colCounts[col]++;
		}
	}

	// Calculate column averages using BigNumber
	const avgAllBN = new BigNumber(avgAll);
	const avgP = colSums.map((sum, i) =>
		colCounts[i] > 0 ? sum.dividedBy(colCounts[i]) : avgAllBN
	);

	// Calculate numerator sum using BigNumber
	let numSum = new BigNumber(0);
	for (let i = 0; i < colNum; i++) {
		const diff = avgP[i].minus(avgAllBN);
		numSum = numSum.plus(diff.times(diff));
	}

	const numerator = numSum.times(data.length).times(rowNum);
	const result = numerator.dividedBy(denominator);

	return result.isFinite() ? result.toNumber() : NaN;
}

// ========== Main Calculation Function ==========

function runPeriodogramCalculation(params, onProgress) {
	let out = { x: [], y: [], threshold: [], pvalue: [] };
	let binnedData = { bins: [], y_out: [] };

	if (params.method === 'Chi-squared') {
		if (!params.yData) {
			return { x: [], y: [], threshold: [], pvalue: [] };
		}
		binnedData = binData(params.xData, params.yData, params.binSize, 0);
		if (binnedData.bins.length === 0) {
			return { x: [], y: [], threshold: [], pvalue: [] };
		}
	}

	const periods = makeSeqArray(params.periodMin, params.periodMax, params.periodSteps);
	const frequencies = periods.map((p) => 1 / p);

	const correctedAlpha = Math.pow(1 - params.chiSquaredAlpha, 1 / periods.length);
	const power = new Array(periods.length);
	const threshold = new Array(periods.length);
	const pvalue = new Array(periods.length);

	if (params.method === 'Chi-squared') {
		const data = binnedData.y_out;
		const avgAll = mean(data);

		// Calculate denominator using BigNumber for precision
		let denominator = new BigNumber(0);
		for (let i = 0; i < data.length; i++) {
			const val = data[i];
			if (!isNaN(val)) {
				const diff = new BigNumber(val).minus(avgAll);
				denominator = denominator.plus(diff.times(diff));
			}
		}

		for (let p = 0; p < periods.length; p++) {
			power[p] = calculateChiSquaredPower(
				data,
				params.binSize,
				periods[p],
				avgAll,
				denominator.toNumber()
			);
			threshold[p] = qchisq(1 - correctedAlpha, Math.round(periods[p] / params.binSize));
			pvalue[p] = 1 - pchisq(power[p], Math.round(periods[p] / params.binSize));

			// Send progress update every 10 periods
			if (onProgress && p % 10 === 0) {
				onProgress(p, periods.length);
			}
		}
	} else if (params.method === 'Lomb-Scargle') {
		const times = params.xData;
		const values = params.yData;
		const powers = calculateLombScarglePower(times, values, frequencies, onProgress);

		for (let p = 0; p < periods.length; p++) {
			power[p] = powers[p];
		}
	} else if (params.method === 'Enright') {
		const times = params.xData;
		const values = params.yData;
		const powers = calculateEnrightPower(times, values, periods, params.binSize, onProgress);

		for (let p = 0; p < periods.length; p++) {
			power[p] = powers[p];
		}
	}

	// Remove NaN values
	const idxsToRemove = [];
	for (let i = 0; i < power.length; i++) {
		if (isNaN(power[i]) || isNaN(periods[i])) {
			idxsToRemove.push(i);
		}
	}

	out = {
		x: periods.filter((v, i) => !idxsToRemove.includes(i)),
		y: power.filter((v, i) => !idxsToRemove.includes(i)),
		threshold: threshold.filter((v, i) => !idxsToRemove.includes(i)),
		pvalue: pvalue.filter((v, i) => !idxsToRemove.includes(i))
	};

	return out;
}

// ========== Worker Message Handler ==========

let currentCalculation = null;

self.onmessage = function (e) {
	const { type, params, id } = e.data;

	if (type === 'calculate') {
		currentCalculation = id;

		try {
			const result = runPeriodogramCalculation(params, (current, total) => {
				// Send progress update
				if (currentCalculation === id) {
					self.postMessage({
						type: 'progress',
						id,
						current,
						total
					});
				}
			});

			// Send final result if not cancelled
			if (currentCalculation === id) {
				self.postMessage({
					type: 'complete',
					id,
					result
				});
			}
		} catch (error) {
			self.postMessage({
				type: 'error',
				id,
				error: error.message
			});
		}
	} else if (type === 'cancel') {
		// Mark calculation as cancelled
		if (currentCalculation === id) {
			currentCalculation = null;
			self.postMessage({
				type: 'cancelled',
				id
			});
		}
	}
};
