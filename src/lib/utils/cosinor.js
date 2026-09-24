// @ts-nocheck
import { KahanSum } from './numerics.js';
import quantile_t from '@stdlib/stats-base-dists-t-quantile';
import cdf_f from '@stdlib/stats-base-dists-f-cdf';

// ─── Free-period search range ────────────────────────────────────────────────
//
// WHY THE FREE PERIOD IS BOUNDED
//
// The free-period cosinor is a nonlinear least-squares problem, and the period
// is the badly conditioned parameter: a trend, or a non-sinusoidal waveform
// whose power is split over harmonics, can lower the residual sum of squares
// further by stretching one cosine across the whole record than by fitting the
// rhythm. With no bound on the period the optimiser used to follow that slope
// until it hit its internal frequency clamp (ω = 0.001 rad/h, i.e. a 6,283 h
// "period"), with nothing on screen to say so. On real activity data that gave
// ≈6,275 h for a Drosophila group mean and ≈796 h for an intertidal isopod
// record whose periodogram peaks cleanly at 12.4 h.
//
// The fit is therefore restricted to a period range [minPeriod, maxPeriod]
// (the nodes expose it; FREE_PERIOD_DEFAULTS is the default), it STARTS from
// the best peaks of a least-squares periodogram inside that range, and it
// reports when the fitted period finishes on a bound or the optimiser runs out
// of iterations (`diagnostics`), so the node can say so instead of printing a
// number that is not a rhythm.

/** Default period range (h) for the Cosinor / Fit waveform model free-period fit. */
export const FREE_PERIOD_DEFAULTS = Object.freeze({ minPeriod: 1, maxPeriod: 48 });

// Periodogram used to seed the fit. Frequencies are spaced 1/(OVERSAMPLE·span)
// apart, which puts several grid points inside every peak's main lobe (width
// ≈ 1/span), capped so very long records stay affordable. Records longer than
// SCAN_MAX_POINTS are averaged into bins no wider than minPeriod/8 for the scan
// only (the fit itself always uses every point).
const SCAN_OVERSAMPLE = 4;
const SCAN_MIN_FREQS = 64;
const SCAN_MAX_FREQS = 5000;
const SCAN_MAX_POINTS = 10000;
const SCAN_PEAKS = 3;
// A fitted period within this relative distance of a bound counts as "on" it.
const BOUND_RTOL = 1e-6;

/**
 * Resolve the period range the free fit may use.
 *
 * `minPeriod` / `maxPeriod` are in the units of `t` (hours for time columns).
 * A missing value falls back to what the sampling supports: the Nyquist period
 * (2 × median spacing) at the short end, the record span at the long end. The
 * short end is never allowed below the Nyquist period, where a cosine aliases.
 *
 * @returns {{minPeriod:number, maxPeriod:number, nyquist:number, span:number} | null}
 *   null when the resolved range is empty (min ≥ max) or `t` has < 2 distinct values.
 */
export function resolvePeriodRange(t, minPeriod, maxPeriod) {
	const ts = [];
	for (const v of t ?? []) if (Number.isFinite(v)) ts.push(v);
	if (ts.length < 2) return null;
	ts.sort((a, b) => a - b);
	const span = ts[ts.length - 1] - ts[0];
	const diffs = [];
	for (let i = 1; i < ts.length; i++) {
		const d = ts[i] - ts[i - 1];
		if (d > 0) diffs.push(d);
	}
	if (!(span > 0) || diffs.length === 0) return null;
	diffs.sort((a, b) => a - b);
	const mid = diffs.length >> 1;
	const medianDt = diffs.length % 2 ? diffs[mid] : (diffs[mid - 1] + diffs[mid]) / 2;
	const nyquist = 2 * medianDt;
	const userMin = Number(minPeriod);
	const userMax = Number(maxPeriod);
	const lo = Number.isFinite(userMin) && userMin > 0 ? Math.max(userMin, nyquist) : nyquist;
	const hi = Number.isFinite(userMax) && userMax > 0 ? userMax : span;
	if (!(hi > lo)) return null;
	return { minPeriod: lo, maxPeriod: hi, nyquist, span };
}

