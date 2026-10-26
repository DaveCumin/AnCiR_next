// @ts-check
// The exact null distribution of the Mann-Whitney U statistic (STAT-28), for small samples
// without ties, with the same switch scipy.stats.mannwhitneyu(method='auto') uses.
//
// Under H0 with no ties every assignment of the n1 + n2 ranks to the two samples is equally
// likely, and the number of assignments with U = u is the number of partitions of u into at
// most m parts, each at most n (m = min(n1, n2), n = max). Mann and Whitney (1947, Ann. Math.
// Statist. 18:50-60) give the recurrence; its generating function is the Gaussian binomial
// coefficient
//
//     [m + n choose m]_q = prod_{i=1..m} (1 - q^(n + i)) / (1 - q^i)
//
// (Andrews 1976, The Theory of Partitions, ch. 3), so the counts for U = 0..K come from m
// passes over a K + 1 array: multiply by (1 - q^(n + i)), then divide by (1 - q^i), which is a
// running sum with stride i. O(m K) work. Only U <= K = min(U1, U2) is ever needed, and the
// low coefficients involve no subtraction until k > n, so the small tail probabilities that
// matter are sums of positive terms (exact integers below 2^53).
//
// Mirrored in tools/ancir_runtime.py (_mw_exact_p) and tools/ancir_runtime.R (.mw_exact_p);
// pinned to scipy's exact p in mannWhitneyExact.test.js and the parity fixtures.

/** scipy's 'auto' rule: exact when either sample has at most this many values. */
export const MW_EXACT_MAX_N = 8;

/**
 * Whether the exact p applies: no ties in the pooled sample, and at least one sample of at most
 * MW_EXACT_MAX_N values (scipy.stats.mannwhitneyu method='auto', _mwu_choose_method). With
 * ties the exact distribution above does not hold, and the tie-corrected normal approximation
 * is used, as scipy does.
 * @param {number} n1
 * @param {number} n2
 * @param {boolean} hasTies
 */
export function mannWhitneyUsesExact(n1, n2, hasTies) {
	if (!(n1 >= 1 && n2 >= 1)) return false;
	if (n1 > MW_EXACT_MAX_N && n2 > MW_EXACT_MAX_N) return false;
	return !hasTies;
}

/**
 * Two-sided exact p for the Mann-Whitney U: 2 P(U <= min(U1, U2)), at most 1. Equal to
 * scipy's 2 * sf(max(U1, U2)) by the symmetry of the null distribution. NaN for a U that is
 * not a whole number in [0, n1 n2] (ties give half-integers; they never reach here).
 * @param {number} u U1 or U2 (either: the smaller is used)
 * @param {number} n1
 * @param {number} n2
 * @returns {number}
 */
export function mannWhitneyExactP(u, n1, n2) {
	if (!(n1 >= 1 && n2 >= 1) || !Number.isInteger(n1) || !Number.isInteger(n2)) return NaN;
	const mn = n1 * n2;
	if (!(u >= 0 && u <= mn)) return NaN;
	const k = Math.round(Math.min(u, mn - u));
	if (Math.abs(Math.min(u, mn - u) - k) > 1e-7) return NaN;
	const m = Math.min(n1, n2);
	const n = Math.max(n1, n2);
	const c = new Float64Array(k + 1);
	c[0] = 1;
	for (let i = 1; i <= m; i++) {
		const shift = n + i;
		for (let j = k; j >= shift; j--) c[j] -= c[j - shift];
		for (let j = i; j <= k; j++) c[j] += c[j - i];
	}
	let cdf = 0;
	for (let j = 0; j <= k; j++) cdf += c[j];
	// Total number of assignments, C(m + n, m), as a running product (exact while < 2^53).
	let total = 1;
	for (let i = 1; i <= m; i++) total = (total * (n + i)) / i;
	return Math.min(1, (2 * cdf) / total);
}
