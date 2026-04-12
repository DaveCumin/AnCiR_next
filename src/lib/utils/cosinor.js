// @ts-nocheck
import { KahanSum } from './numerics.js';
import { pf, qt } from '$lib/data/CDFs.js';
import { min, max } from './MathsStats.js';

/**
 * Fits a model comprised of N cosine curves to data.
 * Model: O + Σ B_i·cos(ω_i·t + φ_i)
 *
 * @param {number[]} t - Time/input array
 * @param {number[]} x - Data/output array
 * @param {number} N - Number of cosine curves
 * @param {Object} options
 * @param {number[]} options.initialGuess - Optional initial params [B1,w1,o1,...,BN,wN,oN,O]
 * @param {number} options.maxIterations   - Max LM iterations per start (default 2000)
 * @param {number} options.tolerance       - Relative convergence tolerance (default 1e-7)
 * @param {boolean} options.useMultiStart  - Multiple random starts (default true)
 * @param {number} options.numStarts       - Number of starts (default 5)
 * @returns {Object} Fitting results
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

	if (initialGuess) {
		return fitWithInitialGuess(t, x, N, initialGuess, maxIterations, tolerance);
	}

	if (useMultiStart && N > 1) {
		return fitWithMultiStart(t, x, N, numStarts, maxIterations, tolerance);
	} else {
		const params = generateInitialGuess(t, x, N, 0);
		return fitWithInitialGuess(t, x, N, params, maxIterations, tolerance);
	}
}

/**
 * Evaluate the fitted cosinor model at an array of x points.
 */
export function evaluateCosinorAtPoints(parameters, xPoints) {
	return xPoints.map((t) => {
		let result = parameters.A; // A is always 0 for free fits; kept for API compat
		for (const cosine of parameters.cosines) {
			result += cosine.amplitude * Math.cos(cosine.frequency * t + cosine.phase);
		}
		result += parameters.O;
		return result;
	});
}

// ─── Multi-start ─────────────────────────────────────────────────────────────