/**
 * Fits a model comprised of N cosine curves to data.
 * Model: O + Σ B_i·cos(ω_i·t + φ_i), with every period 2π/ω_i kept inside
 * [minPeriod, maxPeriod].
 *
 * @param {number[]} t - Time/input array
 * @param {number[]} x - Data/output array
 * @param {number} N - Number of cosine curves
 * @param {Object} options
 * @param {number} options.minPeriod       - Shortest allowed period (t units). Default: Nyquist.
 * @param {number} options.maxPeriod       - Longest allowed period (t units). Default: record span.
 * @param {number[]} options.initialGuess - Optional initial params [B1,w1,o1,...,BN,wN,oN,O]
 * @param {number} options.maxIterations   - Max LM iterations per start (default 10000)
 * @param {number} options.tolerance       - Relative convergence tolerance (default 1e-12)
 * @param {boolean} options.useMultiStart  - Try several periodogram-peak starts (default true)
 * @returns {Object|null} Fitting results, with `diagnostics` = { converged, iterations,
 *   atBound: ('min'|'max'|null)[] per curve, periodRange: [min, max] }; null when the
 *   period range is empty.
 */
export function fitCosineCurves(t, x, N, options = {}) {
	if (t.length !== x.length) {
		throw new Error('Arrays t and x must have the same length');
	}

	const {
		initialGuess = null,
		maxIterations = 10000,
		// Relative RSS improvement below which a step ends the fit. Near the optimum
		// the RSS gain is quadratic in the parameter error, so 1e-6 (the old default)
		// stopped with ~1e-3 relative error left in the period; 1e-12 is at the
		// floor of what a double RSS can resolve, and the damping ceiling ends the
		// fit if no step can improve it at all.
		tolerance = 1e-12,
		useMultiStart = true,
		minPeriod = null,
		maxPeriod = null
	} = options ?? {};

	if (initialGuess && initialGuess.length !== 3 * N + 1) {
		throw new Error(`Initial guess must have ${3 * N + 1} parameters`);
	}

	const range = resolvePeriodRange(t, minPeriod, maxPeriod);
	if (!range) return null;
	const wLo = (2 * Math.PI) / range.maxPeriod;
	const wHi = (2 * Math.PI) / range.minPeriod;

	let starts;
	if (initialGuess) {
		starts = [initialGuess];
	} else {
		const peaks = scanPeriodogram(t, x, range.minPeriod, range.maxPeriod, Math.max(SCAN_PEAKS, N));
		starts = buildStarts(t, x, N, peaks, wLo, wHi);
		if (!useMultiStart) starts = starts.slice(0, 1);
	}

	let best = null;
	for (const start of starts) {
		const result = fitWithInitialGuess(t, x, N, start, maxIterations, tolerance, wLo, wHi);
		if (!Number.isFinite(result.rss)) continue;
		if (!best || result.rss < best.rss) best = result;
	}
	if (!best) {
		// Every start went non-finite: return the first attempt so the caller's
		// non-finite check can report it, rather than a silent null.
		best = fitWithInitialGuess(t, x, N, starts[0], maxIterations, tolerance, wLo, wHi);
	}
	best.diagnostics.periodRange = [range.minPeriod, range.maxPeriod];
	return best;
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

/**
 * Plain-language warnings for free-period fits whose diagnostics show the
 * result is not a rhythm estimate: the period finished on a bound of the
 * allowed range, or the optimiser ran out of iterations. Pure; callers pass
 * `{ label, result }` entries (result = a fitCosineCurves return value).
 */
export function freePeriodFitWarnings(entries, modelLabel = 'The free-period cosinor fit') {
	const out = [];
	const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : String(Number(v.toFixed(2))));
	for (const entry of entries ?? []) {
		const d = entry?.result?.diagnostics;
		if (!d) continue;
		const label = entry.label ? `${modelLabel} for ${entry.label}` : modelLabel;
		const [lo, hi] = d.periodRange ?? [NaN, NaN];
		const cosines = entry.result.parameters?.cosines ?? [];
		(d.atBound ?? []).forEach((side, i) => {
			if (!side) return;
			const c = cosines[i];
			const period = c?.frequency ? (2 * Math.PI) / c.frequency : NaN;
			const which = cosines.length > 1 ? ` (curve ${i + 1})` : '';
			const limit = side === 'max' ? 'upper' : 'lower';
			out.push(
				`${label}${which} stopped at the ${limit} limit of the period range: ${fmt(period)} h, range ${fmt(lo)} to ${fmt(hi)} h. The data have no clear rhythm inside that range (a trend, or a longer or shorter cycle, is pulling the fit), so this period, amplitude and acrophase do not describe a rhythm. Widen the period range if a longer or shorter rhythm is plausible, remove the trend, or use a fixed period.`
			);
		});
		if (d.converged === false) {
			out.push(
				`${label} did not converge (${d.iterations} iterations), so the period, amplitude and acrophase may not be the best fit. Narrow the period range around the expected period, or use a fixed period.`
			);
		}
	}
	return out;
}

