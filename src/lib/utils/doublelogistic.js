// @ts-nocheck
import { KahanSum } from './numerics.js';
import { min, max } from './MathsStats.js';

/**
 * Fits a double-logistic model to data.
 *
 * Non-periodic model: f(t) = M + A·[σ(k1·(t − t1)) − σ(k2·(t − t2))]
 *
 * Periodic model (tiled sum over j):
 *   f(t) = M + A·Σ_j [σ(k1·(t − t1 − j·T)) − σ(k2·(t − t2 − j·T))]
 *
 * The tiled sum converges to a periodic pulse train: ≈1 during the active
 * phase [t1 mod T, t2 mod T] and ≈0 during the rest phase. No DC drift.
 *
 * Parameters:
 *   NP  [M=0, A=1, k1=2, t1=3, k2=4, t2=5]
 *   P   [M=0, A=1, k1=2, t1=3, k2=4, t2=5, T=6]
 *
 *   M:  mesor (baseline)
 *   A:  amplitude (scale)
 *   k1: rise rate (steepness; optionally fixed)
 *   t1: time of rise inflection (always free)
 *   k2: fall rate (optionally fixed)
 *   t2: time of fall inflection (always free; t2 > t1)
 *   T:  period in hours (periodic only; optionally fixed)
 */

function sigmoid(x) {
	return 1 / (1 + Math.exp(-x));
}

// ─── Model evaluation ─────────────────────────────────────────────────────────

function evalNP(t, params) {
	const [M, A, k1, t1, k2, t2] = params;
	return M + A * (sigmoid(k1 * (t - t1)) - sigmoid(k2 * (t - t2)));
}

function evalP(t, params, jRange) {
	const [M, A, k1, t1, k2, t2, T] = params;
	let result = M;
	for (let j = jRange[0]; j <= jRange[1]; j++) {
		result += A * (sigmoid(k1 * (t - t1 - j * T)) - sigmoid(k2 * (t - t2 - j * T)));
	}
	return result;
}

function computeJRange(tArr, t1, t2, T) {
	const tMin = min(tArr);
	const tMax = max(tArr);
	const jMin = Math.floor((tMin - Math.max(t1, t2)) / T) - 1;
	const jMax = Math.ceil((tMax - Math.min(t1, t2)) / T) + 1;
	return [jMin, jMax];
}

// ─── Normal equations ─────────────────────────────────────────────────────────

function computeNormalEqsNP(tArr, x, params, freeIndices) {
	const nFree = freeIndices.length;
	const JtJ = Array.from({ length: nFree }, () => new Array(nFree).fill(0));
	const JtR = new Array(nFree).fill(0);
	let rss = 0;

	const [, A, k1, t1, k2, t2] = params;

	for (let i = 0; i < tArr.length; i++) {
		const ti = tArr[i];
		const predicted = evalNP(ti, params);
		const r = x[i] - predicted;
		rss += r * r;

		const s1 = sigmoid(k1 * (ti - t1));
		const s2 = sigmoid(k2 * (ti - t2));
		const s1p = s1 * (1 - s1);
		const s2p = s2 * (1 - s2);

		// ∂R/∂param = −∂f/∂param
		const jFull = [
			-1, // ∂R/∂M
			-(s1 - s2), // ∂R/∂A
			-A * s1p * (ti - t1), // ∂R/∂k1
			A * k1 * s1p, // ∂R/∂t1
			A * s2p * (ti - t2), // ∂R/∂k2
			-A * k2 * s2p // ∂R/∂t2
		];

		const jRow = freeIndices.map((idx) => jFull[idx]);
		for (let j = 0; j < nFree; j++) {
			JtR[j] += jRow[j] * r;
			for (let k = j; k < nFree; k++) JtJ[j][k] += jRow[j] * jRow[k];
		}
	}

	for (let j = 0; j < nFree; j++) for (let k = j + 1; k < nFree; k++) JtJ[k][j] = JtJ[j][k];

	return { JtJ, JtR, rss };
}

