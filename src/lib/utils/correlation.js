// @ts-nocheck
// Pearson / Spearman correlation, with a two-sided p-value, and an all-pairs matrix.
//
// STATS-LIBRARY POLICY (see the project decision note): the numerically-hard part — the
// distribution tail for the p-value — is delegated to @stdlib via `pUpperFromF`
// (@stdlib/stats-base-dists-f-cdf), the same F-CDF the rest of the app uses. The COEFFICIENT
// and rank-averaging are kept bespoke: they are elementary, well-conditioned formulae, and
// AnCiR ships as a single inlined bundle where every added dependency is downloaded by every
// user. Their correctness is not taken on trust — the parity harness pins them to scipy's
// `pearsonr` / `spearmanr` (a reference implementation), which they match to machine precision.
// So: @stdlib for distributions/special functions; bespoke-but-reference-validated for
// elementary descriptive stats.
//
// Everything returns NaN for degenerate input rather than throwing — a 0 correlation is a real
// result and must never stand in for "couldn't compute".
import { pUpperFromF } from './fdist.js';
import { validPairs } from './validPairs.js';

/**
 * Average (fractional) ranks, 1-based. Ties share the mean of the ranks they span, which is
 * what makes Spearman-on-ranks correct in the presence of ties.
 * @param {number[]} arr
 * @returns {number[]} ranks in the ORIGINAL order
 */
export function rankAverage(arr) {
	const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
	const ranks = new Array(arr.length);
	let i = 0;
	while (i < idx.length) {
		let j = i;
		while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
		// positions i..j are tied → average rank ((i+1)+(j+1))/2
		const avg = (i + j + 2) / 2;
		for (let k = i; k <= j; k++) ranks[idx[k][1]] = avg;
		i = j + 1;
	}
	return ranks;
}

/** Are there any ties in this array? (Spearman's t-approx p degrades with ties.) */
function hasTies(arr) {
	return new Set(arr).size < arr.length;
}

/**
 * Pearson correlation on the pairwise-complete rows.
 * @returns {{r:number, n:number}} r is NaN if n<2 or either column has zero variance.
 */
export function pearson(x, y) {
	const { tt: xs, yy: ys } = validPairs(x, y);
	const n = xs.length;
	if (n < 2) return { r: NaN, n };
	const mx = xs.reduce((s, v) => s + v, 0) / n;
	const my = ys.reduce((s, v) => s + v, 0) / n;
	let sxy = 0;
	let sxx = 0;
	let syy = 0;
	for (let i = 0; i < n; i++) {
		const dx = xs[i] - mx;
		const dy = ys[i] - my;
		sxy += dx * dy;
		sxx += dx * dx;
		syy += dy * dy;
	}
	if (sxx === 0 || syy === 0) return { r: NaN, n };
	return { r: sxy / Math.sqrt(sxx * syy), n };
}

/**
 * Spearman rank correlation: Pearson on the average ranks of the pairwise-complete rows.
 * @returns {{r:number, n:number, tiesX:boolean, tiesY:boolean}}
 */
export function spearman(x, y) {
	const { tt: xs, yy: ys } = validPairs(x, y);
	const n = xs.length;
	if (n < 2) return { r: NaN, n, tiesX: false, tiesY: false };
	const { r } = pearson(rankAverage(xs), rankAverage(ys));
	return { r, n, tiesX: hasTies(xs), tiesY: hasTies(ys) };
}

/**
 * Two-sided p-value for a correlation coefficient, via the t statistic
 * t = r·sqrt((n-2)/(1-r²)), whose square is F(1, n-2). Standard for both Pearson and (as an
 * approximation, good for n≳10) Spearman.
 * @returns {number} p in [0,1]; 0 for |r|=1; NaN for n<3.
 */
export function correlationPValue(r, n) {
	if (!Number.isFinite(r) || n < 3) return NaN;
	if (Math.abs(r) >= 1) return 0;
	const t2 = (r * r * (n - 2)) / (1 - r * r);
	return pUpperFromF(t2, 1, n - 2);
}

/**
 * One correlation with its p-value.
 * @param {number[]} x
 * @param {number[]} y
 * @param {'pearson'|'spearman'} method
 * @returns {{r:number, pvalue:number, n:number, tiesX:boolean, tiesY:boolean}}
 */
export function correlate(x, y, method = 'pearson') {
	const res = method === 'spearman' ? spearman(x, y) : { ...pearson(x, y), tiesX: false, tiesY: false };
	return { r: res.r, pvalue: correlationPValue(res.r, res.n), n: res.n, tiesX: res.tiesX, tiesY: res.tiesY };
}

/**
 * Every UNIQUE pair among `columns` (upper triangle, diagonal excluded), in tidy long form.
 *
 * @param {number[][]} columns  one array per variable
 * @param {string[]|null} names variable names; falls back to the column index
 * @param {'pearson'|'spearman'} method
 * @returns {Array<{i:number, j:number, var_i:string, var_j:string, r:number, pvalue:number, n:number, tiesX:boolean, tiesY:boolean}>}
 */
export function correlationMatrix(columns, names, method = 'pearson') {
	const cols = columns ?? [];
	if (cols.length < 2) return [];
	const nameOf = (k) => (names && names[k] != null ? String(names[k]) : String(k));
	const rows = [];
	for (let i = 0; i < cols.length; i++) {
		for (let j = i + 1; j < cols.length; j++) {
			const c = correlate(cols[i], cols[j], method);
			rows.push({
				i,
				j,
				var_i: nameOf(i),
				var_j: nameOf(j),
				r: c.r,
				pvalue: c.pvalue,
				n: c.n,
				tiesX: c.tiesX,
				tiesY: c.tiesY
			});
		}
	}
	return rows;
}
