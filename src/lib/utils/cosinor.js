// @ts-nocheck
import { KahanSum } from './numerics.js';
import { pf, qt } from '$lib/data/CDFs.js';
import { min, max } from './MathsStats.js';

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
		maxIterations = 10000,
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
 * Evaluate the fitted cosinor model at an array of x points.
 * Use this after fitting to predict values at arbitrary x locations.
 *
 * @param {Object} parameters - The parameters object returned by fitCosineCurves
 * @param {number[]} xPoints - x values at which to evaluate the model
 * @returns {number[]} - Predicted y values
 */
export function evaluateCosinorAtPoints(parameters, xPoints) {
	return xPoints.map((t) => {
		let result = parameters.A;
		for (const cosine of parameters.cosines) {
			result += cosine.amplitude * Math.cos(cosine.frequency * t + cosine.phase);
		}
		result += parameters.O;
		return result;
	});
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

		// Calculate current error using Kahan summation
		const errorAcc = new KahanSum();
		for (let i = 0; i < residuals.length; i++) {
			errorAcc.add(residuals[i] * residuals[i]);
		}
		const currentError = errorAcc.value;

		// Check for convergence
		const errorDiff = Math.abs(prevError - currentError);
		if (errorDiff < tolerance) {
			break;
		}

		// Check for stagnation and adjust lambda
		if (errorDiff < tolerance * 10) {
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

	// Compute final statistics using Kahan summation
	const { residuals } = computeResidualsAndJacobian(t, x, params, N);
	const rssAcc = new KahanSum();
	for (let i = 0; i < residuals.length; i++) {
		rssAcc.add(residuals[i] * residuals[i]);
	}
	const rssValue = rssAcc.value;
	const rmse = Math.sqrt(rssValue / t.length);

	// Compute R²
	const xMeanAcc = new KahanSum();
	for (let i = 0; i < x.length; i++) xMeanAcc.add(x[i]);
	const xMean = xMeanAcc.value / x.length;
	const sstotAcc = new KahanSum();
	for (let i = 0; i < x.length; i++) sstotAcc.add((x[i] - xMean) ** 2);
	const rSquared = sstotAcc.value > 0 ? 1 - rssValue / sstotAcc.value : 0;

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
		rSquared: rSquared,
		rss: rssValue
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
	const tMin = min(t);
	const tMax = max(t);
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

	// For N=1, use a smarter initial guess
	if (N === 1) {
		// Remove mean for better frequency/amplitude estimation
		const detrended = x.map((val) => val - mean);

		// Get dominant period
		const dominantPeriods = estimateDominantPeriods(t, x, 1);
		const frequency = dominantPeriods.length > 0 ? dominantPeriods[0].frequency : 2 * Math.PI;

		// Estimate amplitude and phase using least squares fit for given frequency
		let cosSum = 0,
			sinSum = 0;
		for (let i = 0; i < t.length; i++) {
			cosSum += detrended[i] * Math.cos(frequency * t[i]);
			sinSum += detrended[i] * Math.sin(frequency * t[i]);
		}
		cosSum *= 2 / t.length;
		sinSum *= 2 / t.length;

		// Convert to amplitude and phase: B*cos(wt + o) = a*cos(wt) + b*sin(wt)
		// where a = B*cos(o), b = -B*sin(o)
		const amplitude = Math.sqrt(cosSum * cosSum + sinSum * sinSum);
		const phase = -Math.atan2(sinSum, cosSum);

		params.push(0); // A (DC component)
		params.push(amplitude); // B (amplitude)
		params.push(frequency); // w (frequency)
		params.push(phase); // o (phase)
		params.push(mean); // O (offset)

		return params;
	}

	// Original multi-cosine logic
	params.push(0);

	const dominantPeriods = estimateDominantPeriods(t, x, Math.max(3, N));
	const rng = createSeededRNG(seed);

	for (let i = 0; i < N; i++) {
		const amplitude = std * (1 / (i + 1)) * (0.5 + 0.5 * rng());
		params.push(amplitude);

		let frequency;
		if (i < dominantPeriods.length) {
			frequency = dominantPeriods[i].frequency;
		} else {
			const baseFreq = dominantPeriods.length > 0 ? dominantPeriods[0].frequency : 2 * Math.PI;
			frequency = baseFreq * (i + 1) * (0.5 + rng());
		}
		params.push(frequency);

		const phase = ((2 * Math.PI * (seed * 7 + i * 11)) / 17) % (2 * Math.PI);
		params.push(phase);
	}

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
		jacobian[i][0] = -1; // dF/dA

		for (let j = 0; j < N; j++) {
			const B = params[1 + 3 * j];
			const w = params[2 + 3 * j];
			const o = params[3 + 3 * j];
			const cosArg = w * ti + o;
			const sinArg = Math.sin(cosArg);
			const cosValue = Math.cos(cosArg);

			jacobian[i][1 + 3 * j] = -cosValue; // dF/dB_j
			jacobian[i][2 + 3 * j] = B * ti * sinArg; // dF/dw_j
			jacobian[i][3 + 3 * j] = B * sinArg; // dF/do_j
		}

		jacobian[i][n - 1] = -1; // dF/dO
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
			const acc = new KahanSum();
			for (let k = 0; k < A[0].length; k++) {
				acc.add(A[i][k] * B[k][j]);
			}
			result[i][j] = acc.value;
		}
	}
	return result;
}