// ─── Starting values ─────────────────────────────────────────────────────────

/**
 * Least-squares ("floating-mean" / generalised Lomb-Scargle) periodogram on a
 * uniform frequency grid inside [minPeriod, maxPeriod]. For each frequency the
 * power is the variance explained by the best mean + cosine + sine fit at that
 * frequency, i.e. exactly the single-cosine fit the optimiser then refines, so
 * the highest peak is the best starting basin. Returns up to `nPeaks` local
 * maxima (range endpoints included), strongest first, as angular frequencies.
 */
export function scanPeriodogram(t, x, minPeriod, maxPeriod, nPeaks = SCAN_PEAKS) {
	let ts = [];
	let xs = [];
	for (let i = 0; i < t.length; i++) {
		if (Number.isFinite(t[i]) && Number.isFinite(x[i])) {
			ts.push(t[i]);
			xs.push(x[i]);
		}
	}
	if (ts.length < 3) return [];
	let tMin = Infinity;
	let tMax = -Infinity;
	for (const v of ts) {
		if (v < tMin) tMin = v;
		if (v > tMax) tMax = v;
	}
	const span = tMax - tMin;
	if (!(span > 0)) return [];

	// Long records: average into bins for the scan only.
	if (ts.length > SCAN_MAX_POINTS) {
		const w = Math.min(span / SCAN_MAX_POINTS, minPeriod / 8);
		const nb = Math.floor(span / w) + 1;
		const st = new Float64Array(nb);
		const sx = new Float64Array(nb);
		const cnt = new Float64Array(nb);
		for (let i = 0; i < ts.length; i++) {
			const b = Math.min(nb - 1, Math.floor((ts[i] - tMin) / w));
			st[b] += ts[i];
			sx[b] += xs[i];
			cnt[b] += 1;
		}
		ts = [];
		xs = [];
		for (let b = 0; b < nb; b++) {
			if (cnt[b] > 0) {
				ts.push(st[b] / cnt[b]);
				xs.push(sx[b] / cnt[b]);
			}
		}
	}

	const n = ts.length;
	let mean = 0;
	for (const v of xs) mean += v;
	mean /= n;

	const fLo = 1 / maxPeriod;
	const fHi = 1 / minPeriod;
	const nf = Math.min(
		SCAN_MAX_FREQS,
		Math.max(SCAN_MIN_FREQS, Math.ceil(SCAN_OVERSAMPLE * span * (fHi - fLo)) + 1)
	);
	const df = (fHi - fLo) / (nf - 1);

	// Accumulate the per-frequency sums point by point, stepping cos/sin across
	// the frequency grid by rotation (no trig in the inner loop).
	const Sc = new Float64Array(nf);
	const Ss = new Float64Array(nf);
	const Scc = new Float64Array(nf);
	const Sss = new Float64Array(nf);
	const Scs = new Float64Array(nf);
	const Syc = new Float64Array(nf);
	const Sys = new Float64Array(nf);
	for (let i = 0; i < n; i++) {
		const tau = ts[i] - tMin;
		const y = xs[i] - mean;
		const a0 = 2 * Math.PI * fLo * tau;
		const da = 2 * Math.PI * df * tau;
		let c = Math.cos(a0);
		let s = Math.sin(a0);
		const cd = Math.cos(da);
		const sd = Math.sin(da);
		for (let k = 0; k < nf; k++) {
			Sc[k] += c;
			Ss[k] += s;
			Scc[k] += c * c;
			Sss[k] += s * s;
			Scs[k] += c * s;
			Syc[k] += y * c;
			Sys[k] += y * s;
			const cn = c * cd - s * sd;
			s = s * cd + c * sd;
			c = cn;
		}
	}

	const power = new Float64Array(nf);
	for (let k = 0; k < nf; k++) {
		const C = Sc[k] / n;
		const S = Ss[k] / n;
		const CC = Scc[k] / n - C * C;
		const SS = Sss[k] / n - S * S;
		const CS = Scs[k] / n - C * S;
		const YC = Syc[k] / n;
		const YS = Sys[k] / n;
		const D = CC * SS - CS * CS;
		power[k] = D > 1e-12 ? (SS * YC * YC + CC * YS * YS - 2 * CS * YC * YS) / D : 0;
	}

	const peaks = [];
	for (let k = 0; k < nf; k++) {
		const left = k === 0 ? -Infinity : power[k - 1];
		const right = k === nf - 1 ? -Infinity : power[k + 1];
		if (power[k] >= left && power[k] > right) peaks.push(k);
	}
	peaks.sort((a, b) => power[b] - power[a] || a - b);
	return peaks.slice(0, nPeaks).map((k) => ({
		frequency: 2 * Math.PI * (fLo + k * df),
		period: 1 / (fLo + k * df),
		power: power[k]
	}));
}

