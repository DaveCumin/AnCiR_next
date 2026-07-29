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
/**
 * Solve a symmetric positive-definite BANDED system by Cholesky, in O(n·m²).
 *
 * `bands[d][i]` holds A[i][i+d] for d = 0..m (the upper half; A is symmetric).
 * `L[i][d]` holds L[i][i-d], the same banded layout for the factor.
 *
 * Exported for testing: its agreement with a dense solve is the property that makes
 * the fast path safe to substitute for the slow one.
 */
export function _bandedCholeskySolve(bands, b, m) {
	const n = b.length;
	const L = Array.from({ length: n }, () => new Float64Array(m + 1));

	// d descending => j ascending, so L[i][k] for k < j is already known when needed.
	for (let i = 0; i < n; i++) {
		for (let d = Math.min(m, i); d >= 0; d--) {
			const j = i - d;
			let s = bands[d][j]; // A[i][j] = A[j][j+d]
			for (let k = Math.max(0, i - m, j - m); k < j; k++) s -= L[i][i - k] * L[j][j - k];
			if (d === 0) {
				// A tiny or negative pivot means the system is not positive-definite (or has
				// been made singular by an extreme lambda). Fall back rather than return NaN.
				if (!(s > 0)) return null;
				L[i][0] = Math.sqrt(s);
			} else {
				L[i][d] = s / L[j][0];
			}
		}
	}

	const z = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		let s = b[i];
		for (let k = Math.max(0, i - m); k < i; k++) s -= L[i][i - k] * z[k];
		z[i] = s / L[i][0];
	}
	const x = new Float64Array(n);
	for (let i = n - 1; i >= 0; i--) {
		let s = z[i];
		for (let k = i + 1; k < Math.min(n, i + m + 1); k++) s -= L[k][k - i] * x[k];
		x[i] = s / L[i][0];
	}
	return Array.from(x);
}

/**
 * Whittaker-Eilers smoother: minimise ||y - z||² + lambda·||D_order z||².
 *
 * The normal equations are (W + lambda·DᵀD) z = W y. This used to build D as a dense
 * (n-order)×n matrix, form DᵀD by dense multiplication and solve by Gaussian
 * elimination — O(n³) time and O(n²) memory. Measured: 171 ms at n = 400, 1.8 s at
 * n = 800, 17.8 s at n = 1600, i.e. roughly 9x per doubling. A month of 15-minute
 * epochs (~2880 points) took about two minutes PER COLUMN, and SmoothedData awaits
 * its columns one at a time — which is what "the node never finishes" looked like.
 *
 * But D is a banded difference operator, so DᵀD has half-bandwidth `order` and the
 * whole system is banded. That is the entire point of Eilers' formulation. Building
 * the band directly and solving by banded Cholesky is O(n·order²) — linear in n.
 *
 * This solves the SAME system, so the result is identical to floating-point
 * tolerance; it is a change of algorithm, not of definition, and the parity fixtures
 * against the Python and R ports still hold.
 */
export function whittakerEilers(y, lambda = 100, order = 2) {
	const n = y.length;
	if (n < 3) return y;
	// Fewer rows than the difference order leaves DᵀD empty; nothing to smooth.
	if (n <= order) return y;

	const c = [];
	for (let j = 0; j <= order; j++) c.push(Math.pow(-1, j) * _binomial(order, j));

	// (DᵀD)[i][j] with d = i - j is sum over t of c[d+t]·c[t], where t = j - k indexes
	// the difference rows k that touch both i and j.
	const rows = n - order; // number of rows in D
	const bands = [];
	for (let d = 0; d <= order; d++) {
		const band = new Float64Array(n);
		for (let j = 0; j + d < n; j++) {
			let sum = 0;
			const tMax = Math.min(order - d, j);
			for (let t = Math.max(0, j - (rows - 1)); t <= tMax; t++) sum += c[d + t] * c[t];
			band[j] = lambda * sum + (d === 0 ? 1 : 0); // W = I
		}
		bands.push(band);
	}

	const solved = _bandedCholeskySolve(bands, y.slice(), order);
	return solved ?? y.slice();
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
