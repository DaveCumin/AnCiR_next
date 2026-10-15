// @ts-nocheck
import { KahanSum } from './numerics.js';
import { min, max } from './MathsStats.js';
import {
	FREE_PERIOD_DEFAULTS,
	resolvePeriodRange,
	scanPeriodogram,
	freePeriodFitWarnings
} from './cosinor.js';

// WHY THE FREE PERIOD IS BOUNDED (review finding FIT-1, 2026-10-03)
//
// The free-period fit used to clamp omega only to [0.001, 100] rad/h, i.e. a period of
// 0.063 to 6,283 h. On a trend with noise and no rhythm (y = 0.1 t + N(0, 1), hourly, 7
// days) it returned a period of 2,243 h with R squared 0.965 and no warning: one
// rectangular pulse stretched across the record fits a ramp. This is the failure v77
// fixed for the cosinor, and the fix is the cosinor's, reused: the period is kept inside
// [minPeriod, maxPeriod] (default FREE_PERIOD_DEFAULTS, 1 to 48 h, so MovingAnalysis
// windows that call this without a range are bounded too), the starts come from the
// peaks of the cosinor's least-squares periodogram inside that range, and the result
// carries `diagnostics` ({ converged, iterations, atBound: [side], periodRange }) that
// rectWaveFitWarnings turns into the cosinor's at-bound and non-convergence warnings.

/**
 * Fits a rectangular (square) wave model to data using a tanh approximation.
 * Model: f(t) = M + A·tanh(κ·(sin(ω·t + φ) − cos(π·d)))
 *
 * Parameters (full vector index):
 *   0: M  (midline): halfway between the high (M + A) and low (M − A) levels, not a
 *           rhythm-adjusted mean (FIT-16); reported under the `mesor` key
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
 * @param {number}  options.minPeriod     - Free period only: shortest period (default 1 h)
 * @param {number}  options.maxPeriod     - Free period only: longest period (default 48 h)
 * @returns {Object|null} Fitting result, with `diagnostics` = { converged, iterations,
 *   atBound: ['min'|'max'|null], periodRange: [min, max] | null (fixed period) }; null
 *   when the free period's range is empty or every start failed.
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
		numStarts = 5,
		minPeriod = FREE_PERIOD_DEFAULTS.minPeriod,
		maxPeriod = FREE_PERIOD_DEFAULTS.maxPeriod
	} = options;

	// A pinned ω with no value used to fall back to 24 h silently; refuse instead.
	if (fixOmega && !(Number.isFinite(fixedOmega) && fixedOmega > 0)) {
		throw new Error('fitRectangularWave: fixOmega needs a positive finite fixedOmega');
	}

	// Free period: the range the fit may use, and its periodogram peaks as starts.
	let wLo = 0.001;
	let wHi = 100;
	let range = null;
	let peaks = null;
	if (!fixOmega) {
		range = resolvePeriodRange(t, minPeriod, maxPeriod);
		if (!range) return null;
		wLo = (2 * Math.PI) / range.maxPeriod;
		wHi = (2 * Math.PI) / range.minPeriod;
		peaks = scanPeriodogram(t, x, range.minPeriod, range.maxPeriod, numStarts);
	}

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
			fixedDutyCycle,
			peaks,
			wLo,
			wHi
		});
		try {
			const result = fitWithLM(t, x, params, freeIndices, maxIterations, tolerance, wLo, wHi);
			if (result.rmse < bestRmse) {
				bestRmse = result.rmse;
				bestResult = result;
			}
		} catch {
			// start failed — try next
		}
	}

	if (bestResult) {
		bestResult.diagnostics.periodRange = range ? [range.minPeriod, range.maxPeriod] : null;
		if (fixOmega) bestResult.diagnostics.atBound = [null];
	}
	return bestResult;
}

/**
 * The cosinor's plain-language warnings (period on a bound of the range, optimiser out
 * of iterations) for rectangular-wave fits. `entries` are `{ label, result, t? }` with
 * `result` a fitRectangularWave return value and t the x it fitted (with R² it lets the
 * warning tell a rhythm at the edge of the range from no rhythm; see boundFitIsStrong);
 * fixed-period fits never warn about the period range. `opts.unit` is the period's unit.
 */