/**
 * Starting parameter vectors. With the frequencies fixed the model is linear in
 * (B·cos φ, B·sin φ) and the offset, so amplitude, phase and offset come from
 * an ordinary least-squares solve at the seed frequencies; the optimiser only
 * has to refine.
 *   N = 1: one start per periodogram peak.
 *   N > 1: the N strongest peaks together, then the strongest peak with its
 *          harmonics (2ω, 3ω, …) inside the range.
 */
function buildStarts(t, x, N, peaks, wLo, wHi) {
	const clampW = (w) => Math.min(wHi, Math.max(wLo, w));
	const fallback = clampW((2 * Math.PI) / 24);
	const top = peaks.length ? peaks.map((p) => p.frequency) : [fallback];
	const sets = [];
	if (N === 1) {
		for (const w of top) sets.push([w]);
	} else {
		const byPeaks = [];
		for (let i = 0; i < N; i++) byPeaks.push(i < top.length ? top[i] : clampW(top[0] * (i + 1)));
		sets.push(byPeaks);
		const harmonics = [];
		for (let i = 0; i < N; i++) harmonics.push(clampW(top[0] * (i + 1)));
		sets.push(harmonics);
	}
	return sets.map((ws) => linearInit(t, x, ws));
}

function linearInit(t, x, omegas) {
	const N = omegas.length;
	const p = 2 * N + 1;
	const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
	const Xty = new Array(p).fill(0);
	let mean = 0;
	for (const v of x) mean += v;
	mean /= x.length;
	const row = new Array(p);
	for (let i = 0; i < t.length; i++) {
		row[0] = 1;
		for (let j = 0; j < N; j++) {
			row[2 * j + 1] = Math.cos(omegas[j] * t[i]);
			row[2 * j + 2] = Math.sin(omegas[j] * t[i]);
		}
		for (let a = 0; a < p; a++) {
			Xty[a] += row[a] * x[i];
			for (let b = a; b < p; b++) XtX[a][b] += row[a] * row[b];
		}
	}
	for (let a = 0; a < p; a++) for (let b = a + 1; b < p; b++) XtX[b][a] = XtX[a][b];
	let coef = null;
	try {
		coef = solveLinearSystem(XtX, Xty);
	} catch {
		coef = null;
	}
	const params = [];
	for (let j = 0; j < N; j++) {
		if (coef) {
			// a·cos ωt + b·sin ωt = B·cos(ωt + φ) with B = hypot(a, b), φ = atan2(−b, a)
			const a = coef[2 * j + 1];
			const b = coef[2 * j + 2];
			params.push(Math.hypot(a, b), omegas[j], Math.atan2(-b, a));
		} else {
			params.push(0, omegas[j], 0);
		}
	}
	params.push(coef ? coef[0] : mean);
	return params;
}

