// @ts-nocheck
// Pure smoothing algorithms — extracted so they can be tested and reused.

// ─── Matrix helpers (used by Whittaker-Eilers and Savitzky-Golay) ──────────

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

function _addMatrices(A, B) {
	return A.map((row, i) => row.map((val, j) => val + B[i][j]));
}

function _diagonalMatrix(diagonal) {
	const n = diagonal.length;
	const result = Array(n)
		.fill()
		.map(() => Array(n).fill(0));
	for (let i = 0; i < n; i++) result[i][i] = diagonal[i];
	return result;
}

function _scalarMultiply(matrix, scalar) {
	return matrix.map((row) => row.map((val) => val * scalar));
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

function _invertMatrix(matrix) {
	const n = matrix.length;
	const identity = Array(n)
		.fill()
		.map((_, i) =>
			Array(n)
				.fill(0)
				.map((_, j) => (i === j ? 1 : 0))
		);
	const augmented = matrix.map((row, i) => [...row, ...identity[i]]);
	for (let i = 0; i < n; i++) {
		let maxRow = i;
		for (let k = i + 1; k < n; k++)
			if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) maxRow = k;
		[augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
		const pivot = augmented[i][i];
		for (let j = 0; j < 2 * n; j++) augmented[i][j] /= pivot;
		for (let k = 0; k < n; k++) {
			if (k !== i) {
				const factor = augmented[k][i];
				for (let j = 0; j < 2 * n; j++) augmented[k][j] -= factor * augmented[i][j];
			}
		}
	}
	return augmented.map((row) => row.slice(n));
}

function _binomial(n, k) {
	if (k > n) return 0;
	if (k === 0 || k === n) return 1;
	let result = 1;
	for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1);
	return result;
}

function _tricubeWeight(u) {
	if (u >= 1) return 0;
	return Math.pow(1 - Math.pow(u, 3), 3);
}

function _getSavitzkyGolayCoeffs(windowSize, polyOrder) {
	const halfWindow = Math.floor(windowSize / 2);
	const A = [];
	for (let i = -halfWindow; i <= halfWindow; i++) {
		const row = [];
		for (let j = 0; j <= polyOrder; j++) row.push(Math.pow(i, j));
		A.push(row);
	}
	const AT = _transpose(A);
	const ATA = _multiplyMatrices(AT, A);
	const ATAinv = _invertMatrix(ATA);
	const pinv = _multiplyMatrices(ATAinv, AT);
	return pinv[0];
}

// ─── Public smoother functions ────────────────────────────────────────────

/**
 * Whittaker-Eilers smoother.
 * Penalised least squares with finite-difference penalty of given order.
 *
 * @param {number[]} y       - Input signal (no NaNs expected)
 * @param {number}   lambda  - Smoothing strength (higher = smoother)
 * @param {number}   order   - Penalty order (1 = first differences, 2 = second)
 * @returns {number[]}
 */
export function whittakerEilers(y, lambda = 100, order = 2) {
	const n = y.length;
	if (n < 3) return y;

	const D = [];
	for (let i = 0; i < n - order; i++) {
		const row = new Array(n).fill(0);
		for (let j = 0; j <= order; j++) row[i + j] = Math.pow(-1, j) * _binomial(order, j);
		D.push(row);
	}

	const W = Array(n).fill(1);
	const DTD = _multiplyMatrices(_transpose(D), D);
	const A = _addMatrices(_diagonalMatrix(W), _scalarMultiply(DTD, lambda));
	const b = y.map((val, i) => W[i] * val);

	return _solveLinearSystem(A, b);
}

/**
 * Savitzky-Golay smoothing filter.
 * Fits a polynomial of `polyOrder` over a sliding `windowSize` window.
 *
 * @param {number[]} y          - Input signal
 * @param {number}   windowSize - Must be odd; even values are incremented by 1
 * @param {number}   polyOrder  - Polynomial order (< windowSize)
 * @returns {number[]}
 */
export function savitzkyGolay(y, windowSize = 5, polyOrder = 2) {
	if (windowSize % 2 === 0) windowSize += 1;
	const halfWindow = Math.floor(windowSize / 2);
	const result = [...y];
	const coeffs = _getSavitzkyGolayCoeffs(windowSize, polyOrder);
	for (let i = halfWindow; i < y.length - halfWindow; i++) {
		let sum = 0;
		for (let j = -halfWindow; j <= halfWindow; j++) sum += coeffs[j + halfWindow] * y[i + j];
		result[i] = sum;
	}
	return result;
}

