// @ts-nocheck
import { KahanSum } from './numerics.js';
import { min, max } from './MathsStats.js';

/**
 * Fits a rectangular (square) wave model to data using a tanh approximation.
 * Model: f(t) = M + A·tanh(κ·(sin(ω·t + φ) − cos(π·d)))
 *
 * Parameters (full vector index):
 *   0: M  — mesor (baseline level)
 *   1: A  — half-amplitude
 *   2: κ  — sharpness (larger → more square; optionally fixed)
 *   3: ω  — angular frequency = 2π/period (optionally fixed)
 *   4: φ  — phase offset in radians (always free)
 *   5: d  — duty cycle ∈ (0,1) (optionally fixed)
 *
 * M, A and φ are always free; κ, ω and d can each be pinned.
 *
 * @param {number[]} t       - Time/input array (hours)
 * @param {number[]} x       - Data/output array
 * @param {Object}  options
 * @param {boolean} options.fixKappa      - Pin κ to fixedKappa
 * @param {boolean} options.fixOmega      - Pin ω to fixedOmega
 * @param {boolean} options.fixDutyCycle  - Pin d to fixedDutyCycle
 * @param {number}  options.fixedKappa    - Value to use when fixKappa=true  (default 5)
 * @param {number}  options.fixedOmega    - Value to use when fixOmega=true  (required if fixOmega)
 * @param {number}  options.fixedDutyCycle- Value to use when fixDutyCycle=true (default 0.5)
 * @param {number}  options.maxIterations - Max LM iterations per start (default 2000)
 * @param {number}  options.tolerance     - Relative convergence tolerance  (default 1e-7)
 * @param {number}  options.numStarts     - Number of multi-starts (default 5)
 * @returns {Object} Fitting result
 */
export function fitRectangularWave(t, x, options = {}) {
	if (t.length !== x.length) throw new Error('Arrays t and x must have the same length');

	const {
		fixKappa = false,
		fixOmega = false,
		fixDutyCycle = false,
		fixedKappa = 5,
		fixedOmega = null,
		fixedDutyCycle = 0.5,
		maxIterations = 10000,
		tolerance = 1e-6,
		numStarts = 5
	} = options;

	// M=0, A=1, κ=2, ω=3, φ=4, d=5 — always free: 0,1,4
	const freeIndices = [0, 1, 4];
	if (!fixKappa) freeIndices.push(2);
	if (!fixOmega) freeIndices.push(3);
	if (!fixDutyCycle) freeIndices.push(5);
	freeIndices.sort((a, b) => a - b);

	let bestResult = null;
	let bestRmse = Infinity;

	for (let start = 0; start < numStarts; start++) {
		const params = generateInitialGuess(t, x, start, {
			fixKappa,
			fixOmega,
			fixDutyCycle,
			fixedKappa,
			fixedOmega,
			fixedDutyCycle
		});
		try {
			const result = fitWithLM(t, x, params, freeIndices, maxIterations, tolerance);
			if (result.rmse < bestRmse) {
				bestRmse = result.rmse;
				bestResult = result;
			}
		} catch {
			// start failed — try next
		}
	}

	return bestResult;
}

/**
 * Evaluate the fitted rectangular wave model at an array of time points.
 */
export function evaluateRectWaveAtPoints(parameters, tPoints) {
	const { M, A, kappa, omega, phi, dutyCycle } = parameters;
	return tPoints.map((t) => evalModel(t, [M, A, kappa, omega, phi, dutyCycle]));
}

// ─── Model evaluation ─────────────────────────────────────────────────────────

function evalModel(t, params) {
	const [M, A, kappa, omega, phi, d] = params;
	const s = Math.sin(omega * t + phi) - Math.cos(Math.PI * d);
	return M + A * Math.tanh(kappa * s);
}

// ─── Normal equations over free params only ───────────────────────────────────

function computeNormalEqs(t, x, params, freeIndices) {
	const nFree = freeIndices.length;
	const JtJ = Array.from({ length: nFree }, () => new Array(nFree).fill(0));
	const JtR = new Array(nFree).fill(0);
	let rss = 0;

	const [M, A, kappa, omega, phi, d] = params;

	for (let i = 0; i < t.length; i++) {
		const ti = t[i];
		const predicted = evalModel(ti, params);
		const r = x[i] - predicted;
		rss += r * r;

		const arg = omega * ti + phi;
		const cosArg = Math.cos(arg);
		const sinArg = Math.sin(arg);
		const s = sinArg - Math.cos(Math.PI * d);
		const tanhKs = Math.tanh(kappa * s);
		const sech2Ks = 1 - tanhKs * tanhKs;

		// ∂residual/∂param = −∂f/∂param
		const jFull = new Array(6);
		jFull[0] = -1;
		jFull[1] = -tanhKs;
		jFull[2] = -A * s * sech2Ks;
		jFull[3] = -A * kappa * ti * cosArg * sech2Ks;
		jFull[4] = -A * kappa * cosArg * sech2Ks;
		jFull[5] = -A * kappa * Math.PI * Math.sin(Math.PI * d) * sech2Ks;

		const jRow = freeIndices.map((idx) => jFull[idx]);

		for (let j = 0; j < nFree; j++) {
			JtR[j] += jRow[j] * r;
			for (let k = j; k < nFree; k++) {
				JtJ[j][k] += jRow[j] * jRow[k];
			}
		}
	}

	for (let j = 0; j < nFree; j++) for (let k = j + 1; k < nFree; k++) JtJ[k][j] = JtJ[j][k];

	return { JtJ, JtR, rss };
}

// ─── LM optimizer ─────────────────────────────────────────────────────────────