function computeNormalEqsP(tArr, x, params, freeIndices) {
	const nFree = freeIndices.length;
	const JtJ = Array.from({ length: nFree }, () => new Array(nFree).fill(0));
	const JtR = new Array(nFree).fill(0);
	let rss = 0;

	const [, A, k1, t1, k2, t2, T] = params;
	const jRange = computeJRange(tArr, t1, t2, T);

	for (let i = 0; i < tArr.length; i++) {
		const ti = tArr[i];
		const predicted = evalP(ti, params, jRange);
		const r = x[i] - predicted;
		rss += r * r;

		// Accumulate sums over j once per data point
		let sumS1mS2 = 0,
			sumS1pDt = 0,
			sumS1p = 0,
			sumS2pDt = 0,
			sumS2p = 0,
			sumJk1s1p = 0,
			sumJk2s2p = 0;

		for (let j = jRange[0]; j <= jRange[1]; j++) {
			const s1 = sigmoid(k1 * (ti - t1 - j * T));
			const s2 = sigmoid(k2 * (ti - t2 - j * T));
			const s1p = s1 * (1 - s1);
			const s2p = s2 * (1 - s2);
			sumS1mS2 += s1 - s2;
			sumS1pDt += s1p * (ti - t1 - j * T);
			sumS1p += s1p;
			sumS2pDt += s2p * (ti - t2 - j * T);
			sumS2p += s2p;
			sumJk1s1p += j * k1 * s1p;
			sumJk2s2p += j * k2 * s2p;
		}

		// ∂R/∂T = A·Σ_j j·(k1·s1p_j − k2·s2p_j)  [from ∂/∂T(-j·T) in each sigmoid arg]
		const jFull = [
			-1, // ∂R/∂M
			-sumS1mS2, // ∂R/∂A
			-A * sumS1pDt, // ∂R/∂k1
			A * k1 * sumS1p, // ∂R/∂t1
			A * sumS2pDt, // ∂R/∂k2
			-A * k2 * sumS2p, // ∂R/∂t2
			A * (sumJk1s1p - sumJk2s2p) // ∂R/∂T
		];

		const jRow = freeIndices.map((idx) => jFull[idx]);
		for (let j = 0; j < nFree; j++) {
			JtR[j] += jRow[j] * r;
			for (let k = j; k < nFree; k++) JtJ[j][k] += jRow[j] * jRow[k];
		}
	}

	for (let j = 0; j < nFree; j++) for (let k = j + 1; k < nFree; k++) JtJ[k][j] = JtJ[j][k];

	return { JtJ, JtR, rss };
}

// ─── LM optimizer ─────────────────────────────────────────────────────────────

function fitWithLM(tArr, x, params, freeIndices, periodic, maxIterations, tolerance) {
	let p = [...params];
	const computeNE = periodic
		? (pp) => computeNormalEqsP(tArr, x, pp, freeIndices)
		: (pp) => computeNormalEqsNP(tArr, x, pp, freeIndices);

	let lambda = 0.01;
	let { JtJ, JtR, rss: currentRss } = computeNE(p);

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

		// Clamp: rates must be positive; t2 must be after t1; period must be positive
		newP[2] = Math.max(1e-4, newP[2]); // k1 > 0
		newP[4] = Math.max(1e-4, newP[4]); // k2 > 0
		if (periodic) {
			newP[6] = Math.max(0.1, newP[6]); // T > 0
		}
		// Ensure t2 > t1 with at least a small gap
		if (newP[5] <= newP[3]) newP[5] = newP[3] + 0.01;

		const { JtJ: newJtJ, JtR: newJtR, rss: newRss } = computeNE(newP);

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

	const n = tArr.length;
	const jRangeF = periodic ? computeJRange(tArr, p[3], p[5], p[6]) : null;
	const fitted = tArr.map((ti) => (periodic ? evalP(ti, p, jRangeF) : evalNP(ti, p)));

	const xMeanAcc = new KahanSum();
	for (const v of x) xMeanAcc.add(v);
	const xMean = xMeanAcc.value / n;

	const sstotAcc = new KahanSum();
	for (const v of x) sstotAcc.add((v - xMean) ** 2);
	const rSquared = sstotAcc.value > 0 ? 1 - currentRss / sstotAcc.value : 0;

	const [M, A, k1, t1, k2, t2] = p;
	const T = periodic ? p[6] : null;
	const duration = t2 - t1;

	// Onset / offset phases within one cycle (for periodic display)
	const onsetPhase = periodic ? ((t1 % T) + T) % T : null;
	const offsetPhase = periodic ? ((t2 % T) + T) % T : null;
	const dutyCycle = periodic ? ((((t2 - t1) % T) + T) % T) / T : null;

	return {
		parameters: { M, A, k1, t1, k2, t2, T },
		duration,
		onsetPhase,
		offsetPhase,
		dutyCycle,
		fitted,
		rmse: Math.sqrt(currentRss / n),
		rSquared,
		rss: currentRss
	};
}

