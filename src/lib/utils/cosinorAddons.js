// Cheap Cosinor / nonparametric add-on metrics.
//
// Pure, dependency-free helpers derived from quantities that AnCiR already
// computes (cosinor acrophase; nonparametric IS / IV / RA). No Svelte, no I/O —
// this is the numerically-critical core with 1:1 Python parity.

/**
 * Wrap a value into the half-open interval [0, period).
 * @param {number} hrs
 * @param {number} periodHrs  must be > 0
 * @returns {number} NaN when inputs are non-finite / period ≤ 0
 */
export function wrapToPeriod(hrs, periodHrs) {
	if (!Number.isFinite(hrs) || !(periodHrs > 0)) return NaN;
	return ((hrs % periodHrs) + periodHrs) % periodHrs;
}

/**
 * Bathyphase — the trough (minimum) time of a fitted single cosine.
 *
 * A cosine peaks at its acrophase and, being symmetric, reaches its minimum
 * exactly half a period later. The result is wrapped into [0, period).
 *
 * @param {number} acrophaseHrs  time of peak (h), in [0, period)
 * @param {number} periodHrs     fitted period (h), > 0
 * @returns {number} trough time (h) in [0, period), or NaN
 */
export function bathyphase(acrophaseHrs, periodHrs) {
	if (!Number.isFinite(acrophaseHrs) || !(periodHrs > 0)) return NaN;
	return wrapToPeriod(acrophaseHrs + periodHrs / 2, periodHrs);
}

/** Grid points per period for the dense evaluation in `multiComponentWaveform`. */
export const WAVEFORM_GRID_POINTS = 2880;

/**
 * Overall amplitude, orthophase and bathyphase of a multi-harmonic cosinor.
 *
 * With several harmonics the fitted curve is
 *   y(t) = M + Σ_k [β_k cos(kωt) + γ_k sin(kωt)],   ω = 2π / period,
 * and harmonic 1's amplitude and acrophase no longer describe it: the waveform's
 * peak can sit hours away from harmonic 1's peak, and its peak-to-trough range is
 * not 2·A1. Cornelissen (2014, Theor Biol Med Model 11:16) describes the overall
 * amplitude, orthophase and bathyphase of such multi-component models as half the
 * curve's range and the times of its maximum and minimum; they are found here
 * numerically.
 *
 * Method: evaluate y on WAVEFORM_GRID_POINTS equally spaced times over one
 * period [0, period), take the grid maximum and minimum, and refine each by a
 * parabola through it and its two neighbours (circular indexing; the step is
 * period/2880, 30 s for 24 h, so the refinement only polishes the last digits).
 *
 * @param {number} M  MESOR
 * @param {{k:number, beta:number, gamma:number}[]} harmonics
 * @param {number} period  fundamental period (h), > 0
 * @returns {{amplitude:number, orthophase:number, bathyphase:number, max:number, min:number}}
 *   amplitude = (max - min) / 2; orthophase / bathyphase = times (h) of the maximum /
 *   minimum in [0, period). Every field NaN for non-finite input.
 */
export function multiComponentWaveform(M, harmonics, period) {
	const nan = { amplitude: NaN, orthophase: NaN, bathyphase: NaN, max: NaN, min: NaN };
	if (!Number.isFinite(M) || !(period > 0) || !Array.isArray(harmonics) || !harmonics.length) {
		return nan;
	}
	for (const h of harmonics) {
		if (![h?.k, h?.beta, h?.gamma].every(Number.isFinite)) return nan;
	}
	const N = WAVEFORM_GRID_POINTS;
	const dt = period / N;
	const omega = (2 * Math.PI) / period;
	const y = new Float64Array(N);
	let iMax = 0;
	let iMin = 0;
	for (let i = 0; i < N; i++) {
		const t = i * dt;
		let v = M;
		for (const h of harmonics) {
			v += h.beta * Math.cos(h.k * omega * t) + h.gamma * Math.sin(h.k * omega * t);
		}
		y[i] = v;
		if (v > y[iMax]) iMax = i;
		if (v < y[iMin]) iMin = i;
	}
	// Parabolic refinement through (i-1, i, i+1): vertex offset in grid steps.
	const refine = (i) => {
		const a = y[(i - 1 + N) % N];
		const b = y[i];
		const c = y[(i + 1) % N];
		const denom = a - 2 * b + c;
		const d = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
		const off = Math.max(-0.5, Math.min(0.5, d));
		return { t: wrapToPeriod((i + off) * dt, period), v: b - 0.25 * (a - c) * off };
	};
	const hi = refine(iMax);
	const lo = refine(iMin);
	return {
		amplitude: (hi.v - lo.v) / 2,
		orthophase: hi.t,
		bathyphase: lo.t,
		max: hi.v,
		min: lo.v
	};
}

