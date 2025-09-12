/**
 * Fits a model comprised of N cosine curves to data
 * Model: A + sum(B_i * cos(w_i * t + o_i)) + O
 * Where A is DC offset, B_i are amplitudes, w_i are frequencies,
 * o_i are phase offsets
 *
 * @param {number[]} t - Time/input array
 * @param {number[]} x - Data/output array
 * @param {number} N - Number of cosine curves
 * @param {Object} options - Optional configuration
 * @param {number[]} options.initialGuess - Initial parameter guess [A, B1, w1, o1, B2, w2, o2, ..., O]
 * @param {number} options.maxIterations - Maximum iterations (default: 1000)
 * @param {number} options.tolerance - Convergence tolerance (default: 1e-6)
 * @returns {Object} - Fitting results
 */
export function fitCosineCurves(t, x, N, options = {}) {
	if (t.length !== x.length) {
		throw new Error('Arrays t and x must have the same length');
	}

	const { initialGuess = null, maxIterations = 1000, tolerance = 1e-6 } = options;

	// Parameter order: [A, B1, w1, o1, B2, w2, o2, ..., BN, wN, oN, O]
	const numParams = 1 + 3 * N; // A + 3*N parameters

	// Generate initial guess if not provided
	let params = initialGuess || generateInitialGuess(t, x, N);

	if (params.length !== numParams) {
		throw new Error(`Initial guess must have ${numParams} parameters`);
	}

	// Levenberg-Marquardt optimization
	const lambda = 0.01;
	let prevError = Infinity;

	for (let iter = 0; iter < maxIterations; iter++) {
		const { residuals, jacobian } = computeResidualsAndJacobian(t, x, params, N);
		const currentError = residuals.reduce((sum, r) => sum + r * r, 0);

		if (Math.abs(prevError - currentError) < tolerance) {
			break;
		}

		// Compute parameter update using Levenberg-Marquardt
		const JtJ = multiplyMatrices(transpose(jacobian), jacobian);
		const JtR = multiplyMatrixVector(transpose(jacobian), residuals);

		// Add damping to diagonal
		for (let i = 0; i < JtJ.length; i++) {
			JtJ[i][i] += lambda;
		}

		try {
			const delta = solveLinearSystem(JtJ, JtR);

			// Update parameters
			for (let i = 0; i < params.length; i++) {
				params[i] -= delta[i];
			}

			prevError = currentError;
		} catch (e) {
			console.warn('Matrix inversion failed, stopping optimization');
			break;
		}
	}

	// Compute final statistics
	const { residuals } = computeResidualsAndJacobian(t, x, params, N);
	const rss = residuals.reduce((sum, r) => sum + r * r, 0);
	const rmse = Math.sqrt(rss / t.length);

	// Generate fitted curve
	const fitted = t.map((ti) => evaluateModel(ti, params, N));

	return {
		parameters: {
			A: params[0],
			cosines: Array.from({ length: N }, (_, i) => ({
				amplitude: params[1 + 3 * i],
				frequency: params[2 + 3 * i],
				phase: params[3 + 3 * i]
			})),
			O: params[params.length - 1]
		},
		fitted: fitted,
		residuals: residuals,
		rmse: rmse,
		rss: rss
	};
}

/**
 * Evaluate the cosine model at a given point
 */
function evaluateModel(t, params, N) {
	let result = params[0]; // A

	for (let i = 0; i < N; i++) {
		const B = params[1 + 3 * i];
		const w = params[2 + 3 * i];
		const o = params[3 + 3 * i];
		result += B * Math.cos(w * t + o);
	}

	result += params[params.length - 1]; // O
	return result;
}

/**
 * Compute residuals and Jacobian matrix
 */
function computeResidualsAndJacobian(t, x, params, N) {
	const m = t.length;
	const n = params.length;
	const residuals = new Array(m);
	const jacobian = Array.from({ length: m }, () => new Array(n));

	for (let i = 0; i < m; i++) {
		const ti = t[i];
		const predicted = evaluateModel(ti, params, N);
		residuals[i] = x[i] - predicted;

		// Partial derivatives
		jacobian[i][0] = -1; // ∂/∂A

		for (let j = 0; j < N; j++) {
			const B = params[1 + 3 * j];
			const w = params[2 + 3 * j];
			const o = params[3 + 3 * j];
			const cosArg = w * ti + o;
			const sinArg = Math.sin(cosArg);
			const cosValue = Math.cos(cosArg);

			jacobian[i][1 + 3 * j] = -cosValue; // ∂/∂B_j
			jacobian[i][2 + 3 * j] = B * ti * sinArg; // ∂/∂w_j
			jacobian[i][3 + 3 * j] = B * sinArg; // ∂/∂o_j
		}

		jacobian[i][n - 1] = -1; // ∂/∂O
	}

	return { residuals, jacobian };
}

/**
 * Generate initial parameter guess
 */
function generateInitialGuess(t, x, N) {
	const mean = x.reduce((sum, val) => sum + val, 0) / x.length;
	const range = Math.max(...x) - Math.min(...x);

	const params = [];

	// Initial A (DC component)
	params.push(mean);

	// Estimate dominant period using autocorrelation
	const estimatedPeriod = estimatePeriod(t, x);
	const fundamentalFreq =
		estimatedPeriod > 0
			? (2 * Math.PI) / estimatedPeriod
			: (2 * Math.PI) / (t[t.length - 1] - t[0]);

	// Initial parameters for each cosine
	for (let i = 0; i < N; i++) {
		params.push(range / (2 * N)); // B_i (amplitude)

		// Use harmonics of the estimated fundamental frequency
		if (i === 0) {
			params.push(fundamentalFreq); // First cosine uses fundamental frequency
		} else {
			params.push(fundamentalFreq * (i + 1)); // Subsequent cosines use harmonics
		}

		params.push(Math.random() * 2 * Math.PI); // o_i (phase)
	}

	return params;
}

