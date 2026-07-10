// F-distribution helpers. Isolated so both the Rayleigh analysis node and the
// Circular phase plot share one @stdlib-backed implementation (circular.js
// itself stays dependency-free and takes this as a `pFromF` callback).
import cdf_f from '@stdlib/stats-base-dists-f-cdf';

/**
 * Upper-tail probability P(X > fValue) for X ~ F(df1, df2).
 * @param {number} fValue
 * @param {number} df1
 * @param {number} df2
 * @returns {number} p in [0,1], or NaN for degenerate inputs.
 */
export function pUpperFromF(fValue, df1, df2) {
	if (!Number.isFinite(fValue) || !Number.isFinite(df1) || !Number.isFinite(df2)) return NaN;
	if (df1 <= 0 || df2 <= 0 || fValue < 0) return NaN;
	return 1 - cdf_f(fValue, df1, df2);
}
