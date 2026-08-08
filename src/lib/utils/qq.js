// @ts-nocheck
// Q-Q plot maths: normal quantile function, Blom plotting positions, and the
// full theoretical-vs-sample quantile computation with a quartile reference
// line and a pointwise confidence envelope.
//
// PLOTTING POSITIONS: Blom, (i - 3/8)/(n + 1/4), for ALL n. It is near-unbiased
// for the normal distribution (the only theoretical distribution in v1) and it
// is already the house convention — utils/normality.js computes its
// Shapiro-Wilk expected order statistics the same way, so the picture and the
// statistic users compare it against agree. NOTE the deliberate deviation from
// R: R's ppoints() switches to Hazen (i - 1/2)/n for n > 10 (Filliben is
// NIST's choice); the visual difference is negligible beyond tiny n and one
// formula is simpler to test and to port (pinned to scipy.stats.norm.ppf with
// explicit Blom positions in tools/parity/fixtures.json).
//
// STATS-LIBRARY POLICY (D13): normalQuantile is Acklam's rational
// approximation (~1.15e-9 accurate), the single shared copy — normality.js and
// correlation.js import it from here rather than keeping private duplicates.
import { isInvalidValue } from './stats.js';

/**
 * Standard-normal quantile (inverse CDF), Acklam's rational approximation,
 * accurate to ~1.15e-9 across the range.
 * @param {number} p probability
 * @returns {number} z with Φ(z) = p; -Infinity at p<=0, +Infinity at p>=1, NaN for NaN
 */
