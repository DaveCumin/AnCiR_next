// @ts-nocheck
// Normality tests: Shapiro-Wilk (Royston AS R94), D'Agostino-Pearson K² (scipy normaltest) and
// Jarque-Bera.
//
// Shapiro-Wilk is the default — it is the most powerful of the three for detecting departures from
// normality in small-to-moderate samples, and is what most people mean by "the normality test".
// It is valid for 3 ≤ n ≤ 5000. D'Agostino (omnibus skewness + kurtosis, n ≥ 8) and Jarque-Bera
// (n ≥ 3) are moment-based alternatives; D'Agostino behaves better than Shapiro on very large n.
//
// STATS-LIBRARY POLICY: all three are bespoke but pinned to scipy in the parity harness — Shapiro
// to scipy.stats.shapiro (exact to 6 dp), the moment tests to normaltest / jarque_bera. Shapiro's
// tail transform uses an erf-based normal CDF (accurate to ~1e-7, enough for a reported p-value);
// the χ²(2) tail of the moment tests is the analytic exp(-stat/2). Everything returns NaN rather
// than throwing.
import { isInvalidValue } from './stats.js';

const clean = (values) => (values ?? []).filter((v) => !isInvalidValue(v)).map(Number);

// --- normal CDF / quantile (shared by Shapiro-Wilk) --------------------------
// Standard normal CDF via erf (Abramowitz & Stegun 7.1.26), ~1e-7 accurate.
function normalCdf(z) {
	const t = 1 / (1 + 0.2316419 * Math.abs(z));
	const d = 0.3989422804014327 * Math.exp(-(z * z) / 2);
	const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
	return z >= 0 ? 1 - p : p;
}
// Inverse normal CDF (Acklam's algorithm), ~1e-9 accurate — for the Shapiro-Wilk m-values.
function normalQuantile(p) {
	if (p <= 0) return -Infinity;
	if (p >= 1) return Infinity;
	const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
	const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
	const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
	const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
	const pLow = 0.02425;
	const pHigh = 1 - pLow;
	if (p < pLow) {
		const q = Math.sqrt(-2 * Math.log(p));
		return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
	}
	if (p <= pHigh) {
		const q = p - 0.5;
		const r = q * q;
		return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
	}
	const q = Math.sqrt(-2 * Math.log(1 - p));
	return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// --- Shapiro-Wilk (Royston 1992/1995, AS R94) --------------------------------
// Coefficient polynomials in ASCENDING power order (constant term first) — the order matters and
// getting it wrong silently corrupts the weights. `poly(c, x) = Σ c[j]·xʲ`.
const SW_C1 = [0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056];
const SW_C2 = [0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633];
const SW_C3 = [0.544, -0.39978, 0.025054, -6.714e-4];
const SW_C4 = [1.3822, -0.77857, 0.062767, -0.0020322];
const SW_C5 = [-1.5861, -0.31082, -0.083751, 0.0038915];
const SW_C6 = [-0.4803, -0.082676, 0.0030302];
const SW_G = [-2.273, 0.459];
const poly = (c, x) => c.reduce((acc, cj, j) => acc + cj * x ** j, 0);

/**
 * Shapiro-Wilk test (Royston AS R94), valid for 3 ≤ n ≤ 5000.
 * @returns {{statistic:number, pvalue:number, n:number}} W and its p-value; NaN when n<3.
 */
export function shapiroWilk(values) {
	const x = clean(values).sort((a, b) => a - b);
	const n = x.length;
	if (n < 3) return { statistic: NaN, pvalue: NaN, n };

	// Antisymmetric weight vector a[0..n-1] (a[i] = −a[n-1-i]).
	const a = new Array(n).fill(0);
	if (n === 3) {
		a[0] = -Math.SQRT1_2;
		a[2] = Math.SQRT1_2;
	} else {
		// m[i] = expected value of the i-th standard-normal order statistic (approx).
		const m = new Array(n);
		for (let i = 0; i < n; i++) m[i] = normalQuantile((i + 1 - 0.375) / (n + 0.25));
		const ssm = m.reduce((s, v) => s + v * v, 0);
		const sq = Math.sqrt(ssm);
		const rsn = 1 / Math.sqrt(n);
		const aN = m[n - 1] / sq + poly(SW_C1, rsn); // corrected largest weight
		let fac;
		if (n > 5) {
			const aN1 = m[n - 2] / sq + poly(SW_C2, rsn);
			fac = Math.sqrt((ssm - 2 * m[n - 1] ** 2 - 2 * m[n - 2] ** 2) / (1 - 2 * aN * aN - 2 * aN1 * aN1));
			a[n - 1] = aN;
			a[0] = -aN;
			a[n - 2] = aN1;
			a[1] = -aN1;
			for (let i = 2; i < n - 2; i++) a[i] = m[i] / fac;
		} else {
			fac = Math.sqrt((ssm - 2 * m[n - 1] ** 2) / (1 - 2 * aN * aN));
			a[n - 1] = aN;
			a[0] = -aN;
			for (let i = 1; i < n - 1; i++) a[i] = m[i] / fac;
		}
	}

	const mean = x.reduce((s, v) => s + v, 0) / n;
	let num = 0;
	let den = 0;
	for (let i = 0; i < n; i++) {
		num += a[i] * x[i];
		den += (x[i] - mean) ** 2;
	}
	if (den === 0) return { statistic: NaN, pvalue: NaN, n };
	let W = (num * num) / den;
	if (W > 1) W = 1;

	// Royston's normalising transform → a standard-normal z → upper-tail p.
	let pvalue;
	if (n === 3) {
		const pi6 = 1.90985931710274; // 6/π
		const stqr = 1.0471975511966; // asin(sqrt(3/4))
		pvalue = pi6 * (Math.asin(Math.sqrt(W)) - stqr);
	} else {
		const w1 = Math.log(1 - W);
		let y;
		let mu;
		let sigma;
		if (n <= 11) {
			const gamma = poly(SW_G, n);
			if (gamma - w1 <= 0) return { statistic: W, pvalue: 0, n }; // extreme non-normality
			y = -Math.log(gamma - w1);
			mu = poly(SW_C3, n);
			sigma = Math.exp(poly(SW_C4, n));
		} else {
			const lnN = Math.log(n);
			y = w1;
			mu = poly(SW_C5, lnN);
			sigma = Math.exp(poly(SW_C6, lnN));
		}
		pvalue = 1 - normalCdf((y - mu) / sigma);
	}
	return { statistic: W, pvalue: Math.max(0, Math.min(1, pvalue)), n };
}

// --- moment-based omnibus tests ----------------------------------------------
/** Central moments m2..m4 of a cleaned sample. */
function moments(x) {
	const n = x.length;
	const mean = x.reduce((s, v) => s + v, 0) / n;
	let m2 = 0;
	let m3 = 0;
	let m4 = 0;
	for (const v of x) {
		const d = v - mean;
		const d2 = d * d;
		m2 += d2;
		m3 += d2 * d;
		m4 += d2 * d2;
	}
	return { n, m2: m2 / n, m3: m3 / n, m4: m4 / n };
}

/** scipy.stats.skewtest Z (needs n ≥ 8). */
function skewZ(n, b1) {
	const y = b1 * Math.sqrt(((n + 1) * (n + 3)) / (6 * (n - 2)));
	const beta2 = (3 * (n * n + 27 * n - 70) * (n + 1) * (n + 3)) / ((n - 2) * (n + 5) * (n + 7) * (n + 9));
	const W2 = -1 + Math.sqrt(2 * (beta2 - 1));
	const delta = 1 / Math.sqrt(0.5 * Math.log(W2));
	const alpha = Math.sqrt(2 / (W2 - 1));
	const yy = y === 0 ? 1 : y;
	return delta * Math.log(yy / alpha + Math.sqrt((yy / alpha) ** 2 + 1));
}

/** scipy.stats.kurtosistest Z (needs n ≥ 20 for accuracy). */
function kurtZ(n, b2) {
	const E = (3 * (n - 1)) / (n + 1);
	const varB2 = (24 * n * (n - 2) * (n - 3)) / ((n + 1) * (n + 1) * (n + 3) * (n + 5));
	const x = (b2 - E) / Math.sqrt(varB2);
	const sqrtBeta1 = ((6 * (n * n - 5 * n + 2)) / ((n + 7) * (n + 9))) * Math.sqrt((6 * (n + 3) * (n + 5)) / (n * (n - 2) * (n - 3)));
	const A = 6 + (8 / sqrtBeta1) * (2 / sqrtBeta1 + Math.sqrt(1 + 4 / (sqrtBeta1 * sqrtBeta1)));
	const term1 = 1 - 2 / (9 * A);
	const denom = 1 + x * Math.sqrt(2 / (A - 4)); // Math.cbrt handles a negative denom, matching scipy's sign() branch
	const term2 = Math.cbrt((1 - 2 / A) / denom);
	return (term1 - term2) / Math.sqrt(2 / (9 * A));
}

/**
 * D'Agostino-Pearson K² omnibus test (scipy.stats.normaltest). Needs n ≥ 8.
 * @returns {{statistic:number, pvalue:number, n:number}} K² and its χ²(2) p-value.
 */
export function dAgostino(values) {
	const x = clean(values);
	const { n, m2, m3, m4 } = moments(x);
	if (n < 8 || m2 === 0) return { statistic: NaN, pvalue: NaN, n };
	const b1 = m3 / m2 ** 1.5; // sample skewness (biased)
	const b2 = m4 / (m2 * m2); // sample kurtosis (biased, NOT excess)
	const zs = skewZ(n, b1);
	const zk = kurtZ(n, b2);
	const K2 = zs * zs + zk * zk;
	return { statistic: K2, pvalue: Math.exp(-K2 / 2), n };
}

/**
 * Jarque-Bera test: JB = n/6 (S² + (K−3)²/4) ~ χ²(2).
 * @returns {{statistic:number, pvalue:number, n:number}}
 */
export function jarqueBera(values) {
	const x = clean(values);
	const { n, m2, m3, m4 } = moments(x);
	if (n < 3 || m2 === 0) return { statistic: NaN, pvalue: NaN, n };
	const S = m3 / m2 ** 1.5;
	const K = m4 / (m2 * m2);
	const JB = (n / 6) * (S * S + ((K - 3) * (K - 3)) / 4);
	return { statistic: JB, pvalue: Math.exp(-JB / 2), n };
}

/**
 * @param {number[]} values
 * @param {'shapiro'|'dagostino'|'jarquebera'} method
 */
export function normalityTest(values, method = 'shapiro') {
	if (method === 'jarquebera') return jarqueBera(values);
	if (method === 'dagostino') return dAgostino(values);
	return shapiroWilk(values);
}
