// @ts-nocheck
// Trend-fitting algorithms — extracted so they can be reused outside TrendFit.svelte.

import { linearRegression } from '$lib/components/plotbits/helpers/wrangleData.js';

function _multiplyMatrices(A, B) {
	const rows = A.length;
	const cols = B[0].length;
	const common = B.length;
	const result = Array(rows)
		.fill()
		.map(() => Array(cols).fill(0));
	for (let i = 0; i < rows; i++)
		for (let j = 0; j < cols; j++)
			for (let k = 0; k < common; k++) result[i][j] += A[i][k] * B[k][j];
	return result;
}

function _transpose(matrix) {
	return matrix[0].map((_, colIndex) => matrix.map((row) => row[colIndex]));
}

function _solveLinearSystem(A, b) {
	const n = A.length;
	const augmented = A.map((row, i) => [...row, b[i]]);
	for (let i = 0; i < n; i++) {
		let maxRow = i;
		for (let k = i + 1; k < n; k++)
			if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) maxRow = k;
		[augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
		for (let k = i + 1; k < n; k++) {
			const factor = augmented[k][i] / augmented[i][i];
			for (let j = i; j <= n; j++) augmented[k][j] -= factor * augmented[i][j];
		}
	}
	const result = new Array(n);
	for (let i = n - 1; i >= 0; i--) {
		result[i] = augmented[i][n];
		for (let j = i + 1; j < n; j++) result[i] -= augmented[i][j] * result[j];
		result[i] /= augmented[i][i];
	}
	return result;
}

function _polynomialFit(x, y, degree) {
	const n = x.length;
	const A = [];
	for (let i = 0; i < n; i++) {
		const row = [];
		for (let j = 0; j <= degree; j++) row.push(Math.pow(x[i], j));
		A.push(row);
	}
	const AT = _transpose(A);
	const ATA = _multiplyMatrices(AT, A);
	const ATy = _multiplyMatrices(
		AT,
		y.map((v) => [v])
	).map((r) => r[0]);
	return _solveLinearSystem(ATA, ATy);
}

function _evaluatePolynomial(coeffs, x) {
	return coeffs.reduce((sum, c, i) => sum + c * Math.pow(x, i), 0);
}

function _computeRSquared(y, fitted) {
	const meanY = y.reduce((sum, val) => sum + val, 0) / y.length;
	const ssTot = y.reduce((sum, val) => sum + Math.pow(val - meanY, 2), 0);
	const ssRes = y.reduce((sum, val, i) => sum + Math.pow(val - fitted[i], 2), 0);
	return ssTot > 0 ? 1 - ssRes / ssTot : 0;
}

/**
 * Fit a trend model to x/y arrays.
 *
 * @param {number[]} x         - x values (hours or arbitrary numeric)
 * @param {number[]} y         - y values
 * @param {string}   model     - 'linear' | 'exponential' | 'logarithmic' | 'polynomial'
 * @param {number}   polyDegree - only used when model === 'polynomial'
 * @returns {{ parameters: object, fitted: number[], rmse: number, rSquared: number }}
 */
export function fitTrend(x, y, model, polyDegree = 2) {
	let parameters, fitted, rSquared;
	if (model === 'linear') {
		const reg = linearRegression(x, y);
		parameters = { slope: reg.slope, intercept: reg.intercept };
		fitted = x.map((xi) => reg.slope * xi + reg.intercept);
		rSquared = reg.rSquared;
	} else if (model === 'exponential') {
		const logY = y.map(Math.log);
		const reg = linearRegression(x, logY);
		const a = Math.exp(reg.intercept);
		const b = reg.slope;
		parameters = { a, b };
		fitted = x.map((xi) => a * Math.exp(b * xi));
		rSquared = _computeRSquared(y, fitted);
	} else if (model === 'logarithmic') {
		const logX = x.map(Math.log);
		const reg = linearRegression(logX, y);
		parameters = { a: reg.intercept, b: reg.slope };
		fitted = x.map((xi) => reg.intercept + reg.slope * Math.log(xi));
		rSquared = _computeRSquared(y, fitted);
	} else if (model === 'polynomial') {
		const coeffs = _polynomialFit(x, y, polyDegree);
		parameters = { coeffs };
		fitted = x.map((xi) => _evaluatePolynomial(coeffs, xi));
		rSquared = _computeRSquared(y, fitted);
	}
	const rmse = Math.sqrt(
		fitted.reduce((sum, fi, i) => sum + Math.pow(y[i] - fi, 2), 0) / x.length
	);
	return { parameters, fitted, rmse, rSquared };
}

/**
 * Evaluate a fitted trend model at new x points.
 *
 * @param {object}   parameters - from fitTrend
 * @param {string}   model
 * @param {number[]} xPoints
 * @returns {number[]}
 */
export function evaluateTrendAtPoints(parameters, model, xPoints) {
	if (model === 'linear') {
		return xPoints.map((xi) => parameters.slope * xi + parameters.intercept);
	} else if (model === 'exponential') {
		return xPoints.map((xi) => parameters.a * Math.exp(parameters.b * xi));
	} else if (model === 'logarithmic') {
		return xPoints.map((xi) => parameters.a + parameters.b * Math.log(xi));
	} else if (model === 'polynomial') {
		return xPoints.map((xi) => _evaluatePolynomial(parameters.coeffs, xi));
	}
	return xPoints.map(() => NaN);
}