// ─── Initial guess generation ─────────────────────────────────────────────────

function generateInitialGuessNP(tArr, x, seed, { fixK1, fixK2, fixedK1, fixedK2 }) {
	const n = x.length;
	const tMin = min(tArr);
	const tMax = max(tArr);
	const tRange = tMax - tMin;
	const mean = x.reduce((s, v) => s + v, 0) / n;
	const xMin = min(x);
	const A = (max(x) - xMin) * (1 + 0.1 * seed);

	// Estimate rise/fall times from mean crossings
	const sortedAbove = tArr.filter((_, i) => x[i] > mean);
	let t1est = tMin + tRange * 0.25;
	let t2est = tMin + tRange * 0.75;
	if (sortedAbove.length > 2) {
		t1est = sortedAbove[0];
		t2est = sortedAbove[sortedAbove.length - 1];
	}

	const offsets = [0, -0.15, 0.15, -0.3, 0.3];
	const shift = tRange * (offsets[seed % offsets.length] ?? 0);
	const t1 = t1est + shift;
	const t2 = Math.max(t1 + 0.01, t2est + shift);

	const kSeeds = [0.5, 0.2, 1.0, 0.3, 0.8];
	const k1 = fixK1 ? fixedK1 : kSeeds[seed % kSeeds.length];
	const k2 = fixK2 ? fixedK2 : kSeeds[seed % kSeeds.length];

	return [xMin, A, k1, t1, k2, t2];
}

function generateInitialGuessP(
	tArr,
	x,
	seed,
	{ fixK1, fixK2, fixPeriod, fixedK1, fixedK2, fixedPeriod }
) {
	const n = x.length;
	const mean = x.reduce((s, v) => s + v, 0) / n;
	const xMin = min(x);
	const A = max(x) - xMin;

	// Period
	let T;
	if (fixPeriod) {
		T = fixedPeriod;
	} else {
		const periods = estimateDominantPeriods(tArr, x, 5);
		const idx = Math.min(seed, periods.length - 1);
		T = periods.length > 0 ? periods[idx].period : 24;
	}

	const kSeeds = [0.5, 0.2, 1.0, 0.3, 0.8];
	const k1 = fixK1 ? fixedK1 : kSeeds[seed % kSeeds.length];
	const k2 = fixK2 ? fixedK2 : kSeeds[seed % kSeeds.length];

	// Estimate onset/offset within a cycle from phase-folded data
	const tMin = min(tArr);
	const dutyCycleSeeds = [0.5, 0.3, 0.7, 0.4, 0.6];
	const dc = dutyCycleSeeds[seed % dutyCycleSeeds.length];

	// Phase-fold and find median above-mean phase
	const phases = tArr.map((t) => (((t - tMin) % T) + T) % T);
	const abovePhases = phases.filter((_, i) => x[i] > mean).sort((a, b) => a - b);
	let onsetPhase = T * (0.5 - dc / 2);
	let offsetPhase = T * (0.5 + dc / 2);
	if (abovePhases.length > 2) {
		onsetPhase = abovePhases[0];
		offsetPhase = abovePhases[abovePhases.length - 1];
	}

	// Place t1, t2 in the first cycle starting at tMin
	const t1 = tMin + onsetPhase;
	const t2 = t1 + Math.max(0.01, offsetPhase - onsetPhase);

	return [xMin, A, k1, t1, k2, t2, T];
}

// ─── Period scanner ───────────────────────────────────────────────────────────