export function normalQuantile(p) {
	if (Number.isNaN(p) || p == null) return NaN;
	if (p <= 0) return -Infinity;
	if (p >= 1) return Infinity;
	const a = [
		-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
		-3.066479806614716e1, 2.506628277459239
	];
	const b = [
		-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
		-1.328068155288572e1
	];
	const c = [
		-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
		4.374664141464968, 2.938163982698783
	];
	const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
	const pLow = 0.02425;
	if (p < pLow) {
		const q = Math.sqrt(-2 * Math.log(p));
		return (
			(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
			((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
		);
	}
	if (p <= 1 - pLow) {
		const q = p - 0.5;
		const r = q * q;
		return (
			((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
			(((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
		);
	}
	const q = Math.sqrt(-2 * Math.log(1 - p));
	return (
		-(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
		((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
	);
}

/** Standard-normal density φ(z). */
export function normalPdf(z) {
	return 0.3989422804014327 * Math.exp(-(z * z) / 2);
}

/**
 * Blom plotting positions p_i = (i - 3/8)/(n + 1/4), i = 1..n.
 * @param {number} n sample size
 * @returns {number[]} probabilities, ascending
 */
export function blomPositions(n) {
	const out = new Array(Math.max(0, n | 0));
	for (let i = 0; i < out.length; i++) out[i] = (i + 1 - 0.375) / (n + 0.25);
	return out;
}

/**
 * Probability-plot correlation coefficient: Pearson r between the sorted
 * sample and its theoretical quantiles. The closer to 1, the closer the
 * points lie to a straight line — i.e. the closer the sample's shape is to
 * the theoretical (normal) distribution.
 *
 * FILLIBEN'S STATISTIC ON BLOM'S POSITIONS: Filliben (1975) defines this
 * correlation using order-statistic MEDIANS (Filliben positions) for the
 * theoretical quantiles. Here it is deliberately computed on the SAME
 * Blom-position quantiles that qqPoints() plots, so the number describes
 * exactly the picture on screen (and Blom is the house convention — see the
 * header note). The two position formulas differ by well under display
 * precision for any realistic n.
 *
 * Implemented locally rather than importing utils/correlation.js pearson():
 * correlation.js already imports normalQuantile from THIS module, and a
 * two-way import cycle is not worth a ten-line sum.
 *
 * @param {number[]} theoretical theoretical quantiles, ascending
 * @param {number[]} sample sorted sample values, same length
 * @returns {number|null} r in (-1, 1], or null when there are fewer than 3
 *   pairs or either side has zero variance (e.g. constant data) — r is
 *   undefined there, and null (not NaN) makes the "no statistic" case
 *   explicit for the panel display.
 */
export function qqCorrelation(theoretical, sample) {
	const n = Math.min(theoretical?.length ?? 0, sample?.length ?? 0);
	if (n < 3) return null;
	let sx = 0;
	let sy = 0;
	for (let i = 0; i < n; i++) {
		sx += theoretical[i];
		sy += sample[i];
	}
	const mx = sx / n;
	const my = sy / n;
	let sxy = 0;
	let sxx = 0;
	let syy = 0;
	for (let i = 0; i < n; i++) {
		const dx = theoretical[i] - mx;
		const dy = sample[i] - my;
		sxy += dx * dy;
		sxx += dx * dx;
		syy += dy * dy;
	}
	if (sxx === 0 || syy === 0 || !Number.isFinite(sxx) || !Number.isFinite(syy)) return null;
	return sxy / Math.sqrt(sxx * syy);
}

// Type-7 / numpy-default quantile (linear interpolation) of an ALREADY-SORTED array.
function quantileSorted(sorted, q) {
	const n = sorted.length;
	if (n === 0) return NaN;
	if (n === 1) return sorted[0];
	const pos = q * (n - 1);
	const lo = Math.floor(pos);
	const frac = pos - lo;
	return sorted[lo] + (sorted[Math.min(lo + 1, n - 1)] - sorted[lo]) * frac;
}

/**
 * Normal Q-Q computation for one sample.
 *
 * - theoretical: standard-normal quantiles at the Blom positions
 * - sample: the sorted valid values (raw units)
 * - line: the quartile reference line (R's qqline) — slope/intercept through
 *   the (theoretical, sample) first and third quartile pair. Robust to tail
 *   departures, which is what the plot exists to reveal; a least-squares line
 *   would be dragged by exactly those points.
 * - band: POINTWISE confidence envelope around the line (the car::qqPlot
 *   construction): SE_i = (slope / φ(z_i)) · sqrt(p_i (1 - p_i) / n),
 *   lo/hi = line(z_i) ∓/± z_{1-α/2} · SE_i. Being pointwise, ~α of points
 *   stray outside it even under perfect normality.
 *
 * - r: the probability-plot correlation coefficient (see qqCorrelation) of
 *   the plotted (theoretical, sample) pairs; null when undefined (n < 3, or
 *   constant data).
 *
 * @param {Array} values raw column values (nulls / NaNs are dropped)
 * @param {{distribution?: string, confidence?: number}} [opts]
 * @returns {{theoretical:number[], sample:number[], line:{slope:number,intercept:number}, band:{lo:number[],hi:number[]}, r:(number|null), n:number, dropped:number}}
 */
export function qqPoints(values, { distribution = 'normal', confidence = 0.95 } = {}) {
	// v1: 'normal' is the only distribution; the option exists so persisted
	// sessions never need migrating when others are added.
	void distribution;
	const raw = values ?? [];
	const sample = raw
		.filter((v) => !isInvalidValue(v))
		.map(Number)
		.sort((a, b) => a - b);
	const n = sample.length;
	const dropped = raw.length - n;
	if (n < 3) {
		return {
			theoretical: [],
			sample: [],
			line: { slope: NaN, intercept: NaN },
			band: { lo: [], hi: [] },
			r: null,
			n,
			dropped
		};
	}

	const positions = blomPositions(n);
	const theoretical = positions.map(normalQuantile);

	// Quartile line: through (qnorm(0.25), Q1) and (qnorm(0.75), Q3).
	const zQ1 = normalQuantile(0.25);
	const zQ3 = normalQuantile(0.75);
	const sQ1 = quantileSorted(sample, 0.25);
	const sQ3 = quantileSorted(sample, 0.75);
	const slope = (sQ3 - sQ1) / (zQ3 - zQ1);
	const intercept = sQ1 - slope * zQ1;

	const zCrit = normalQuantile(1 - (1 - confidence) / 2);
	const lo = new Array(n);
	const hi = new Array(n);
	for (let i = 0; i < n; i++) {
		const z = theoretical[i];
		const fit = intercept + slope * z;
		const se = (slope / normalPdf(z)) * Math.sqrt((positions[i] * (1 - positions[i])) / n);
		lo[i] = fit - zCrit * se;
		hi[i] = fit + zCrit * se;
	}

	return {
		theoretical,
		sample,
		line: { slope, intercept },
		band: { lo, hi },
		r: qqCorrelation(theoretical, sample),
		n,
		dropped
	};
}