// ─── Core LM optimizer ───────────────────────────────────────────────────────

/**
 * Levenberg-Marquardt with step rejection, relative convergence and box bounds
 * on each angular frequency ([wLo, wHi]). A frequency sitting on a bound whose
 * descent direction points out of the range is held fixed for that step (a
 * simple active set), so the other parameters keep improving instead of the
 * step being clamped into a no-op.
 * Parameter layout: [B0, w0, o0,  B1, w1, o1,  …,  O]
 */
function fitWithInitialGuess(t, x, N, initialParams, maxIterations, tolerance, wLo, wHi) {
	const numParams = 3 * N + 1; // no redundant A term
	let params = [...initialParams];

	if (params.length !== numParams) {
		throw new Error(`Initial guess must have ${numParams} parameters`);
	}
	for (let i = 0; i < N; i++) {
		params[3 * i + 1] = Math.min(wHi, Math.max(wLo, params[3 * i + 1]));
	}

	let lambda = 0.01;
	let { JtJ, JtR, rss: currentRss } = computeNormalEquations(t, x, params, N);
	let converged = false;
	let iterations = 0;

	for (let iter = 0; iter < maxIterations; iter++) {
		iterations = iter + 1;
		// Frequencies pinned on a bound this step (descent would leave the range).
		// The Gauss-Newton move is −JtR (newParams = params − delta).
		const frozen = new Array(numParams).fill(false);
		for (let i = 0; i < N; i++) {
			const j = 3 * i + 1;
			const move = -JtR[j];
			if ((params[j] <= wLo && move < 0) || (params[j] >= wHi && move > 0)) frozen[j] = true;
		}
		// Damp diagonal: use JtJ[i][i] scaling (Marquardt's original scaling)
		const JtJ_d = JtJ.map((row, i) => {
			if (frozen[i]) return row.map((_, k) => (k === i ? 1 : 0));
			const r = row.map((v, k) => (frozen[k] ? 0 : v));
			r[i] += lambda * (row[i] > 0 ? row[i] : 1);
			return r;
		});
		const rhs = JtR.map((v, i) => (frozen[i] ? 0 : v));

		let delta;
		try {
			delta = solveLinearSystem(JtJ_d, rhs);
		} catch {
			lambda = Math.min(lambda * 10, 1e12);
			if (lambda >= 1e12) {
				converged = true; // no descent step exists at any damping
				break;
			}
			continue;
		}

		// Proposed new parameters, frequencies kept inside the period range.
		const newParams = params.map((p, i) => p - delta[i]);
		for (let i = 0; i < N; i++) {
			newParams[3 * i + 1] = Math.min(wHi, Math.max(wLo, newParams[3 * i + 1]));
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
			if (relImprovement < tolerance) {
				converged = true;
				break;
			}
		} else {
			// Reject step — increase damping. At the damping ceiling no step
			// lowers the RSS: the fit is at a (constrained) minimum.
			lambda = Math.min(lambda * 10, 1e12);
			if (lambda >= 1e12) {
				converged = true;
				break;
			}
		}
	}

	// Canonical form: B ≥ 0 and φ in (−π, π]. B·cos(ωt + φ) = (−B)·cos(ωt + φ + π),
	// so the optimiser may return either sign; reporting one form keeps the
	// amplitude positive and the acrophase (−φ/ω) meaningful.
	for (let i = 0; i < N; i++) {
		if (params[3 * i] < 0) {
			params[3 * i] = -params[3 * i];
			params[3 * i + 2] += Math.PI;
		}
		params[3 * i + 2] = wrapPhase(params[3 * i + 2]);
	}

	// Final statistics
	const fitted = t.map((ti) => evaluateModel(ti, params, N));
	const residuals = t.map((ti, i) => x[i] - fitted[i]);
	const rmse = Math.sqrt(currentRss / t.length);

	const xMeanAcc = new KahanSum();
	for (const v of x) xMeanAcc.add(v);
	const xMean = xMeanAcc.value / x.length;
	const sstotAcc = new KahanSum();
	for (const v of x) sstotAcc.add((v - xMean) ** 2);
	const rSquared = sstotAcc.value > 0 ? 1 - currentRss / sstotAcc.value : 0;

	const atBound = Array.from({ length: N }, (_, i) => {
		const w = params[3 * i + 1];
		if (Math.abs(w - wLo) <= BOUND_RTOL * wLo) return 'max'; // lowest frequency = longest period
		if (Math.abs(w - wHi) <= BOUND_RTOL * wHi) return 'min';
		return null;
	});
	const allFinite = params.every(Number.isFinite) && Number.isFinite(currentRss);

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
		fitted,
		residuals,
		rmse,
		rSquared,
		rss: currentRss,
		diagnostics: { converged: converged && allFinite, iterations, atBound }
	};
}

