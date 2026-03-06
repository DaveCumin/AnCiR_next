// @ts-nocheck
// Periodogram calculations — extracted from web worker, using native JS with Kahan summation.

import { KahanSum, kahanMean, makeSeqArray } from '$lib/utils/numerics.js';
import { pchisq, qchisq } from '$lib/data/CDFs.js';
import { binData } from '$lib/components/plotbits/helpers/wrangleData.js';

// ========== Periodogram Calculation Functions ==========

function calculateLombScarglePower(times, values, frequencies, onProgress) {
	if (
		!times ||
		!values ||
		times.length < 2 ||
		values.length < 2 ||
		times.length !== values.length
	) {
		return new Array(frequencies.length).fill(NaN);
	}

	const validIndices = times
		.map((t, i) => (isNaN(t) || isNaN(values[i]) ? -1 : i))
		.filter((i) => i !== -1);
	const t = validIndices.map((i) => times[i]);
	const y = validIndices.map((i) => values[i]);

	if (t.length === 0) return new Array(frequencies.length).fill(0);

	const yMean = kahanMean(y);

	// Calculate variance using Kahan summation
	const varSum = new KahanSum();
	for (let i = 0; i < y.length; i++) {
		const diff = y[i] - yMean;
		varSum.add(diff * diff);
	}
	const yVariance = varSum.value / (y.length - 1);

	const powers = frequencies.map((f, freqIndex) => {
		const omega = 2 * Math.PI * f;

		// Calculate tau using Kahan summation
		const cosAcc = new KahanSum();
		const sinAcc = new KahanSum();
		for (let i = 0; i < t.length; i++) {
			cosAcc.add(Math.cos(omega * t[i]));
			sinAcc.add(Math.sin(omega * t[i]));
		}
		const tau = Math.atan2(sinAcc.value, cosAcc.value) / (2 * omega);

		// Calculate terms using Kahan summation
		const cosTermAcc = new KahanSum();
		const sinTermAcc = new KahanSum();
		for (let i = 0; i < y.length; i++) {
			const yDiff = y[i] - yMean;
			cosTermAcc.add(yDiff * Math.cos(omega * (t[i] - tau)));
			sinTermAcc.add(yDiff * Math.sin(omega * (t[i] - tau)));
		}

		// Calculate denominators using Kahan summation
		const cosDenomAcc = new KahanSum();
		const sinDenomAcc = new KahanSum();
		for (let i = 0; i < t.length; i++) {
			const cosVal = Math.cos(omega * (t[i] - tau));
			const sinVal = Math.sin(omega * (t[i] - tau));
			cosDenomAcc.add(cosVal * cosVal);
			sinDenomAcc.add(sinVal * sinVal);
		}

		const cosTerm = cosTermAcc.value;
		const sinTerm = sinTermAcc.value;
		const power = (cosTerm * cosTerm) / cosDenomAcc.value + (sinTerm * sinTerm) / sinDenomAcc.value;

		if (onProgress && freqIndex % 10 === 0) {
			onProgress(freqIndex, frequencies.length);
		}
		return power / (2 * yVariance);
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
	const dataMean = kahanMean(data.filter((v) => !isNaN(v)));
	const centeredData = data.map((v) => (isNaN(v) ? 0 : v - dataMean));

	const powers = periods.map((period, periodIndex) => {
		const binsPerPeriod = Math.round(period / binSize);
		if (binsPerPeriod < 1 || binsPerPeriod > n) return 0;

		const qpAcc = new KahanSum();
		let count = 0;

		for (let k = 1; k * binsPerPeriod < n; k++) {
			const lag = k * binsPerPeriod;
			const corrAcc = new KahanSum();
			let validPairs = 0;

			for (let i = 0; i < n - lag; i++) {
				if (!isNaN(centeredData[i]) && !isNaN(centeredData[i + lag])) {
					corrAcc.add(centeredData[i] * centeredData[i + lag]);
					validPairs++;
				}
			}

			if (validPairs > 0) {
				qpAcc.add(corrAcc.value / validPairs);
				count++;
			}
		}

		const qp = count > 0 ? qpAcc.value / count : 0;

		// Calculate variance using Kahan summation
		const varAcc = new KahanSum();
		for (let i = 0; i < centeredData.length; i++) {
			if (!isNaN(centeredData[i])) {
				varAcc.add(centeredData[i] * centeredData[i]);
			}
		}
		const variance = varAcc.value / n;

		if (onProgress && periodIndex % 10 === 0) {
			onProgress(periodIndex, periods.length);
		}

		return variance > 0 ? qp / variance : 0;
	});

	return powers;
}

function calculateChiSquaredPower(data, binSize, period, avgAll, denominator) {
	const colNum = Math.round(period / binSize);
	if (colNum < 1) return NaN;

	const rowNum = Math.ceil(data.length / colNum);

	// Use Kahan summation for column sums
	const colSums = Array.from({ length: colNum }, () => new KahanSum());
	const colCounts = new Array(colNum).fill(0);

	for (let i = 0; i < data.length; i++) {
		const col = i % colNum;
		if (!isNaN(data[i])) {
			colSums[col].add(data[i]);
			colCounts[col]++;
		}
	}

	const avgP = colSums.map((sum, i) => (colCounts[i] > 0 ? sum.value / colCounts[i] : avgAll));

	// Calculate numerator sum using Kahan summation
	const numAcc = new KahanSum();
	for (let i = 0; i < colNum; i++) {
		const diff = avgP[i] - avgAll;
		numAcc.add(diff * diff);
	}

	const result = (numAcc.value * data.length * rowNum) / denominator;
	return isFinite(result) ? result : NaN;
}

// ========== Main Calculation Function ==========

export function runPeriodogramCalculation(params, onProgress) {
	let out = { x: [], y: [], threshold: [], pvalue: [] };
	let binnedData = { bins: [], y_out: [] };

	if (params.method === 'Chi-squared') {
		if (!params.yData) {
			return { x: [], y: [], threshold: [], pvalue: [] };
		}
		// Strip NaN/null x values before binning — a NaN last x causes binData's
		// while(true) loop to never break (currentStart >= NaN is always false).
		const validPairs = params.xData
			.map((x, i) => ({ x, y: params.yData[i] }))
			.filter((p) => p.x !== null && p.x !== undefined && !isNaN(p.x));
		binnedData = binData(
			validPairs.map((p) => p.x),
			validPairs.map((p) => p.y),
			params.binSize,
			0
		);
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
		const avgAll = kahanMean(data);

		// Calculate denominator using Kahan summation
		const denomAcc = new KahanSum();
		for (let i = 0; i < data.length; i++) {
			if (!isNaN(data[i])) {
				const diff = data[i] - avgAll;
				denomAcc.add(diff * diff);
			}
		}

		for (let p = 0; p < periods.length; p++) {
			const df = Math.round(periods[p] / params.binSize) - 1;
			if (df < 1) {
				power[p] = NaN;
				threshold[p] = NaN;
				pvalue[p] = NaN;
			} else {
				power[p] = calculateChiSquaredPower(data, params.binSize, periods[p], avgAll, denomAcc.value);
				threshold[p] = qchisq(1 - correctedAlpha, df);
				pvalue[p] = 1 - pchisq(power[p], df);
			}

			if (onProgress && p % 10 === 0) {
				onProgress(p, periods.length);
			}
		}
	} else if (params.method === 'Lomb-Scargle') {
		const powers = calculateLombScarglePower(params.xData, params.yData, frequencies, onProgress);
		for (let p = 0; p < periods.length; p++) {
			power[p] = powers[p];
		}
	} else if (params.method === 'Enright') {
		const powers = calculateEnrightPower(
			params.xData,
			params.yData,
			periods,
			params.binSize,
			onProgress
		);
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