/**
 * Phase angle of entrainment (ψ) — the phase relationship between an internal
 * rhythm marker (the acrophase) and an external zeitgeber reference time.
 *
 * ψ = acrophase − reference, reported as the signed smallest-magnitude
 * difference in the interval (−period/2, +period/2]. ψ ≈ 0 means the rhythm
 * peaks at the reference; ψ > 0 means the peak follows the reference (phase
 * delayed within the cycle), ψ < 0 means it precedes it (phase advanced).
 *
 * @param {number} acrophaseHrs  time of peak (h)
 * @param {number} [referenceHrs=0]  zeitgeber reference time (h)
 * @param {number} [periodHrs=24]  cycle length (h), > 0
 * @returns {number} signed phase angle (h) in (−period/2, period/2], or NaN
 */
export function phaseAngleOfEntrainment(acrophaseHrs, referenceHrs = 0, periodHrs = 24) {
	if (!Number.isFinite(acrophaseHrs) || !(periodHrs > 0)) return NaN;
	const ref = Number.isFinite(referenceHrs) ? referenceHrs : 0;
	let d = wrapToPeriod(acrophaseHrs - ref, periodHrs);
	if (d > periodHrs / 2) d -= periodHrs; // fold onto (−P/2, +P/2]
	return d;
}

const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : NaN);

/**
 * Circadian Function Index (CFI) — a single 0–1 summary of nonparametric
 * rest-activity rhythm robustness, combining Interdaily Stability (IS),
 * Intradaily Variability (IV) and Relative Amplitude (RA).
 *
 * Ortiz-Tudela E, Martinez-Nicolas A, Campos M, Rol MÁ, Madrid JA (2010).
 * "A New Integrated Variable Based on Thermometry, Actimetry and Body Position
 * (TAP) to Evaluate Circadian System Status in Humans." PLoS Comput Biol
 * 6(11): e1000996. https://doi.org/10.1371/journal.pcbi.1000996
 *
 * CFI is the mean of three components each normalised to [0, 1]:
 *  - IS is already in [0, 1] (coupling of the rhythm to the zeitgeber cycle).
 *  - RA is already in [0, 1] (relative amplitude of the average profile).
 *  - IV ranges ≈[0, 2] (≈0 for a smooth rhythm, ≈2 for white noise), so its
 *    complement (2 − IV)/2 maps a well-consolidated rhythm → 1 and noise → 0.
 * Each component is clamped to [0, 1] before averaging; any non-finite input
 * yields a non-finite CFI so callers never treat a missing value as 0.
 *
 * @param {{IS:number, IV:number, RA:number}} vars
 * @returns {{CFI:number, components:{IS:number, IVcomplement:number, RA:number}}}
 */
export function circadianFunctionIndex({ IS, IV, RA } = {}) {
	const isC = clamp01(IS);
	const ivC = clamp01((2 - IV) / 2);
	const raC = clamp01(RA);
	const components = { IS: isC, IVcomplement: ivC, RA: raC };
	if (![isC, ivC, raC].every(Number.isFinite)) return { CFI: NaN, components };
	return { CFI: (isC + ivC + raC) / 3, components };
}
