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
 * @param {boolean} options.useMultiStart - Use multiple random starts (default: true)
 * @param {number} options.numStarts - Number of random starts (default: 5)
 * @returns {Object} - Fitting results
 */
export function fitCosineCurves(t, x, N, options = {}) {
	if (t.length !== x.length) {
		throw new Error('Arrays t and x must have the same length');
	}

	const {
		initialGuess = null,
		maxIterations = 1000,
		tolerance = 1e-6,
		useMultiStart = true,
		numStarts = 5
	} = options;

	// If initial guess is provided, use it directly
	if (initialGuess) {
		return fitWithInitialGuess(t, x, N, initialGuess, maxIterations, tolerance);
	}

	// Use multi-start approach for better global optimization
	if (useMultiStart && N > 1) {
		return fitWithMultiStart(t, x, N, numStarts, maxIterations, tolerance);
	} else {
		// Single fit with improved initial guess
		const params = generateInitialGuess(t, x, N);
		return fitWithInitialGuess(t, x, N, params, maxIterations, tolerance);
	}
}

/**
 * Multi-start fitting approach
 */
function fitWithMultiStart(t, x, N, numStarts, maxIterations, tolerance) {
	let bestResult = null;
	let bestRmse = Infinity;

	// Try multiple different starting points
	for (let start = 0; start < numStarts; start++) {
		const params = generateInitialGuess(t, x, N, start);
		const result = fitWithInitialGuess(t, x, N, params, maxIterations, tolerance);

		if (result.rmse < bestRmse) {
			bestRmse = result.rmse;
			bestResult = result;
		}
	}

	return bestResult;
}

/**
 * Fit with given initial parameters
 */
function fitWithInitialGuess(t, x, N, initialParams, maxIterations, tolerance) {
	const numParams = 1 + 3 * N + 1; // A + 3*N + O
	let params = [...initialParams];

	if (params.length !== numParams) {
		throw new Error(`Initial guess must have ${numParams} parameters`);
	}

	// Levenberg-Marquardt optimization with adaptive lambda
	let lambda = 0.01;
	let prevError = Infinity;
	let stagnationCount = 0;

	for (let iter = 0; iter < maxIterations; iter++) {
		const { residuals, jacobian } = computeResidualsAndJacobian(t, x, params, N);
		const currentError = residuals.reduce((sum, r) => sum + r * r, 0);

		// Check for convergence
		if (Math.abs(prevError - currentError) < tolerance) {
			break;
		}

		// Check for stagnation and adjust lambda
		if (Math.abs(prevError - currentError) < tolerance * 10) {
			stagnationCount++;
			if (stagnationCount > 5) {
				lambda *= 10; // Increase damping
			}
		} else {
			stagnationCount = 0;
			lambda *= 0.9; // Decrease damping on progress
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

			// Update parameters with bounds checking
			for (let i = 0; i < params.length; i++) {
				params[i] -= delta[i];
			}

			// Apply reasonable bounds to frequencies to prevent runaway
			for (let i = 0; i < N; i++) {
				const freqIdx = 2 + 3 * i;
				params[freqIdx] = Math.max(0.01, Math.min(params[freqIdx], 100));
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
 * Fast and robust period estimation using FFT-like approach
 */
function estimateDominantPeriods(t, x, numPeriods = 3) {
	const n = t.length;
	if (n < 8) return [];

	// Remove DC component
	const mean = x.reduce((sum, val) => sum + val, 0) / x.length;
	const detrended = x.map((val) => val - mean);

	// Determine time range
	const tMin = Math.min(...t);
	const tMax = Math.max(...t);
	const totalTime = tMax - tMin;

	// Test candidate periods
	const minPeriod = totalTime / (n / 2); // At least 2 samples per period
	const maxPeriod = totalTime / 2; // At most 2 periods in data
	const numCandidates = Math.min(100, n);

	const candidates = [];

	for (let i = 0; i < numCandidates; i++) {
		const period = minPeriod + ((maxPeriod - minPeriod) * i) / (numCandidates - 1);
		const frequency = (2 * Math.PI) / period;
		const score = scorePeriodCandidate(t, detrended, frequency);
		candidates.push({ period, frequency, score });
	}

	// Sort by score and return top periods
	candidates.sort((a, b) => b.score - a.score);
	return candidates.slice(0, numPeriods);
}

/**
 * Score a frequency candidate using correlation with sine/cosine basis
 */
function scorePeriodCandidate(t, x, frequency) {
	let cosSum = 0,
		sinSum = 0,
		norm = 0;

	for (let i = 0; i < t.length; i++) {
		const phase = frequency * t[i];
		const cosVal = Math.cos(phase);
		const sinVal = Math.sin(phase);

		cosSum += x[i] * cosVal;
		sinSum += x[i] * sinVal;
		norm += x[i] * x[i];
	}

	// Return normalized correlation magnitude
	if (norm === 0) return 0;
	return Math.sqrt(cosSum * cosSum + sinSum * sinSum) / Math.sqrt(norm * t.length);
}

/**
 * Generate initial parameter guess with multiple strategies
 */
function generateInitialGuess(t, x, N, seed = 0) {
	const mean = x.reduce((sum, val) => sum + val, 0) / x.length;
	const std = Math.sqrt(x.reduce((sum, val) => sum + (val - mean) ** 2, 0) / x.length);

	const params = [];

	// Initial A (DC component) - start at zero since we'll add offset O
	params.push(0);

	// Get dominant periods
	const dominantPeriods = estimateDominantPeriods(t, x, Math.max(3, N));

	// Deterministic random generator for reproducible results
	const rng = createSeededRNG(seed);

	// Initial parameters for each cosine
	for (let i = 0; i < N; i++) {
		// Amplitude: use decreasing amplitudes based on data standard deviation
		const amplitude = std * (1 / (i + 1)) * (0.5 + 0.5 * rng());
		params.push(amplitude);

		// Frequency: use dominant periods if available, otherwise harmonics
		let frequency;
		if (i < dominantPeriods.length) {
			frequency = dominantPeriods[i].frequency;
		} else {
			// Use harmonics or random frequencies
			const baseFreq = dominantPeriods.length > 0 ? dominantPeriods[0].frequency : 2 * Math.PI;
			frequency = baseFreq * (i + 1) * (0.5 + rng());
		}
		params.push(frequency);

		// Phase: deterministic based on seed and index
		const phase = ((2 * Math.PI * (seed * 7 + i * 11)) / 17) % (2 * Math.PI);
		params.push(phase);
	}

	// Initial O (offset)
	params.push(mean);

	return params;
}

/**
 * Simple seeded random number generator for reproducible results
 */
function createSeededRNG(seed) {
	let state = seed || 12345;
	return function () {
		state = (state * 1103515245 + 12345) % 2 ** 31;
		return state / 2 ** 31;
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

		// Check for singular matrix
		if (Math.abs(augmented[i][i]) < 1e-12) {
			throw new Error('Matrix is singular or near-singular');
		}

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
// console.log('Parameters:', result.parameters);
// console.log('RMSE:', result.rmse);