function fitWithLM(t, x, params, freeIndices, maxIterations, tolerance) {
	let p = [...params];
	let lambda = 0.01;
	let { JtJ, JtR, rss: currentRss } = computeNormalEqs(t, x, p, freeIndices);

	for (let iter = 0; iter < maxIterations; iter++) {
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

		const newP = [...p];
		for (let j = 0; j < freeIndices.length; j++) {
			newP[freeIndices[j]] = p[freeIndices[j]] - delta[j];
		}

		// Clamp parameters to valid ranges
		newP[2] = Math.max(0.01, newP[2]); // κ > 0
		newP[3] = Math.max(0.001, Math.min(newP[3], 100)); // ω ∈ (0, 100]
		newP[5] = Math.max(0.01, Math.min(newP[5], 0.99)); // d ∈ (0, 1)

		const { JtJ: newJtJ, JtR: newJtR, rss: newRss } = computeNormalEqs(t, x, newP, freeIndices);

		if (newRss < currentRss) {
			const relImprovement = (currentRss - newRss) / (currentRss + 1e-10);
			p = newP;
			JtJ = newJtJ;
			JtR = newJtR;
			currentRss = newRss;
			lambda = Math.max(lambda / 3, 1e-10);
			if (relImprovement < tolerance) break;
		} else {
			lambda = Math.min(lambda * 10, 1e12);
			if (lambda >= 1e12) break;
		}
	}

	const n = t.length;
	const fitted = t.map((ti) => evalModel(ti, p));

	const xMeanAcc = new KahanSum();
	for (const v of x) xMeanAcc.add(v);
	const xMean = xMeanAcc.value / n;

	const sstotAcc = new KahanSum();
	for (const v of x) sstotAcc.add((v - xMean) ** 2);
	const rSquared = sstotAcc.value > 0 ? 1 - currentRss / sstotAcc.value : 0;

	const rmse = Math.sqrt(currentRss / n);
	const [M, A, kappa, omega, phi, d] = p;
	const period = (2 * Math.PI) / omega;

	// Acrophase: time of maximum within the wave.
	// The tanh argument is maximised when sin(ωt+φ) = 1, i.e. ωt+φ = π/2.
	// t_max = (π/2 − φ) / ω; normalise to [0, period).
	let acrophase = (Math.PI / 2 - phi) / omega;
	acrophase = ((acrophase % period) + period) % period;

	return {
		parameters: { M, A, kappa, omega, phi, dutyCycle: d },
		period,
		acrophase,
		fitted,
		rmse,
		rSquared,
		rss: currentRss
	};
}

// ─── Initial guess generation ─────────────────────────────────────────────────

function generateInitialGuess(
	t,
	x,
	seed,
	{ fixKappa, fixOmega, fixDutyCycle, fixedKappa, fixedOmega, fixedDutyCycle }
) {
	const n = x.length;
	const mean = x.reduce((s, v) => s + v, 0) / n;
	const xMin = min(x);
	const xMax = max(x);
	const halfAmplitude = (xMax - xMin) / 2;

	const dutyCycleSeeds = [0.5, 0.3, 0.7, 0.4, 0.6];
	const kappaSeeds = [5, 2, 10, 3, 8];

	let omega;
	if (fixOmega && fixedOmega != null) {
		omega = fixedOmega;
	} else {
		const periods = estimateDominantPeriods(t, x, 5);
		const periodIdx = Math.min(seed, periods.length - 1);
		const detectedPeriod = periods.length > 0 ? periods[periodIdx].period : 24;
		omega = (2 * Math.PI) / detectedPeriod;
	}

	const M = mean;
	const A = halfAmplitude > 0 ? halfAmplitude : 1;
	const kappa = fixKappa ? fixedKappa : kappaSeeds[seed % kappaSeeds.length];
	const d = fixDutyCycle ? fixedDutyCycle : dutyCycleSeeds[seed % dutyCycleSeeds.length];

	// Project data onto cos/sin at detected ω to estimate phase
	const detrended = x.map((v) => v - mean);
	let cosSum = 0;
	let sinSum = 0;
	for (let i = 0; i < t.length; i++) {
		cosSum += detrended[i] * Math.cos(omega * t[i]);
		sinSum += detrended[i] * Math.sin(omega * t[i]);
	}
	// Phase: peak of sinusoidal component
	const phi = -Math.atan2(sinSum, cosSum);

	return [M, A, kappa, omega, phi, d];
}

// ─── Period scanner ───────────────────────────────────────────────────────────

function estimateDominantPeriods(t, x, numPeriods = 5) {
	const n = t.length;
	if (n < 8) return [];

	const mean = x.reduce((s, v) => s + v, 0) / n;
	const detrended = x.map((v) => v - mean);

	const tMin = min(t);
	const tMax = max(t);
	const totalTime = tMax - tMin;

	const minPeriod = totalTime / (n / 2);
	const maxPeriod = totalTime * 0.75;
	const numCandidates = Math.min(500, n * 5);

	if (maxPeriod <= minPeriod) return [];

	const candidates = [];
	for (let i = 0; i < numCandidates; i++) {
		const period = minPeriod + ((maxPeriod - minPeriod) * i) / (numCandidates - 1);
		const frequency = (2 * Math.PI) / period;
		let cosSum = 0;
		let sinSum = 0;
		let norm = 0;
		for (let j = 0; j < n; j++) {
			const phase = frequency * t[j];
			cosSum += detrended[j] * Math.cos(phase);
			sinSum += detrended[j] * Math.sin(phase);
			norm += detrended[j] * detrended[j];
		}
		const score =
			norm === 0 ? 0 : Math.sqrt(cosSum * cosSum + sinSum * sinSum) / Math.sqrt(norm * n);
		candidates.push({ period, frequency, score });
	}

	candidates.sort((a, b) => b.score - a.score);
	return candidates.slice(0, numPeriods);
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
