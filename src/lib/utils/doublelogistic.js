// @ts-nocheck
import { KahanSum } from './numerics.js';
import { min, max } from './MathsStats.js';
import {
	FREE_PERIOD_DEFAULTS,
	resolvePeriodRange,
	scanPeriodogram,
	freePeriodFitWarnings
} from './cosinor.js';

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
 *   P   [M=0, A=1, k1=2, t1=3, k2=4, t2=5, T=6]   (the MODEL vector)
 *
 * PERIODIC MODE OPTIMISES t2 THROUGH A BOUNDED DURATION (review finding FIT-2,
 * 2026-10-03). With t1 and t2 free, the fit could land with t2 - t1 > T: neighbouring
 * tiles then overlap, the pulse train sits on a constant +A, and M absorbs it. On a
 * 5 / 40 square wave (12 h active, T fixed at 24) a third of activity phases reported
 * M near -30 instead of 5, with R squared, onset, offset and duty cycle all still right.
 * The optimiser therefore works on [M, A, k1, t1, k2, u, T] with
 *   t2 = t1 + d,  d = T * sigmoid(u)  in (0, T),
 * so the tiles can never overlap, and the result is canonicalised (A >= 0) before M and
 * the duration are reported: the tiled sum obeys pulse(t1, t2) = 1 - pulse(t2, t1 + T),
 * so a negative A is the same curve as M + A plus |A| times the complementary pulse.
 *
 * THE FREE PERIOD IS BOUNDED (review finding FIT-1): T stays inside [minPeriod,
 * maxPeriod] (default FREE_PERIOD_DEFAULTS, 1 to 48 h), starts come from the cosinor's
 * least-squares periodogram peaks inside the range, and `diagnostics` reports a period
 * on a bound or a fit that ran out of iterations (doubleLogisticFitWarnings). Unbounded,
 * a trend with noise and no rhythm fitted a 111 h "period" with R squared 0.965.
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

// ─── LM optimizer ─────────────────────────────────────────────────────────────

// Periodic optimiser vector <-> model vector. u is the logit of the duty fraction d / T.
const U_LIMIT = 30; // |u| bound: sigmoid(30) is 1 - 1e-13, a duration within 1e-13 T of 0 or T
const toModelP = (q) => [q[0], q[1], q[2], q[3], q[4], q[3] + q[6] * sigmoid(q[5]), q[6]];

/**
 * Canonical form of a periodic model vector [M, A, k1, t1, k2, t2, T] with 0 < t2 - t1 < T:
 * A >= 0. The tiled pulse obeys pulse(t1, t2) = 1 - pulse(t2, t1 + T) (the sum telescopes),
 * so M + A*pulse(t1, t2) with A < 0 is the same curve as (M + A) + |A|*pulse(t2, t1 + T),
 * the rise and fall rates swapping roles. Reporting this form keeps M the rest level and
 * the onset, offset and duration those of the active (high) phase.
 * @param {number[]} m
 * @returns {number[]}
 */
export function canonicalPeriodicParams(m) {
	if (!(m[1] < 0)) return m;
	const [M, A, k1, t1, k2, t2, T] = m;
	return [M + A, -A, k2, t2, k1, t1 + T, T];
}

/**
 * Periodic normal equations in the optimiser's coordinates. The model's Jacobian is
 * mapped through t2 = t1 + T * sigmoid(u):
 *   d/dt1 = d/dt1|model + d/dt2,  d/du = d/dt2 * T * s(1 - s),  d/dT = d/dT|model + d/dt2 * s.
 */