export function rectWaveFitWarnings(
	entries,
	modelLabel = 'The free-period rectangular-wave fit',
	opts = {}
) {
	return freePeriodFitWarnings(
		(entries ?? []).map((e) => ({
			label: e?.label,
			t: e?.t,
			result: e?.result?.diagnostics
				? {
						diagnostics: e.result.diagnostics,
						rSquared: e.result.rSquared,
						parameters: { cosines: [{ frequency: e.result.parameters?.omega }] }
					}
				: null
		})),
		modelLabel,
		opts
	);
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

	const [, A, kappa, omega, phi, d] = params;

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

function fitWithLM(t, x, params, freeIndices, maxIterations, tolerance, wLo = 0.001, wHi = 100) {
	let p = [...params];
	p[3] = Math.min(wHi, Math.max(wLo, p[3]));
	let lambda = 0.01;
	let { JtJ, JtR, rss: currentRss } = computeNormalEqs(t, x, p, freeIndices);
	let converged = false;
	let iterations = 0;
	// Position of ω in the free-parameter vector (-1 when the period is fixed).
	const wPos = freeIndices.indexOf(3);

	for (let iter = 0; iter < maxIterations; iter++) {
		iterations = iter + 1;
		// ω pinned on a bound whose descent direction leaves the range is held for this
		// step (the cosinor's active set), so the other parameters keep improving
		// instead of every step being clamped into a no-op.
		const frozen = wPos >= 0 && ((p[3] <= wLo && JtR[wPos] > 0) || (p[3] >= wHi && JtR[wPos] < 0));
		const JtJ_d = JtJ.map((row, i) => {
			if (frozen && i === wPos) return row.map((_, k) => (k === i ? 1 : 0));
			const r = row.map((v, k) => (frozen && k === wPos ? 0 : v));
			r[i] += lambda * (row[i] > 0 ? row[i] : 1);
			return r;
		});
		const rhs = JtR.map((v, i) => (frozen && i === wPos ? 0 : v));

		let delta;
		try {
			delta = solveLinearSystem(JtJ_d, rhs);
		} catch {
			// Singular/ill-conditioned JtJ — inflate the damping and retry
			// (standard Levenberg–Marquardt fallback); give up past 1e12.
			lambda = Math.min(lambda * 10, 1e12);
			if (lambda >= 1e12) {
				converged = true; // no descent step exists at any damping
				break;
			}
			continue;
		}

		const newP = [...p];
		for (let j = 0; j < freeIndices.length; j++) {
			newP[freeIndices[j]] = p[freeIndices[j]] - delta[j];
		}

		// Clamp parameters to valid ranges
		newP[2] = Math.max(0.01, newP[2]); // κ > 0
		newP[3] = Math.max(wLo, Math.min(newP[3], wHi)); // ω inside the period range
		newP[5] = Math.max(0.01, Math.min(newP[5], 0.99)); // d ∈ (0, 1)

		const { JtJ: newJtJ, JtR: newJtR, rss: newRss } = computeNormalEqs(t, x, newP, freeIndices);

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

	const n = t.length;
	const fitted = t.map((ti) => evalModel(ti, p));

	const xMeanAcc = new KahanSum();
	for (const v of x) xMeanAcc.add(v);
	const xMean = xMeanAcc.value / n;

	const sstotAcc = new KahanSum();
	for (const v of x) sstotAcc.add((v - xMean) ** 2);
	const rSquared = sstotAcc.value > 0 ? 1 - currentRss / sstotAcc.value : 0;

	const rmse = Math.sqrt(currentRss / n);
	// Canonical form A ≥ 0: A·tanh(κ(sin(ωt+φ) − cos πd)) = (−A)·tanh(κ(sin(ωt+φ+π) − cos π(1−d)))
	// exactly, so a negative A is the same curve with the high and low phases swapped. Report
	// the A ≥ 0 form, or the acrophase and duty cycle would describe the rest phase.
	if (p[1] < 0) {
		p = [...p];
		p[1] = -p[1];
		p[4] += Math.PI;
		p[5] = 1 - p[5];
	}
	p[4] = Math.atan2(Math.sin(p[4]), Math.cos(p[4])); // φ in (−π, π]
	const [M, A, kappa, omega, phi, d] = p;
	const period = (2 * Math.PI) / omega;

	// Acrophase: time of maximum within the wave.
	// The tanh argument is maximised when sin(ωt+φ) = 1, i.e. ωt+φ = π/2.
	// t_max = (π/2 − φ) / ω; normalise to [0, period).
	let acrophase = (Math.PI / 2 - phi) / omega;
	acrophase = ((acrophase % period) + period) % period;

	// A period within this relative distance of a bound counts as "on" it (as cosinor.js).
	const BOUND_RTOL = 1e-6;
	let side = null;
	if (wPos >= 0) {
		if (Math.abs(omega - wLo) <= BOUND_RTOL * wLo)
			side = 'max'; // lowest ω = longest period
		else if (Math.abs(omega - wHi) <= BOUND_RTOL * wHi) side = 'min';
	}
	const allFinite = p.every(Number.isFinite) && Number.isFinite(currentRss);

	return {
		parameters: { M, A, kappa, omega, phi, dutyCycle: d },
		period,
		acrophase,
		fitted,
		rmse,
		rSquared,
		rss: currentRss,
		diagnostics: { converged: converged && allFinite, iterations, atBound: [side] }
	};
}

// ─── Initial guess generation ─────────────────────────────────────────────────

function generateInitialGuess(
	t,
	x,
	seed,
	{ fixKappa, fixOmega, fixDutyCycle, fixedKappa, fixedOmega, fixedDutyCycle, peaks, wLo, wHi }
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
		// Seeds: the least-squares periodogram's peaks INSIDE the period range, strongest
		// first (cosinor.js scanPeriodogram), so no start begins outside it.
		const seeds = peaks ?? [];
		omega =
			seeds.length > 0 ? seeds[Math.min(seed, seeds.length - 1)].frequency : (2 * Math.PI) / 24;
		omega = Math.min(wHi ?? Infinity, Math.max(wLo ?? 0, omega));
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
	// Phase: the projection puts the sinusoid's peak at ω·t = atan2(S, C), and the model
	// peaks where ω·t + φ = π/2, so φ = π/2 − atan2(S, C). (It was −atan2(S, C), a quarter
	// cycle late; harmless while every start shared one period, but with one start per
	// periodogram peak the start at the true period must begin in the right basin.)
	const phi = Math.PI / 2 - Math.atan2(sinSum, cosSum);

	return [M, A, kappa, omega, phi, d];
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
