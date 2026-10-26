// @ts-nocheck
// Pearson / Spearman correlation, with a two-sided p-value, and an all-pairs matrix.
//
// STATS-LIBRARY POLICY (see the project decision note): the numerically-hard part (the
// distribution tail for the p-value) goes through `pUpperFromF` (fdist.js: the F upper tail
// from the regularised incomplete beta on @stdlib's gammaln, pinned to scipy's f.sf), the
// same F tail the rest of the app uses. The COEFFICIENT
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
import { normalQuantile } from './qq.js';

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

/**
 * The pairwise-complete rows as NUMBERS. validPairs keeps a numeric string ("3": isNaN("3") is
 * false) as it is, and the sums below would then concatenate ("0" + "1" + "2"), and ties
 * would be judged by spelling ("2" vs "2.0"). A number column can hold strings when a session
 * was written that way (the AI draft path used to bake "1.5" as text: STAT-U4), so every value
 * is read as the number it spells here, once, for both coefficients.
 */
function numericPairs(x, y) {
	const { tt, yy } = validPairs(x, y);
	return { xs: tt.map(Number), ys: yy.map(Number) };
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
	const { xs, ys } = numericPairs(x, y);
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
	const { xs, ys } = numericPairs(x, y);
	const n = xs.length;
	if (n < 2) return { r: NaN, n, tiesX: false, tiesY: false };
	const { r } = pearson(rankAverage(xs), rankAverage(ys));
	return { r, n, tiesX: hasTies(xs), tiesY: hasTies(ys) };
}

/**
 * Two-sided p-value for a correlation coefficient, via the t statistic
 * t = r·sqrt((n-2)/(1-r²)), whose square is F(1, n-2). Standard for Pearson, and Spearman's
 * approximation above SPEARMAN_EXACT_MAX_N pairs or with ties (spearmanPValue).
 * @returns {number} p in [0,1]; 0 for |r|=1; NaN for n<3.
 */
export function correlationPValue(r, n) {
	if (!Number.isFinite(r) || n < 3) return NaN;
	if (Math.abs(r) >= 1) return 0;
	const t2 = (r * r * (n - 2)) / (1 - r * r);
	return pUpperFromF(t2, 1, n - 2);
}

/**
 * Spearman's p is exact for n up to this many pairs without ties (R cor.test's exact branch,
 * AS 89 n_small = 9); above it, or with ties, the t approximation (STAT-28).
 */
export const SPEARMAN_EXACT_MAX_N = 9;

// Exact null distribution of S = sum d^2 for each n <= SPEARMAN_EXACT_MAX_N, counted once over
// all n! rankings and kept: counts[s / 2] is the number of permutations with S = s (S is always
// even, since sum d = 0). n = 9 is 362880 permutations, about 10 ms the first time.
const spearmanSCounts = new Map();
function spearmanCounts(n) {
	let counts = spearmanSCounts.get(n);
	if (counts) return counts;
	const maxS = (n * (n * n - 1)) / 3;
	counts = new Float64Array(maxS / 2 + 1);
	const perm = Array.from({ length: n }, (_, i) => i);
	const used = new Array(n).fill(false);
	// Depth-first over the permutations, accumulating sum (i - p_i)^2 as positions fill.
	const walk = (pos, s) => {
		if (pos === n) {
			counts[s / 2]++;
			return;
		}
		for (let v = 0; v < n; v++) {
			if (used[v]) continue;
			used[v] = true;
			perm[pos] = v;
			walk(pos + 1, s + (pos - v) * (pos - v));
			used[v] = false;
		}
	};
	walk(0, 0);
	spearmanSCounts.set(n, counts);
	return counts;
}

/**
 * Exact two-sided p for Spearman's rho on n untied pairs, as R's cor.test computes it with
 * exact = TRUE (prho.c, algorithm AS 89: Best and Roberts 1975, Appl. Statist. 24:377-379,
 * whose exact branch R uses for n <= 9). With S = (n^3 - n)(1 - r) / 6, the lower tail is
 * P(S <= S_obs) and the upper P(S >= S_obs), the tail on the observed side is taken, and
 * p = min(1, 2 * tail).
 *
 * AS 89's Edgeworth series, which R uses for 10 <= n <= 1290, is NOT used: in the far tail it
 * goes negative and is clamped to p = 0 (R gives p = 0 for rho = 0.88 on n = 20, where the
 * t approximation gives 2.9e-7 and the permutation p is small but not 0), and a p of exactly 0
 * corrupts any downstream FDR step. The t
 * approximation (scipy.stats.spearmanr, cor.test(exact = FALSE)) is kept there.
 * @param {number} r
 * @param {number} n 2..SPEARMAN_EXACT_MAX_N
 */