function computeNormalEqsPU(tArr, x, q, freeIndices) {
	const m = toModelP(q);
	const nFree = freeIndices.length;
	const JtJ = Array.from({ length: nFree }, () => new Array(nFree).fill(0));
	const JtR = new Array(nFree).fill(0);
	let rss = 0;
	const [, A, k1, t1, k2, t2, T] = m;
	const s = sigmoid(q[5]);
	const jRange = computeJRange(tArr, t1, t2, T);
	for (let i = 0; i < tArr.length; i++) {
		const ti = tArr[i];
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
		const r = x[i] - (m[0] + A * sumS1mS2);
		rss += r * r;
		// Model-space dR/dparam (as computeNormalEqsP).
		const dT1 = A * k1 * sumS1p;
		const dT2 = -A * k2 * sumS2p;
		const dT = A * (sumJk1s1p - sumJk2s2p);
		const jFull = [
			-1,
			-sumS1mS2,
			-A * sumS1pDt,
			dT1 + dT2,
			A * sumS2pDt,
			dT2 * T * s * (1 - s),
			dT + dT2 * s
		];
		const jRow = freeIndices.map((idx) => jFull[idx]);
		for (let a = 0; a < nFree; a++) {
			JtR[a] += jRow[a] * r;
			for (let b = a; b < nFree; b++) JtJ[a][b] += jRow[a] * jRow[b];
		}
	}
	for (let a = 0; a < nFree; a++) for (let b = a + 1; b < nFree; b++) JtJ[b][a] = JtJ[a][b];
	return { JtJ, JtR, rss };
}

/**
 * Levenberg-Marquardt. Periodic mode works in the (t1, u, T) coordinates above and keeps T
 * inside [tLo, tHi], holding it for a step when it sits on a bound and the descent
 * direction leaves the range (the cosinor's active set).
 */