function fitWithMultiStart(t, x, N, numStarts, maxIterations, tolerance) {
	let bestResult = null;
	let bestRmse = Infinity;

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

// ─── Core LM optimizer ───────────────────────────────────────────────────────

/**
 * Levenberg-Marquardt with proper step rejection and relative convergence.
 * Parameter layout: [B0, w0, o0,  B1, w1, o1,  …,  O]
 */
function fitWithInitialGuess(t, x, N, initialParams, maxIterations, tolerance) {
	const numParams = 3 * N + 1; // no redundant A term
	let params = [...initialParams];

	if (params.length !== numParams) {
		throw new Error(`Initial guess must have ${numParams} parameters`);
	}

	let lambda = 0.01;
	let { JtJ, JtR, rss: currentRss } = computeNormalEquations(t, x, params, N);

	for (let iter = 0; iter < maxIterations; iter++) {
		// Damp diagonal: use JtJ[i][i] scaling (Marquardt's original scaling)
		const JtJ_d = JtJ.map((row, i) => {
			const r = row.slice();
			r[i] += lambda * (row[i] > 0 ? row[i] : 1);
			return r;
		});

		let delta;
		try {
			delta = solveLinearSystem(JtJ_d, JtR.slice());
		} catch {
			lambda = Math.min(lambda * 10, 1e12);
			if (lambda >= 1e12) break;
			continue;
		}

		// Proposed new parameters
		const newParams = params.map((p, i) => p - delta[i]);
		// Frequency must stay positive and reasonable
		for (let i = 0; i < N; i++) {
			newParams[3 * i + 1] = Math.max(0.001, Math.min(newParams[3 * i + 1], 100));
		}

		const { JtJ: newJtJ, JtR: newJtR, rss: newRss } = computeNormalEquations(t, x, newParams, N);

		if (newRss < currentRss) {
			// Accept step — check relative improvement for convergence
			const relImprovement = (currentRss - newRss) / (currentRss + 1e-10);
			params = newParams;
			JtJ = newJtJ;
			JtR = newJtR;
			currentRss = newRss;
			lambda = Math.max(lambda / 3, 1e-10);
			if (relImprovement < tolerance) break;
		} else {
			// Reject step — increase damping
			lambda = Math.min(lambda * 10, 1e12);
			if (lambda >= 1e12) break;
		}
	}

	// Final statistics
	const residuals = t.map((ti, i) => x[i] - evaluateModel(ti, params, N));
	const rmse = Math.sqrt(currentRss / t.length);

	const xMeanAcc = new KahanSum();
	for (const v of x) xMeanAcc.add(v);
	const xMean = xMeanAcc.value / x.length;
	const sstotAcc = new KahanSum();
	for (const v of x) sstotAcc.add((v - xMean) ** 2);
	const rSquared = sstotAcc.value > 0 ? 1 - currentRss / sstotAcc.value : 0;

	return {
		parameters: {
			A: 0, // kept for API compatibility with evaluateCosinorAtPoints
			cosines: Array.from({ length: N }, (_, i) => ({
				amplitude: params[3 * i],
				frequency: params[3 * i + 1],
				phase: params[3 * i + 2]
			})),
			O: params[params.length - 1]
		},
		fitted: t.map((ti) => evaluateModel(ti, params, N)),
		residuals,
		rmse,
		rSquared,
		rss: currentRss
	};
}

// ─── Model evaluation ─────────────────────────────────────────────────────────

function evaluateModel(t, params, N) {
	// Layout: [B0, w0, o0, …, BN-1, wN-1, oN-1, O]
	let result = params[params.length - 1]; // O
	for (let i = 0; i < N; i++) {
		result += params[3 * i] * Math.cos(params[3 * i + 1] * t + params[3 * i + 2]);
	}
	return result;
}

// ─── Normal equations (JᵀJ and Jᵀr) in one pass ─────────────────────────────

/**
 * Accumulate JᵀJ and Jᵀr directly without materialising the full m×n Jacobian.
 * Dramatically reduces memory use for large datasets and improves cache locality.
 */
function computeNormalEquations(t, x, params, N) {
	const n = params.length; // 3N+1
	// Use flat arrays for JtJ for speed; symmetrise at the end
	const JtJ = Array.from({ length: n }, () => new Array(n).fill(0));
	const JtR = new Array(n).fill(0);
	let rss = 0;

	for (let i = 0; i < t.length; i++) {
		const ti = t[i];
		const predicted = evaluateModel(ti, params, N);
		const r = x[i] - predicted;
		rss += r * r;

		// Jacobian row: ∂residual/∂param_k  (residual = x - predicted)
		// ∂residual/∂B_j  = -cos(w_j·t + o_j)
		// ∂residual/∂w_j  =  B_j·t·sin(w_j·t + o_j)
		// ∂residual/∂o_j  =  B_j·sin(w_j·t + o_j)
		// ∂residual/∂O    = -1
		const jRow = new Array(n);
		for (let j = 0; j < N; j++) {
			const B = params[3 * j];
			const arg = params[3 * j + 1] * ti + params[3 * j + 2];
			const s = Math.sin(arg);
			const c = Math.cos(arg);
			jRow[3 * j] = -c;
			jRow[3 * j + 1] = B * ti * s;
			jRow[3 * j + 2] = B * s;
		}
		jRow[n - 1] = -1;

		// Accumulate upper triangle of JᵀJ and JᵀR
		for (let j = 0; j < n; j++) {
			JtR[j] += jRow[j] * r;
			for (let k = j; k < n; k++) {
				JtJ[j][k] += jRow[j] * jRow[k];
			}
		}
	}

	// Symmetrise JᵀJ
	for (let j = 0; j < n; j++) for (let k = j + 1; k < n; k++) JtJ[k][j] = JtJ[j][k];

	return { JtJ, JtR, rss };
}

// ─── Period/frequency scanner ─────────────────────────────────────────────────

function estimateDominantPeriods(t, x, numPeriods = 3) {
	const n = t.length;
	if (n < 8) return [];

	const mean = x.reduce((s, v) => s + v, 0) / n;
	const detrended = x.map((v) => v - mean);

	const tMin = min(t);
	const tMax = max(t);
	const totalTime = tMax - tMin;

	const minPeriod = totalTime / (n / 2); // ≥2 samples per period
	const maxPeriod = totalTime * 0.75; // allows ~1.3 periods in window
	const numCandidates = Math.min(500, n * 5);

	const candidates = [];
	for (let i = 0; i < numCandidates; i++) {
		const period = minPeriod + ((maxPeriod - minPeriod) * i) / (numCandidates - 1);
		const frequency = (2 * Math.PI) / period;
		candidates.push({ period, frequency, score: scorePeriodCandidate(t, detrended, frequency) });
	}

	candidates.sort((a, b) => b.score - a.score);
	return candidates.slice(0, numPeriods);
}

function scorePeriodCandidate(t, x, frequency) {
	let cosSum = 0,
		sinSum = 0,
		norm = 0;
	for (let i = 0; i < t.length; i++) {
		const phase = frequency * t[i];
		cosSum += x[i] * Math.cos(phase);
		sinSum += x[i] * Math.sin(phase);
		norm += x[i] * x[i];
	}
	if (norm === 0) return 0;
	return Math.sqrt(cosSum * cosSum + sinSum * sinSum) / Math.sqrt(norm * t.length);
}

// ─── Initial guess generation ─────────────────────────────────────────────────

function generateInitialGuess(t, x, N, seed = 0) {
	const mean = x.reduce((s, v) => s + v, 0) / x.length;
	const std = Math.sqrt(x.reduce((s, v) => s + (v - mean) ** 2, 0) / x.length);

	const params = [];

	if (N === 1) {
		// For multi-start N=1: seed selects which top-ranked period to try
		const numCandidatePeriods = 5;
		const dominantPeriods = estimateDominantPeriods(t, x, numCandidatePeriods);
		const periodIdx = Math.min(seed, dominantPeriods.length - 1);
		const frequency =
			dominantPeriods.length > 0 ? dominantPeriods[periodIdx].frequency : (2 * Math.PI) / 24;

		// Amplitude & phase from projection onto cos/sin at detected frequency
		const detrended = x.map((v) => v - mean);
		let cosSum = 0,
			sinSum = 0;
		for (let i = 0; i < t.length; i++) {
			cosSum += detrended[i] * Math.cos(frequency * t[i]);
			sinSum += detrended[i] * Math.sin(frequency * t[i]);
		}
		cosSum *= 2 / t.length;
		sinSum *= 2 / t.length;

		const amplitude = Math.sqrt(cosSum * cosSum + sinSum * sinSum);
		const phase = -Math.atan2(sinSum, cosSum);

		// Layout: [B, w, o, O]
		params.push(amplitude, frequency, phase, mean);
		return params;
	}

	// Multi-cosine — layout: [B0,w0,o0, …, BN-1,wN-1,oN-1, O]
	const dominantPeriods = estimateDominantPeriods(t, x, Math.max(3, N));
	const rng = createSeededRNG(seed);

	for (let i = 0; i < N; i++) {
		params.push(std * (1 / (i + 1)) * (0.5 + 0.5 * rng())); // B_i
		const frequency =
			i < dominantPeriods.length
				? dominantPeriods[i].frequency
				: (dominantPeriods[0]?.frequency ?? (2 * Math.PI) / 24) * (i + 1) * (0.5 + rng());
		params.push(frequency); // w_i
		params.push(((2 * Math.PI * (seed * 7 + i * 11)) / 17) % (2 * Math.PI)); // o_i
	}
	params.push(mean); // O

	return params;
}

function createSeededRNG(seed) {
	let state = seed || 12345;
	return function () {
		state = (state * 1103515245 + 12345) % 2 ** 31;
		return state / 2 ** 31;
	};
}

// ─── Gaussian elimination with partial pivoting ───────────────────────────────

function solveLinearSystem(A, b) {
	const n = A.length;
	const aug = A.map((row, i) => [...row, b[i]]);

	for (let i = 0; i < n; i++) {
		let maxRow = i;
		for (let k = i + 1; k < n; k++) {
			if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) maxRow = k;
		}
		[aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];

		if (Math.abs(aug[i][i]) < 1e-12) throw new Error('Singular matrix');

		for (let k = i + 1; k < n; k++) {
			const f = aug[k][i] / aug[i][i];
			for (let j = i; j <= n; j++) aug[k][j] -= f * aug[i][j];
		}
	}

	const sol = new Array(n);
	for (let i = n - 1; i >= 0; i--) {
		let s = aug[i][n];
		for (let j = i + 1; j < n; j++) s -= aug[i][j] * sol[j];
		sol[i] = s / aug[i][i];
	}
	return sol;
}

