// @ts-check
import gammaln from '@stdlib/math-base-special-gammaln';

/**
 * Upper tail of the chi-square distribution, P(X > q) for X ~ chi2(df), computed directly
 * (regularised upper incomplete gamma Q(df/2, q/2): series below a + 1, Lentz continued
 * fraction above). `1 - cdf` loses everything below ~1e-16 and returns 0: a Qp of 470.9
 * on 23 df gave 0 where the tail is 3.9e-85 (SPEC-14).
 *
 * Lives in utils (not in Periodogram.svelte, where it was first written) so the periodogram
 * compute, which also runs in the worker, can use it for the per-period p-values.
 * Mirrored by scipy.stats.chi2.sf and R's pchisq(q, df, lower.tail = FALSE).
 *
 * @param {number} q
 * @param {number} df
 * @returns {number}
 */
export function chisqSf(q, df) {
	if (!(df > 0) || !Number.isFinite(q)) return NaN;
	if (q <= 0) return 1;
	const a = df / 2;
	const x = q / 2;
	const lnPre = a * Math.log(x) - x - gammaln(a);
	if (x < a + 1) {
		let sum = 1 / a;
		let term = sum;
		for (let n = 1; n < 1000; n++) {
			term *= x / (a + n);
			sum += term;
			if (Math.abs(term) < Math.abs(sum) * 1e-16) break;
		}
		return Math.min(1, Math.max(0, 1 - Math.exp(lnPre) * sum));
	}
	const tiny = 1e-300;
	let b = x + 1 - a;
	let c = 1 / tiny;
	let d = 1 / b;
	let h = d;
	for (let i = 1; i < 1000; i++) {
		const an = -i * (i - a);
		b += 2;
		d = an * d + b;
		if (Math.abs(d) < tiny) d = tiny;
		c = b + an / c;
		if (Math.abs(c) < tiny) c = tiny;
		d = 1 / d;
		const del = d * c;
		h *= del;
		if (Math.abs(del - 1) < 1e-16) break;
	}
	return Math.exp(lnPre) * h;
}
