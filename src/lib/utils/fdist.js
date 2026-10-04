// F-distribution helpers. Isolated so every F-test shares one upper tail: the Rayleigh
// analysis node, the Circular phase plot (circular.js itself stays dependency-free and takes
// this as a `pFromF` callback), Compare groups, the cosinor zero-amplitude test and the
// actogram harmonic check.
//
// The tail is computed directly from the regularised incomplete beta function, not as
// `1 - cdf`: the subtraction loses everything below ~1e-16 and reports p = 0 for any strong
// effect (an F of 200 on (2, 94) df has p = 1.35e-34). Mirrored by scipy.stats.f.sf and R's
// pf(f, df1, df2, lower.tail = FALSE).
import gammaln from '@stdlib/math-base-special-gammaln';

/**
 * Continued fraction for the regularised incomplete beta function (modified Lentz), as in
 * Numerical Recipes `betacf`. Converges quickly for x < (a + 1) / (a + b + 2).
 * @param {number} x
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function betaContinuedFraction(x, a, b) {
	const tiny = 1e-300;
	const qab = a + b;
	const qap = a + 1;
	const qam = a - 1;
	let c = 1;
	let d = 1 - (qab * x) / qap;
	if (Math.abs(d) < tiny) d = tiny;
	d = 1 / d;
	let h = d;
	for (let m = 1; m <= 10000; m++) {
		const m2 = 2 * m;
		let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
		d = 1 + aa * d;
		if (Math.abs(d) < tiny) d = tiny;
		c = 1 + aa / c;
		if (Math.abs(c) < tiny) c = tiny;
		d = 1 / d;
		h *= d * c;
		aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
		d = 1 + aa * d;
		if (Math.abs(d) < tiny) d = tiny;
		c = 1 + aa / c;
		if (Math.abs(c) < tiny) c = tiny;
		d = 1 / d;
		const del = d * c;
		h *= del;
		if (Math.abs(del - 1) < 1e-16) break;
	}
	return h;
}

/**
 * Regularised incomplete beta I_x(a, b), each tail computed from its own side so a tiny
 * value is never the difference of two numbers near 1.
 * @param {number} x  in [0, 1]
 * @param {number} a  > 0
 * @param {number} b  > 0
 */
export function regularizedBeta(x, a, b) {
	if (!(a > 0) || !(b > 0) || !(x >= 0) || !(x <= 1)) return NaN;
	if (x === 0) return 0;
	if (x === 1) return 1;
	const lnFront = gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log1p(-x);
	if (x < (a + 1) / (a + b + 2)) {
		return (Math.exp(lnFront) * betaContinuedFraction(x, a, b)) / a;
	}
	return 1 - (Math.exp(lnFront) * betaContinuedFraction(1 - x, b, a)) / b;
}

/**
 * Upper-tail probability P(X > fValue) for X ~ F(df1, df2):
 * I_{df2 / (df2 + df1 * f)}(df2 / 2, df1 / 2).
 * @param {number} fValue
 * @param {number} df1
 * @param {number} df2
 * @returns {number} p in [0,1], or NaN for degenerate inputs.
 */
export function pUpperFromF(fValue, df1, df2) {
	if (Number.isNaN(fValue) || !Number.isFinite(df1) || !Number.isFinite(df2)) return NaN;
	if (df1 <= 0 || df2 <= 0 || fValue < 0) return NaN;
	if (fValue === Infinity) return 0;
	if (fValue === 0) return 1;
	const x = df2 / (df2 + df1 * fValue);
	return Math.min(1, Math.max(0, regularizedBeta(x, df2 / 2, df1 / 2)));
}