function multiplyMatrixVector(A, b) {
	return A.map((row) => {
		const acc = new KahanSum();
		for (let i = 0; i < row.length; i++) {
			acc.add(row[i] * b[i]);
		}
		return acc.value;
	});
}

function solveLinearSystem(A, b) {
	// Gaussian elimination with partial pivoting — native arithmetic
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
		let sum = augmented[i][n];
		for (let j = i + 1; j < n; j++) {
			sum -= augmented[i][j] * solution[j];
		}
		solution[i] = sum / augmented[i][i];
	}

	return solution;
}

/**
 * Classical (fixed-period) cosinor analysis via ordinary least squares.
 * Model: Y(t) = M + Σ_k [ β_k·cos(kωt) + γ_k·sin(kωt) ],  ω = 2π/period
 *
 * Returns mesor, per-harmonic amplitude & acrophase with CIs (delta method),
 * overall F-test for rhythm significance, R², and RMSE.
 *
 * @param {number[]} t          - Time values (same units as period)
 * @param {number[]} y          - Data values
 * @param {number}   period     - Fixed period (default 24)
 * @param {number}   nHarmonics - Number of harmonics to fit (default 1)
 * @param {number}   alpha      - Significance level for CIs (default 0.05)
 * @returns {Object|null}
 */