// ─── Classical (fixed-period / Halberg) cosinor via OLS ──────────────────────

/**
 * Model: Y(t) = M + Σ_k [ β_k·cos(kωt) + γ_k·sin(kωt) ],  ω = 2π/period
 */
export function fitCosinorFixed(t, y, period = 24, nHarmonics = 1, alpha = 0.05) {
	const n = t.length;
	const nParams = 2 * nHarmonics + 1;
	const df_res = n - nParams;
	if (df_res < 1) return null;

	const omega = (2 * Math.PI) / period;

	const X = t.map((ti) => {
		const row = [1];
		for (let k = 1; k <= nHarmonics; k++) {
			row.push(Math.cos(k * omega * ti));
			row.push(Math.sin(k * omega * ti));
		}
		return row;
	});

	const XtX = Array.from({ length: nParams }, () => new Array(nParams).fill(0));
	const Xty = new Array(nParams).fill(0);
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < nParams; j++) {
			Xty[j] += X[i][j] * y[i];
			for (let k = 0; k < nParams; k++) XtX[j][k] += X[i][j] * X[i][k];
		}
	}

	let coeffs;
	try {
		coeffs = solveLinearSystem(XtX, Xty);
	} catch {
		return null;
	}

	const M = coeffs[0];

	const yMeanAcc = new KahanSum();
	for (const v of y) yMeanAcc.add(v);
	const yMean = yMeanAcc.value / n;

	const fitted = t.map((ti) => {
		let val = M;
		for (let k = 1; k <= nHarmonics; k++) {
			val += coeffs[2 * k - 1] * Math.cos(k * omega * ti);
			val += coeffs[2 * k] * Math.sin(k * omega * ti);
		}
		return val;
	});

	const sstotAcc = new KahanSum();
	const ssresAcc = new KahanSum();
	for (let i = 0; i < n; i++) {
		sstotAcc.add((y[i] - yMean) ** 2);
		ssresAcc.add((y[i] - fitted[i]) ** 2);
	}
	const SStot = sstotAcc.value;
	const SSres = ssresAcc.value;
	const MSE = SSres / df_res;
	const RMSE = Math.sqrt(MSE);
	const R2 = SStot > 0 ? 1 - SSres / SStot : 0;
	const F_stat = MSE > 0 ? (SStot - SSres) / (2 * nHarmonics) / MSE : NaN;
	const pF = isNaN(F_stat) ? NaN : pf(F_stat, 2 * nHarmonics, df_res, 1);

	// Covariance matrix V = MSE · (XᵀX)⁻¹
	const XtX_inv = Array.from({ length: nParams }, () => new Array(nParams).fill(0));
	for (let col = 0; col < nParams; col++) {
		const e = new Array(nParams).fill(0);
		e[col] = 1;
		try {
			const sol = solveLinearSystem(XtX, e);
			for (let row = 0; row < nParams; row++) XtX_inv[row][col] = sol[row];
		} catch {
			/* leave as zeros */
		}
	}

	const t_crit = qt(1 - alpha / 2, df_res, 0);

	const SE_M = Math.sqrt(Math.max(0, MSE * XtX_inv[0][0]));
	const CI_M = [M - t_crit * SE_M, M + t_crit * SE_M];

	const harmonics = [];
	for (let k = 1; k <= nHarmonics; k++) {
		const bIdx = 2 * k - 1;
		const gIdx = 2 * k;
		const beta_k = coeffs[bIdx];
		const gamma_k = coeffs[gIdx];

		const A_k = Math.sqrt(beta_k ** 2 + gamma_k ** 2);
		const phi_k = Math.atan2(-gamma_k, beta_k);

		let acrophase_hrs = (phi_k * period) / (2 * Math.PI * k);
		if (acrophase_hrs < 0) acrophase_hrs += period / k;

		const varBeta = MSE * XtX_inv[bIdx][bIdx];
		const varGamma = MSE * XtX_inv[gIdx][gIdx];

		const varA = A_k > 0 ? (beta_k ** 2 * varBeta + gamma_k ** 2 * varGamma) / A_k ** 2 : 0;
		const SE_A = Math.sqrt(Math.max(0, varA));
		const CI_A = [Math.max(0, A_k - t_crit * SE_A), A_k + t_crit * SE_A];

		const varPhi = A_k > 0 ? (gamma_k ** 2 * varBeta + beta_k ** 2 * varGamma) / A_k ** 4 : 0;
		const SE_acrophase_hrs = (Math.sqrt(Math.max(0, varPhi)) * period) / (2 * Math.PI * k);
		const CI_acrophase = [
			acrophase_hrs - t_crit * SE_acrophase_hrs,
			acrophase_hrs + t_crit * SE_acrophase_hrs
		];

		harmonics.push({
			k,
			beta: beta_k,
			gamma: gamma_k,
			amplitude: A_k,
			acrophase_hrs,
			phi_rad: phi_k,
			SE_A,
			SE_acrophase_hrs,
			CI_A,
			CI_acrophase
		});
	}

	return {
		M,
		SE_M,
		CI_M,
		harmonics,
		F_stat,
		df: [2 * nHarmonics, df_res],
		pF,
		R2,
		RMSE,
		fitted,
		n,
		period,
		nHarmonics,
		alpha
	};
}