function fitWithLM(
	tArr,
	x,
	params,
	freeIndices,
	periodic,
	maxIterations,
	tolerance,
	tLo = 0.1,
	tHi = Infinity
) {
	let p = [...params];
	if (periodic) {
		// Model vector in, optimiser vector out: u from the (clamped) duration.
		p[6] = Math.min(tHi, Math.max(tLo, p[6]));
		const frac = Math.min(0.98, Math.max(0.02, (params[5] - params[3]) / p[6]));
		p[5] = Math.log(frac / (1 - frac));
	}
	const computeNE = periodic
		? (pp) => computeNormalEqsPU(tArr, x, pp, freeIndices)
		: (pp) => computeNormalEqsNP(tArr, x, pp, freeIndices);
	const tPos = periodic ? freeIndices.indexOf(6) : -1;

	let lambda = 0.01;
	let { JtJ, JtR, rss: currentRss } = computeNE(p);
	let converged = false;
	let iterations = 0;

	for (let iter = 0; iter < maxIterations; iter++) {
		iterations = iter + 1;
		const frozen = tPos >= 0 && ((p[6] <= tLo && JtR[tPos] > 0) || (p[6] >= tHi && JtR[tPos] < 0));
		const JtJ_d = JtJ.map((row, i) => {
			if (frozen && i === tPos) return row.map((_, k) => (k === i ? 1 : 0));
			const r = row.map((v, k) => (frozen && k === tPos ? 0 : v));
			r[i] += lambda * (row[i] > 0 ? row[i] : 1);
			return r;
		});
		const rhs = JtR.map((v, i) => (frozen && i === tPos ? 0 : v));

		let delta;
		try {
			delta = solveLinearSystem(JtJ_d, rhs);
		} catch {
			// Singular/ill-conditioned JtJ — inflate the damping and retry
			// (standard Levenberg–Marquardt fallback); give up past 1e12.
			lambda = Math.min(lambda * 10, 1e12);
			if (lambda >= 1e12) {
				converged = true;
				break;
			}
			continue;
		}

		const newP = [...p];
		for (let j = 0; j < freeIndices.length; j++) {
			newP[freeIndices[j]] = p[freeIndices[j]] - delta[j];
		}

		// Clamp: rates must be positive; the period stays in its range
		newP[2] = Math.max(1e-4, newP[2]); // k1 > 0
		newP[4] = Math.max(1e-4, newP[4]); // k2 > 0
		if (periodic) {
			newP[6] = Math.min(tHi, Math.max(tLo, newP[6]));
			newP[5] = Math.min(U_LIMIT, Math.max(-U_LIMIT, newP[5]));
		} else if (newP[5] <= newP[3]) {
			// Ensure t2 > t1 with at least a small gap
			newP[5] = newP[3] + 0.01;
		}

		const { JtJ: newJtJ, JtR: newJtR, rss: newRss } = computeNE(newP);

		if (newRss < currentRss) {
			const relImprovement = (currentRss - newRss) / (currentRss + 1e-10);
			p = newP;
			JtJ = newJtJ;
			JtR = newJtR;
			currentRss = newRss;
			lambda = Math.max(lambda / 3, 1e-10);
			if (relImprovement < tolerance) {
				converged = true;
				break;
			}
		} else {
			lambda = Math.min(lambda * 10, 1e12);
			if (lambda >= 1e12) {
				converged = true; // at a (constrained) minimum: no step lowers the RSS
				break;
			}
		}
	}

	const n = tArr.length;
	let side = null;
	if (tPos >= 0) {
		const BOUND_RTOL = 1e-6; // as cosinor.js
		if (Math.abs(p[6] - tHi) <= BOUND_RTOL * tHi) side = 'max';
		else if (Math.abs(p[6] - tLo) <= BOUND_RTOL * tLo) side = 'min';
	}
	const allFinite = p.every(Number.isFinite) && Number.isFinite(currentRss);
	const m = periodic ? canonicalPeriodicParams(toModelP(p)) : p;
	const jRangeF = periodic ? computeJRange(tArr, m[3], m[5], m[6]) : null;
	const fitted = tArr.map((ti) => (periodic ? evalP(ti, m, jRangeF) : evalNP(ti, m)));

	const xMeanAcc = new KahanSum();
	for (const v of x) xMeanAcc.add(v);
	const xMean = xMeanAcc.value / n;

	const sstotAcc = new KahanSum();
	for (const v of x) sstotAcc.add((v - xMean) ** 2);
	// RSS from the reported curve, so the canonical form's (tiny) truncation error is in it.
	const rssAcc = new KahanSum();
	for (let i = 0; i < n; i++) rssAcc.add((x[i] - fitted[i]) ** 2);
	const rss = rssAcc.value;
	const rSquared = sstotAcc.value > 0 ? 1 - rss / sstotAcc.value : 0;

	const [M, A, k1, t1, k2, t2] = m;
	const T = periodic ? m[6] : null;
	// Periodic: d = t2 - t1 lies in (0, T) by construction, so duration and duty agree.
	const duration = t2 - t1;

	// Onset / offset phases within one cycle (for periodic display)
	const onsetPhase = periodic ? ((t1 % T) + T) % T : null;
	const offsetPhase = periodic ? ((t2 % T) + T) % T : null;
	const dutyCycle = periodic ? duration / T : null;

	return {
		parameters: { M, A, k1, t1, k2, t2, T },
		duration,
		onsetPhase,
		offsetPhase,
		dutyCycle,
		fitted,
		rmse: Math.sqrt(rss / n),
		rSquared,
		rss,
		diagnostics: { converged: converged && allFinite, iterations, atBound: [side] }
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
	{ fixK1, fixK2, fixPeriod, fixedK1, fixedK2, fixedPeriod, peaks, tLo, tHi }
) {
	const n = x.length;
	const mean = x.reduce((s, v) => s + v, 0) / n;
	const xMin = min(x);
	const A = max(x) - xMin;

	// Period: the cosinor periodogram's peaks inside the range, strongest first.
	let T;
	if (fixPeriod) {
		T = fixedPeriod;
	} else {
		const seeds = peaks ?? [];
		T = seeds.length > 0 ? seeds[Math.min(seed, seeds.length - 1)].period : 24;
		T = Math.min(tHi ?? Infinity, Math.max(tLo ?? 0, T));
	}

	const kSeeds = [0.5, 0.2, 1.0, 0.3, 0.8];
	const k1 = fixK1 ? fixedK1 : kSeeds[seed % kSeeds.length];
	const k2 = fixK2 ? fixedK2 : kSeeds[seed % kSeeds.length];

	// Onset and duration from the phase-folded data: the active arc is the complement of
	// the LARGEST circular gap between above-mean phases. (First-to-last above-mean phase
	// spanned nearly the whole cycle whenever activity wrapped the fold's origin, which
	// started a nocturnal record with an active phase of almost T.)
	const tMin = min(tArr);
	const dutyCycleSeeds = [0.5, 0.3, 0.7, 0.4, 0.6];
	const dc = dutyCycleSeeds[seed % dutyCycleSeeds.length];
	const abovePhases = [];
	for (let i = 0; i < n; i++) {
		if (x[i] > mean) abovePhases.push((((tArr[i] - tMin) % T) + T) % T);
	}
	abovePhases.sort((a, b) => a - b);
	let onsetPhase = T * (0.5 - dc / 2);
	let duration = T * dc;
	if (abovePhases.length > 2) {
		let gap = abovePhases[0] + T - abovePhases[abovePhases.length - 1];
		let after = 0; // index of the first above-mean phase after the largest gap
		for (let i = 1; i < abovePhases.length; i++) {
			const g = abovePhases[i] - abovePhases[i - 1];
			if (g > gap) {
				gap = g;
				after = i;
			}
		}
		onsetPhase = abovePhases[after];
		duration = Math.min(0.98 * T, Math.max(0.02 * T, T - gap));
	}

	const t1 = tMin + onsetPhase;
	const t2 = t1 + duration;

	return [xMin, A, k1, t1, k2, t2, T];
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
 * @param {number}  options.minPeriod     - Free periodic T only: shortest period (default 1 h)
 * @param {number}  options.maxPeriod     - Free periodic T only: longest period (default 48 h)
 * @returns {Object|null} with `diagnostics` = { converged, iterations, atBound: [side],
 *   periodRange: [min, max] | null }; null when the free period's range is empty or every
 *   start failed.
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
		numStarts = 5,
		minPeriod = FREE_PERIOD_DEFAULTS.minPeriod,
		maxPeriod = FREE_PERIOD_DEFAULTS.maxPeriod
	} = options;

	// Free periodic T: the range it may use and its periodogram-peak starts.
	let range = null;
	let peaks = null;
	let tLo = 0.1;
	let tHi = Infinity;
	if (periodic && !fixPeriod) {
		range = resolvePeriodRange(t, minPeriod, maxPeriod);
		if (!range) return null;
		tLo = range.minPeriod;
		tHi = range.maxPeriod;
		peaks = scanPeriodogram(t, x, tLo, tHi, numStarts);
	}

	// NP free: [M=0, A=1, t1=3, t2=5] always; optionally add k1=2, k2=4
	// P free:  same + optionally T=6
	const freeIndices = [0, 1, 3, 5];
	if (!fixK1) freeIndices.push(2);
	if (!fixK2) freeIndices.push(4);
	if (periodic && !fixPeriod) freeIndices.push(6);
	freeIndices.sort((a, b) => a - b);

	let bestResult = null;
	let bestRmse = Infinity;

	const guessOpts = { fixK1, fixK2, fixPeriod, fixedK1, fixedK2, fixedPeriod, peaks, tLo, tHi };

	for (let start = 0; start < numStarts; start++) {
		const params = periodic
			? generateInitialGuessP(t, x, start, guessOpts)
			: generateInitialGuessNP(t, x, start, guessOpts);
		// Clamp fixed params to their prescribed values
		if (fixK1) params[2] = fixedK1;
		if (fixK2) params[4] = fixedK2;
		if (periodic && fixPeriod) params[6] = fixedPeriod;
		try {
			const result = fitWithLM(
				t,
				x,
				params,
				freeIndices,
				periodic,
				maxIterations,
				tolerance,
				tLo,
				tHi
			);
			if (result.rmse < bestRmse) {
				bestRmse = result.rmse;
				bestResult = result;
			}
		} catch {
			// start failed — try next
		}
	}

	if (bestResult)
		bestResult.diagnostics.periodRange = range ? [range.minPeriod, range.maxPeriod] : null;
	return bestResult;
}

/**
 * The cosinor's plain-language warnings (period on a bound of the range, optimiser out of
 * iterations) for double-logistic fits. `entries` are `{ label, result }` with `result` a
 * fitDoubleLogistic return value. A fixed or non-periodic fit never warns about the range.
 */
export function doubleLogisticFitWarnings(
	entries,
	modelLabel = 'The free-period double-logistic fit'
) {
	return freePeriodFitWarnings(
		(entries ?? []).map((e) => {
			const T = e?.result?.parameters?.T;
			return {
				label: e?.label,
				result: e?.result?.diagnostics
					? {
							diagnostics: e.result.diagnostics,
							parameters: { cosines: [{ frequency: T ? (2 * Math.PI) / T : NaN }] }
						}
					: null
			};
		}),
		modelLabel
	);
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