export function fitCosinorFixed(t, y, period = 24, nHarmonics = 1, alpha = 0.05) {
	const n = t.length;
	const nParams = 2 * nHarmonics + 1; // mesor + 2 coefficients per harmonic
	const df_res = n - nParams;
	if (df_res < 1) return null;

	const omega = (2 * Math.PI) / period;

	// Build design matrix X: columns = [1, cos(ωt), sin(ωt), cos(2ωt), sin(2ωt), ...]
	const X = t.map((ti) => {
		const row = [1];
		for (let k = 1; k <= nHarmonics; k++) {
			row.push(Math.cos(k * omega * ti));
			row.push(Math.sin(k * omega * ti));
		}
		return row;
	});

	// Compute XᵀX and Xᵀy
	const XtX = Array.from({ length: nParams }, () => new Array(nParams).fill(0));
	const Xty = new Array(nParams).fill(0);
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < nParams; j++) {
			Xty[j] += X[i][j] * y[i];
			for (let k = 0; k < nParams; k++) {
				XtX[j][k] += X[i][j] * X[i][k];
			}
		}
	}

	// Solve OLS: coeffs = (XᵀX)⁻¹ Xᵀy
	let coeffs;
	try {
		coeffs = solveLinearSystem(XtX, Xty);
	} catch (_) {
		return null;
	}

	const M = coeffs[0]; // mesor

	// Fitted values and residuals
	const yMeanAcc = new KahanSum();
	for (let i = 0; i < n; i++) yMeanAcc.add(y[i]);
	const yMean = yMeanAcc.value / n;

	const fitted = t.map((ti) => {
		let val = M;
		for (let k = 1; k <= nHarmonics; k++) {
			val += coeffs[2 * k - 1] * Math.cos(k * omega * ti);
			val += coeffs[2 * k] * Math.sin(k * omega * ti);
		}
		return val;
	});

	// Sums of squares (Kahan)
	const sstotAcc = new KahanSum();
	const ssresAcc = new KahanSum();
	for (let i = 0; i < n; i++) {
		sstotAcc.add((y[i] - yMean) ** 2);
		ssresAcc.add((y[i] - fitted[i]) ** 2);
	}
	const SStot = sstotAcc.value;
	const SSres = ssresAcc.value;
	const SSreg = SStot - SSres;
	const MSE = SSres / df_res;
	const RMSE = Math.sqrt(MSE);
	const R2 = SStot > 0 ? 1 - SSres / SStot : 0;

	// F-test: H₀ — all harmonic coefficients are zero
	const F_stat = MSE > 0 ? SSreg / (2 * nHarmonics) / MSE : NaN;
	const pF = isNaN(F_stat) ? NaN : pf(F_stat, 2 * nHarmonics, df_res, 1);

	// Covariance matrix V = MSE · (XᵀX)⁻¹  via solving nParams systems
	const XtX_inv = Array.from({ length: nParams }, () => new Array(nParams).fill(0));
	for (let col = 0; col < nParams; col++) {
		const e = new Array(nParams).fill(0);
		e[col] = 1;
		try {
			const sol = solveLinearSystem(XtX, e);
			for (let row = 0; row < nParams; row++) XtX_inv[row][col] = sol[row];
		} catch (_) {
			/* leave column as zeros */
		}
	}

	// t-critical value for (1 − alpha) confidence intervals
	// qt(1 − α/2, df_res, ptype=0) gives the upper-tail critical value
	const t_crit = qt(1 - alpha / 2, df_res, 0);

	// Mesor CI
	const SE_M = Math.sqrt(Math.max(0, MSE * XtX_inv[0][0]));
	const CI_M = [M - t_crit * SE_M, M + t_crit * SE_M];

	// Per-harmonic statistics
	const harmonics = [];
	for (let k = 1; k <= nHarmonics; k++) {
		const bIdx = 2 * k - 1; // index of beta_k in coeffs
		const gIdx = 2 * k; // index of gamma_k in coeffs
		const beta_k = coeffs[bIdx];
		const gamma_k = coeffs[gIdx];

		const A_k = Math.sqrt(beta_k ** 2 + gamma_k ** 2);
		const phi_k = Math.atan2(-gamma_k, beta_k); // acrophase in radians

		// Acrophase in hours, normalised to [0, period/k)
		let acrophase_hrs = (phi_k * period) / (2 * Math.PI * k);
		if (acrophase_hrs < 0) acrophase_hrs += period / k;

		const varBeta = MSE * XtX_inv[bIdx][bIdx];
		const varGamma = MSE * XtX_inv[gIdx][gIdx];

		// Delta method — amplitude
		const varA = A_k > 0 ? (beta_k ** 2 * varBeta + gamma_k ** 2 * varGamma) / A_k ** 2 : 0;
		const SE_A = Math.sqrt(Math.max(0, varA));
		const CI_A = [Math.max(0, A_k - t_crit * SE_A), A_k + t_crit * SE_A];

		// Delta method — acrophase (radians → hours)
		const varPhi = A_k > 0 ? (gamma_k ** 2 * varBeta + beta_k ** 2 * varGamma) / A_k ** 4 : 0;
		const SE_acrophase_hrs = Math.sqrt(Math.max(0, varPhi)) * period / (2 * Math.PI * k);
		const CI_acrophase = [
			acrophase_hrs - t_crit * SE_acrophase_hrs,
			acrophase_hrs + t_crit * SE_acrophase_hrs
		];

		harmonics.push({ k, beta: beta_k, gamma: gamma_k, amplitude: A_k, acrophase_hrs, phi_rad: phi_k, SE_A, SE_acrophase_hrs, CI_A, CI_acrophase });
	}

	return { M, SE_M, CI_M, harmonics, F_stat, df: [2 * nHarmonics, df_res], pF, R2, RMSE, fitted, n, period, nHarmonics, alpha };
}