function wrapPhase(phi) {
	const twoPi = 2 * Math.PI;
	let p = phi % twoPi;
	if (p <= -Math.PI) p += twoPi;
	else if (p > Math.PI) p -= twoPi;
	return p;
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
 *
 * Each harmonic reports `acrophase_hrs` as the time of peak (t units after
 * t = 0, in [0, period/k)), with a delta-method SE and an unwrapped CI around it.
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
	// Upper-tail p-value: P(F > F_stat) = 1 - CDF(F_stat). The stdlib cdf_f is
	// strictly lower-tail; using it directly inverted significance everywhere.
	const pF = isNaN(F_stat) ? NaN : 1 - cdf_f(F_stat, 2 * nHarmonics, df_res);

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

	const t_crit = quantile_t(1 - alpha / 2, df_res, 0);

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

		// ACROPHASE CONVENTION: `acrophase_hrs` is the TIME OF PEAK of harmonic k,
		// in t units (hours) after t = 0, wrapped into [0, period/k). β·cos + γ·sin
		// = A·cos(kωt − θ) with θ = atan2(γ, β) = −φ, which peaks at t = θ/(kω).
		// This function used to return the classical wrap(φ/(kω)) = wrap(−t_peak)
		// instead, and every consumer had to remember to negate it; the Cosinor
		// panel and stats CSV did not, so one node showed 06:00 on its port and
		// 18:00 in its panel for the same rhythm. `phi_rad` (the model phase used
		// for evaluation) is unchanged.
		let acrophase_hrs = (-phi_k * period) / (2 * Math.PI * k);
		if (acrophase_hrs < 0) acrophase_hrs += period / k;
		if (acrophase_hrs >= period / k) acrophase_hrs -= period / k;

		// Delta-method standard errors from the FULL covariance of (β, γ). On a
		// whole number of evenly sampled cycles cos and sin are orthogonal and
		// cov(β, γ) ≈ 0, but on short or uneven records it is not, and leaving it
		// out made SE(A) up to ~2% wrong against statsmodels (and SE of the
		// acrophase likewise). ∂A/∂β = β/A, ∂A/∂γ = γ/A; ∂θ/∂β = −γ/A², ∂θ/∂γ = β/A².
		const varBeta = MSE * XtX_inv[bIdx][bIdx];
		const varGamma = MSE * XtX_inv[gIdx][gIdx];
		const covBG = MSE * XtX_inv[bIdx][gIdx];

		const varA =
			A_k > 0
				? (beta_k ** 2 * varBeta + gamma_k ** 2 * varGamma + 2 * beta_k * gamma_k * covBG) /
					A_k ** 2
				: 0;
		const SE_A = Math.sqrt(Math.max(0, varA));
		const CI_A = [Math.max(0, A_k - t_crit * SE_A), A_k + t_crit * SE_A];

		const varPhi =
			A_k > 0
				? (gamma_k ** 2 * varBeta + beta_k ** 2 * varGamma - 2 * beta_k * gamma_k * covBG) /
					A_k ** 4
				: 0;
		const SE_acrophase_hrs = (Math.sqrt(Math.max(0, varPhi)) * period) / (2 * Math.PI * k);
		// Symmetric interval around the peak time, NOT wrapped (so lo ≤ acrophase ≤ hi
		// always holds); wrap each end for clock-time display.
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