/**
 * Estimate the dominant period in the data using autocorrelation
 */
function estimatePeriod(t, x) {
	if (t.length < 10) return 0; // Need sufficient data points

	// Remove DC component for better period detection
	const mean = x.reduce((sum, val) => sum + val, 0) / x.length;
	const detrended = x.map((val) => val - mean);

	// Check if data is uniformly spaced
	const dt = t[1] - t[0];
	const isUniformlySpaced = t.every((val, i) => i === 0 || Math.abs(val - t[i - 1] - dt) < 1e-10);

	if (isUniformlySpaced) {
		return estimatePeriodUniform(detrended, dt);
	} else {
		return estimatePeriodNonUniform(t, detrended);
	}
}

/**
 * Estimate period for uniformly spaced data using autocorrelation
 */
function estimatePeriodUniform(x, dt) {
	const n = x.length;
	const maxLag = Math.floor(n / 3); // Don't search beyond 1/3 of data length

	let maxCorr = -1;
	let bestLag = 0;

	// Compute autocorrelation for different lags
	for (let lag = 1; lag < maxLag; lag++) {
		let corr = 0;
		let count = 0;

		for (let i = 0; i < n - lag; i++) {
			corr += x[i] * x[i + lag];
			count++;
		}

		if (count > 0) {
			corr /= count;

			// Look for first significant peak after lag > 2
			if (lag > 2 && corr > maxCorr) {
				maxCorr = corr;
				bestLag = lag;
			}
		}
	}

	return bestLag > 0 ? bestLag * dt : 0;
}

/**
 * Estimate period for non-uniformly spaced data
 */
function estimatePeriodNonUniform(t, x) {
	const n = t.length;
	const totalTime = t[n - 1] - t[0];
	const avgDt = totalTime / (n - 1);

	// Test different period candidates
	const minPeriod = 4 * avgDt; // At least 4 samples per period
	const maxPeriod = totalTime / 3; // At most 3 periods in total time
	const numCandidates = 50;

	let maxScore = -1;
	let bestPeriod = 0;

	for (let i = 0; i < numCandidates; i++) {
		const period = minPeriod + ((maxPeriod - minPeriod) * i) / (numCandidates - 1);
		const score = scorePeriodCandidate(t, x, period);

		if (score > maxScore) {
			maxScore = score;
			bestPeriod = period;
		}
	}

	return bestPeriod;
}

/**
 * Score a period candidate by measuring phase consistency
 */
function scorePeriodCandidate(t, x, period) {
	const n = t.length;
	let sumCos = 0,
		sumSin = 0;

	// Convert data points to phases and compute phase consistency
	for (let i = 0; i < n; i++) {
		const phase = (2 * Math.PI * (t[i] % period)) / period;
		sumCos += x[i] * Math.cos(phase);
		sumSin += x[i] * Math.sin(phase);
	}

	// Return magnitude of the complex sum (higher = more periodic)
	return Math.sqrt(sumCos * sumCos + sumSin * sumSin) / n;
}

/**
 * Matrix operations helpers
 */
function transpose(matrix) {
	return matrix[0].map((_, i) => matrix.map((row) => row[i]));
}

function multiplyMatrices(A, B) {
	const result = Array.from({ length: A.length }, () => new Array(B[0].length));
	for (let i = 0; i < A.length; i++) {
		for (let j = 0; j < B[0].length; j++) {
			result[i][j] = 0;
			for (let k = 0; k < A[0].length; k++) {
				result[i][j] += A[i][k] * B[k][j];
			}
		}
	}
	return result;
}

function multiplyMatrixVector(A, b) {
	return A.map((row) => row.reduce((sum, val, i) => sum + val * b[i], 0));
}

function solveLinearSystem(A, b) {
	// Simple Gaussian elimination with partial pivoting
	const n = A.length;
	const augmented = A.map((row, i) => [...row, b[i]]);

	// Forward elimination
	for (let i = 0; i < n; i++) {
		// Find pivot
		let maxRow = i;
		for (let k = i + 1; k < n; k++) {
			if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
				maxRow = k;
			}
		}

		// Swap rows
		[augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];

		// Make all rows below this one 0 in current column
		for (let k = i + 1; k < n; k++) {
			const factor = augmented[k][i] / augmented[i][i];
			for (let j = i; j < n + 1; j++) {
				augmented[k][j] -= factor * augmented[i][j];
			}
		}
	}

	// Back substitution
	const solution = new Array(n);
	for (let i = n - 1; i >= 0; i--) {
		solution[i] = augmented[i][n];
		for (let j = i + 1; j < n; j++) {
			solution[i] -= augmented[i][j] * solution[j];
		}
		solution[i] /= augmented[i][i];
	}

	return solution;
}

// Example usage:
// const t = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
// const x = [1, 1.5, 0.8, 0.2, 0.9, 1.8, 1.2, 0.3, 0.7, 1.4, 1.1];
// const result = fitCosineCurves(t, x, 2);
// console.log(result);
