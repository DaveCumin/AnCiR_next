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