function estimateDominantPeriods(tArr, x, numPeriods = 5) {
	const n = tArr.length;
	if (n < 8) return [];

	const mean = x.reduce((s, v) => s + v, 0) / n;
	const detrended = x.map((v) => v - mean);
	const tMin = min(tArr);
	const tMax = max(tArr);
	const totalTime = tMax - tMin;
	const minPeriod = totalTime / (n / 2);
	const maxPeriod = totalTime * 0.75;
	if (maxPeriod <= minPeriod) return [];

	const numCandidates = Math.min(500, n * 5);
	const candidates = [];
	for (let i = 0; i < numCandidates; i++) {
		const period = minPeriod + ((maxPeriod - minPeriod) * i) / (numCandidates - 1);
		const freq = (2 * Math.PI) / period;
		let cs = 0,
			ss = 0,
			norm = 0;
		for (let j = 0; j < n; j++) {
			const ph = freq * tArr[j];
			cs += detrended[j] * Math.cos(ph);
			ss += detrended[j] * Math.sin(ph);
			norm += detrended[j] * detrended[j];
		}
		const score = norm === 0 ? 0 : Math.sqrt(cs * cs + ss * ss) / Math.sqrt(norm * n);
		candidates.push({ period, score });
	}
	candidates.sort((a, b) => b.score - a.score);
	return candidates.slice(0, numPeriods);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fit a double-logistic model (non-periodic or periodic) to data.
 *
 * @param {number[]} t   - Time array (hours)
 * @param {number[]} x   - Data array
 * @param {Object} options
 * @param {boolean} options.periodic      - Use periodic (tiled) model
 * @param {boolean} options.fixK1         - Pin k1 to fixedK1
 * @param {boolean} options.fixK2         - Pin k2 to fixedK2
 * @param {boolean} options.fixPeriod     - Pin T to fixedPeriod (periodic only)
 * @param {number}  options.fixedK1       - Fixed rise rate (default 0.5)
 * @param {number}  options.fixedK2       - Fixed fall rate (default 0.5)
 * @param {number}  options.fixedPeriod   - Fixed period in hours (default 24)
 * @param {number}  options.maxIterations - Max LM iterations per start (default 2000)
 * @param {number}  options.tolerance     - Relative convergence tolerance (default 1e-7)
 * @param {number}  options.numStarts     - Number of multi-starts (default 5)
 */
export function fitDoubleLogistic(t, x, options = {}) {
	if (t.length !== x.length) throw new Error('Arrays t and x must have the same length');

	const {
		periodic = false,
		fixK1 = false,
		fixK2 = false,
		fixPeriod = false,
		fixedK1 = 0.5,
		fixedK2 = 0.5,
		fixedPeriod = 24,
		maxIterations = 10000,
		tolerance = 1e-6,
		numStarts = 5
	} = options;

	// NP free: [M=0, A=1, t1=3, t2=5] always; optionally add k1=2, k2=4
	// P free:  same + optionally T=6
	const freeIndices = [0, 1, 3, 5];
	if (!fixK1) freeIndices.push(2);
	if (!fixK2) freeIndices.push(4);
	if (periodic && !fixPeriod) freeIndices.push(6);
	freeIndices.sort((a, b) => a - b);

	let bestResult = null;
	let bestRmse = Infinity;

	const guessOpts = { fixK1, fixK2, fixPeriod, fixedK1, fixedK2, fixedPeriod };

	for (let start = 0; start < numStarts; start++) {
		const params = periodic
			? generateInitialGuessP(t, x, start, guessOpts)
			: generateInitialGuessNP(t, x, start, guessOpts);
		// Clamp fixed params to their prescribed values
		if (fixK1) params[2] = fixedK1;
		if (fixK2) params[4] = fixedK2;
		if (periodic && fixPeriod) params[6] = fixedPeriod;
		try {
			const result = fitWithLM(t, x, params, freeIndices, periodic, maxIterations, tolerance);
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
 * Evaluate a fitted double-logistic model at given time points.
 */
export function evaluateDoubleLogisticAtPoints(parameters, periodic, tPoints) {
	const { M, A, k1, t1, k2, t2, T } = parameters;
	if (periodic) {
		const params = [M, A, k1, t1, k2, t2, T];
		const jRange = computeJRange(tPoints, t1, t2, T);
		return tPoints.map((t) => evalP(t, params, jRange));
	}
	const params = [M, A, k1, t1, k2, t2];
	return tPoints.map((t) => evalNP(t, params));
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