/**
 * LOESS (locally-weighted scatterplot smoothing).
 *
 * @param {number[]} x         - X values (sorted)
 * @param {number[]} y         - Y values
 * @param {number}   bandwidth - Fraction of data used for each local fit (0–1)
 * @returns {number[]}
 */
export function loess(x, y, bandwidth = 0.3) {
	const n = x.length;
	const result = new Array(n);
	const h = Math.max(Math.floor(bandwidth * n), 1);

	for (let i = 0; i < n; i++) {
		const xi = x[i];
		const distances = x.map((xj, j) => ({ dist: Math.abs(xi - xj), index: j }));
		distances.sort((a, b) => a.dist - b.dist);
		const neighbors = distances.slice(0, h);
		const maxDist = neighbors[neighbors.length - 1].dist;
		const weights = neighbors.map((nb) => _tricubeWeight(nb.dist / (maxDist || 1)));

		let sumW = 0, sumWX = 0, sumWY = 0, sumWXX = 0, sumWXY = 0;
		for (let j = 0; j < neighbors.length; j++) {
			const idx = neighbors[j].index;
			const w = weights[j];
			const xj = x[idx];
			const yj = y[idx];
			sumW += w; sumWX += w * xj; sumWY += w * yj;
			sumWXX += w * xj * xj; sumWXY += w * xj * yj;
		}

		const denom = sumW * sumWXX - sumWX * sumWX;
		if (Math.abs(denom) < 1e-10) {
			result[i] = sumWY / sumW;
		} else {
			const slope = (sumW * sumWXY - sumWX * sumWY) / denom;
			const intercept = (sumWY - slope * sumWX) / sumW;
			result[i] = slope * xi + intercept;
		}
	}
	return result;
}

/**
 * Moving average smoother.
 *
 * @param {number[]} y          - Input signal (null/NaN values are skipped)
 * @param {number}   windowSize - Half-window radius = floor(windowSize/2)
 * @param {string}   type       - 'simple' | 'weighted' | 'exponential'
 * @returns {number[]}
 */
/**
 * Dispatch to the appropriate smoother based on `smootherType`.
 * Expects pre-filtered, sorted, NaN-free arrays.
 *
 * @param {number[]} xVals       - sorted x values
 * @param {number[]} yVals       - corresponding y values
 * @param {string}   smootherType - 'moving' | 'whittaker' | 'savitzky' | 'loess'
 * @param {object}   options     - type-specific params
 * @returns {{ x_out: number[], y_out: number[] }}
 */
export function smoothArrays(xVals, yVals, smootherType, options = {}) {
	let smoothedY;
	switch (smootherType) {
		case 'whittaker':
			smoothedY = whittakerEilers(yVals, options.whittakerLambda ?? 100, options.whittakerOrder ?? 2);
			break;
		case 'savitzky':
			smoothedY = savitzkyGolay(yVals, options.savitzkyWindowSize ?? 5, options.savitzkyPolyOrder ?? 2);
			break;
		case 'loess':
			smoothedY = loess(xVals, yVals, options.loessBandwidth ?? 0.3);
			break;
		case 'moving':
		default:
			smoothedY = movingAverage(yVals, options.movingAvgWindowSize ?? 5, options.movingAvgType ?? 'simple');
			break;
	}
	return { x_out: xVals, y_out: smoothedY };
}

export function movingAverage(y, windowSize = 5, type = 'simple') {
	const result = [...y];
	const halfWindow = Math.floor(windowSize / 2);

	for (let i = 0; i < y.length; i++) {
		let sum = 0;
		let count = 0;
		let weightSum = 0;
		const start = Math.max(0, i - halfWindow);
		const end = Math.min(y.length - 1, i + halfWindow);

		for (let j = start; j <= end; j++) {
			if (y[j] != null && !isNaN(y[j])) {
				if (type === 'simple') {
					sum += y[j];
					count++;
				} else if (type === 'weighted') {
					const distance = Math.abs(i - j);
					const weight = Math.max(0, windowSize - distance);
					sum += y[j] * weight;
					weightSum += weight;
				} else if (type === 'exponential') {
					const distance = Math.abs(i - j);
					const weight = Math.exp(-distance / (windowSize / 3));
					sum += y[j] * weight;
					weightSum += weight;
				}
			}
		}

		if (type === 'simple') {
			result[i] = count > 0 ? sum / count : y[i];
		} else {
			result[i] = weightSum > 0 ? sum / weightSum : y[i];
		}
	}
	return result;
}