export function spearmanExactPValue(r, n) {
	if (!Number.isFinite(r) || !(n >= 2 && n <= SPEARMAN_EXACT_MAX_N)) return NaN;
	const counts = spearmanCounts(n);
	const n3 = n * n * n - n;
	// R rounds S before looking it up; without ties S is an even whole number up to rounding.
	const q = Math.round((n3 * (1 - r)) / 6);
	let nfac = 1;
	for (let i = 2; i <= n; i++) nfac *= i;
	let tail = 0;
	if (q > n3 / 6) {
		for (let k = Math.ceil(q / 2); k < counts.length; k++) tail += counts[k];
	} else {
		for (let k = 0; k <= Math.floor(q / 2) && k < counts.length; k++) tail += counts[k];
	}
	return Math.min(1, (2 * tail) / nfac);
}

/**
 * Two-sided p for Spearman's rho (STAT-28): exact for 3 <= n <= SPEARMAN_EXACT_MAX_N without
 * ties (spearmanExactPValue), else the t approximation (correlationPValue).
 * @param {number} r
 * @param {number} n
 * @param {boolean} ties either column has a tie
 */
export function spearmanPValue(r, n, ties) {
	if (!ties && n >= 3 && n <= SPEARMAN_EXACT_MAX_N) return spearmanExactPValue(r, n);
	return correlationPValue(r, n);
}

/**
 * One correlation with its p-value.
 * @param {number[]} x
 * @param {number[]} y
 * @param {'pearson'|'spearman'} method
 * @returns {{r:number, pvalue:number, n:number, tiesX:boolean, tiesY:boolean}}
 */
export function correlate(x, y, method = 'pearson') {
	const res =
		method === 'spearman' ? spearman(x, y) : { ...pearson(x, y), tiesX: false, tiesY: false };
	return {
		r: res.r,
		pvalue:
			method === 'spearman'
				? spearmanPValue(res.r, res.n, res.tiesX || res.tiesY)
				: correlationPValue(res.r, res.n),
		n: res.n,
		tiesX: res.tiesX,
		tiesY: res.tiesY
	};
}

/**
 * Every UNIQUE pair among `columns` (upper triangle, diagonal excluded), in tidy long form.
 *
 * @param {number[][]} columns  one array per variable
 * @param {string[]|null} names variable names; falls back to the column index
 * @param {'pearson'|'spearman'} method
 * @returns {Array<{i:number, j:number, var_i:string, var_j:string, r:number, pvalue:number, n:number, tiesX:boolean, tiesY:boolean}>}
 */
/**
 * Confidence interval for a correlation coefficient, via the Fisher z
 * transform (Fisher 1921).
 *
 * r is bounded and its sampling distribution is skewed near +/-1, so an
 * interval built directly on r would run off the end of the scale. atanh(r) is
 * approximately normal with a variance that depends only on n, so the interval
 * is built there and mapped back with tanh — which is why the result is
 * asymmetric about r, and correctly so.
 *
 * For SPEARMAN the same transform is used with the Bonett & Wright (2000)
 * standard error, sqrt((1 + r^2/2)/(n-3)), which accounts for the extra
 * variability of a rank coefficient. Using the Pearson SE for Spearman gives an
 * interval that is too narrow.
 *
 * @param {number} r
 * @param {number} n number of complete pairs
 * @param {string} [method='pearson'] 'pearson' | 'spearman'
 * @param {number} [confidence=0.95]
 * @returns {[number, number]} [low, high]; [NaN, NaN] when n is too small
 */
export function correlationCI(r, n, method = 'pearson', confidence = 0.95) {
	if (!Number.isFinite(r) || !Number.isFinite(n) || n < 4) return [NaN, NaN];
	// |r| = 1 gives an infinite z; the interval collapses onto the point.
	if (Math.abs(r) >= 1) return [r, r];

	const z = Math.atanh(r);
	// Two-sided normal quantile. 1.959963985 at 95%; derived rather than hard-coded
	// so other confidence levels work.
	const zCrit = normalQuantile(1 - (1 - confidence) / 2);
	const se =
		method === 'spearman'
			? Math.sqrt((1 + (r * r) / 2) / (n - 3)) // Bonett & Wright
			: 1 / Math.sqrt(n - 3);
	return [Math.tanh(z - zCrit * se), Math.tanh(z + zCrit * se)];
}

// Standard-normal quantile (inverse CDF): the single shared Acklam
// implementation lives in utils/qq.js (imported at top); it used to be a
// module-private duplicate here.

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
				ciLow: correlationCI(c.r, c.n, method)[0],
				ciHigh: correlationCI(c.r, c.n, method)[1],
				tiesX: c.tiesX,
				tiesY: c.tiesY
			});
		}
	}
	return rows;
}
