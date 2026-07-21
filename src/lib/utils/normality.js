// @ts-nocheck
// Normality tests: D'Agostino-Pearson K² (scipy.stats.normaltest) and Jarque-Bera.
//
// Both are omnibus, moment-based tests (skewness + kurtosis), so they need no fiddly order-
// statistic coefficients and can be implemented correctly and parity-checked against scipy.
// The p-value is a χ²(2) upper tail = exp(-stat/2). Everything returns NaN rather than throwing.
//
// (Shapiro-Wilk was considered but its Royston-1992 coefficient algorithm is error-prone;
// these two cover the same need — detecting departure from normality via skew/kurtosis — and
// are exactly reproducible against scipy. Shapiro-Wilk is a possible follow-up.)
import { isInvalidValue } from './stats.js';

const clean = (values) => (values ?? []).filter((v) => !isInvalidValue(v)).map(Number);

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
 * D'Agostino-Pearson K² omnibus test (scipy.stats.normaltest). Needs n ≥ 8 (kurtosis Z is
 * unreliable below ~20; scipy warns but still returns).
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
 * @param {'dagostino'|'jarquebera'} method
 */
export function normalityTest(values, method = 'dagostino') {
	return method === 'jarquebera' ? jarqueBera(values) : dAgostino(values);
}
