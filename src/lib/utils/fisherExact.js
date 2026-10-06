// @ts-nocheck
// Fisher's exact test for a 2x2 contingency table.
//
// WHY IT EXISTS ALONGSIDE CHI-SQUARED: the chi-squared test of independence relies
// on a large-sample approximation that degrades when expected cell counts are
// small — the conventional threshold is an expected count below 5. The
// ChiSquared node already WARNS about exactly this and tells you to use Fisher's
// exact; this is the test it was pointing at. Fisher's is exact at any count, so
// it is the right choice for small samples, and it agrees with chi-squared as
// counts grow.
//
// STATS-LIBRARY POLICY (D13): the special function (log-gamma, used for the
// hypergeometric probabilities) comes from an @stdlib LEAF package. The
// enumeration itself is elementary and kept bespoke, pinned to
// scipy.stats.fisher_exact in the parity harness.
//
// CONDITIONING, stated plainly because it is what the p-value means: the test
// conditions on BOTH margins being fixed. Under the null of independence the
// count in cell a then follows a hypergeometric distribution, and the p-value is
// the total probability of the tables at least as extreme as the one observed.
//
// Returns NaN rather than throwing on degenerate input (negative, non-integer,
// or all-zero tables).
import gammaln from '@stdlib/math-base-special-gammaln';
import { isMissingCategory } from './chisquare.js';

/** log(n!) via the log-gamma leaf. */
function logFactorial(n) {
	return gammaln(n + 1);
}

/**
 * log P(a) for the central hypergeometric distribution with the given margins.
 * Working in logs keeps moderately large tables (n in the thousands) from
 * overflowing, which a factorial-ratio implementation does almost immediately.
 */
function logHypergeometricPmf(a, rowA, rowB, colA, n) {
	return (
		logFactorial(rowA) +
		logFactorial(rowB) +
		logFactorial(colA) +
		logFactorial(n - colA) -
		logFactorial(n) -
		logFactorial(a) -
		logFactorial(rowA - a) -
		logFactorial(colA - a) -
		logFactorial(n - rowA - colA + a)
	);
}

const EMPTY = Object.freeze({
	pvalue: NaN,
	oddsRatio: NaN,
	alternative: 'two-sided',
	valid: false,
	reason: 'not a usable 2x2 table'
});

/**
 * Fisher's exact test for a 2x2 table.
 *
 *     table = [[a, b],
 *              [c, d]]
 *
 * @param {number[][]} table 2x2 array of non-negative integer counts
 * @param {string} [alternative='two-sided'] 'two-sided' | 'less' | 'greater'
 * @returns {{pvalue:number, oddsRatio:number, alternative:string, valid:boolean, reason:string}}
 *   `oddsRatio` is the SAMPLE odds ratio ad/bc, which is what
 *   scipy.stats.fisher_exact returns as its first element. It is deliberately not
 *   the conditional maximum-likelihood estimate (scipy exposes that separately via
 *   `odds_ratio`); the two differ on small tables, so the label matters.
 */
export function fisherExact(table, alternative = 'two-sided') {
	if (!Array.isArray(table) || table.length !== 2) return { ...EMPTY, alternative };
	if (!Array.isArray(table[0]) || !Array.isArray(table[1])) return { ...EMPTY, alternative };
	if (table[0].length !== 2 || table[1].length !== 2) return { ...EMPTY, alternative };
	if (!['two-sided', 'less', 'greater'].includes(alternative)) {
		return { ...EMPTY, alternative, reason: `unknown alternative "${alternative}"` };
	}

	const [[a, b], [c, d]] = table.map((row) => row.map(Number));
	const cells = [a, b, c, d];
	if (cells.some((v) => !Number.isFinite(v) || v < 0)) {
		return { ...EMPTY, alternative, reason: 'counts must be finite and non-negative' };
	}
	// Non-integer counts have no exact distribution; refuse rather than round.
	if (cells.some((v) => !Number.isInteger(v))) {
		return { ...EMPTY, alternative, reason: 'counts must be whole numbers' };
	}

	const rowA = a + b;
	const rowB = c + d;
	const colA = a + c;
	const n = rowA + rowB;
	if (n === 0) return { ...EMPTY, alternative, reason: 'table is empty' };

	// Sample odds ratio. A zero in b or c makes it infinite, which is meaningful
	// (perfect separation) rather than an error; 0/0 is genuinely undefined.
	const oddsRatio = b * c === 0 ? (a * d === 0 ? NaN : Infinity) : (a * d) / (b * c);

	// A margin of zero leaves only one possible table, so nothing can be extreme.
	if (rowA === 0 || rowB === 0 || colA === 0 || colA === n) {
		return {
			pvalue: 1,
			oddsRatio,
			conditionalOddsRatio: NaN,
			oddsRatioCI: [NaN, NaN],
			alternative,
			valid: true,
			reason: ''
		};
	}

	// Support of a given the fixed margins.
	const lo = Math.max(0, colA - rowB);
	const hi = Math.min(rowA, colA);

	const logProbs = [];
	for (let k = lo; k <= hi; k++) logProbs.push(logHypergeometricPmf(k, rowA, rowB, colA, n));

	// Normalise in log space before exponentiating: the individual terms can
	// underflow to 0 for large n, and the support must still sum to 1.
	const maxLog = Math.max(...logProbs);
	const probs = logProbs.map((lp) => Math.exp(lp - maxLog));
	const total = probs.reduce((s, p) => s + p, 0);
	const norm = probs.map((p) => p / total);

	const idx = a - lo;
	let pvalue;
	if (alternative === 'less') {
		// P(A <= a)
		pvalue = norm.slice(0, idx + 1).reduce((s, p) => s + p, 0);
	} else if (alternative === 'greater') {
		// P(A >= a)
		pvalue = norm.slice(idx).reduce((s, p) => s + p, 0);
	} else {
		// Two-sided: total probability of every table no more likely than the
		// observed one. This is scipy's convention, and it is NOT the same as
		// doubling the smaller tail — the distribution is asymmetric, so doubling
		// can exceed 1 and disagrees with scipy on skewed margins.
		const observed = norm[idx];
		// Relative tolerance guards against a table that should tie with the
		// observed one being excluded by floating-point noise.
		const tol = 1 + 1e-7;
		pvalue = norm.reduce((s, p) => (p <= observed * tol ? s + p : s), 0);
	}

	return {
		pvalue: Math.min(1, Math.max(0, pvalue)),
		oddsRatio,
		// Also report the CONDITIONAL MLE and its interval. These are what R's
		// fisher.test prints, and they are the pair that belongs with this test:
		// the estimate conditions on the margins exactly as the p-value does, and
		// the interval is obtained by inverting the same test. The sample odds
		// ratio above is kept because it is the familiar ad/bc and is what
		// scipy.stats.fisher_exact returns, but the two DIFFER on small tables
		// (26.83 vs 22.93 on [[7,3],[2,23]]) and users comparing against R need to
		// see which is which.
		conditionalOddsRatio: conditionalOddsRatio(table),
		// One-sided for a one-sided test ([0, upper] or [lower, Infinity]), as R fisher.test.
		oddsRatioCI: oddsRatioCI(table, 0.95, alternative),
		alternative,
		valid: true,
		reason: ''
	};
}

/**
 * Log of the unnormalised noncentral-hypergeometric weight for cell count k:
 *   w_k = C(rowA, k) * C(rowB, colA - k)
 * The odds ratio psi then enters as w_k * psi^k.
 */
function logWeight(k, rowA, rowB, colA) {
	return (
		logFactorial(rowA) -
		logFactorial(k) -
		logFactorial(rowA - k) +
		logFactorial(rowB) -
		logFactorial(colA - k) -
		logFactorial(rowB - colA + k)
	);
}

/** Support of cell a given fixed margins. */
function support(rowA, rowB, colA) {
	return { lo: Math.max(0, colA - rowB), hi: Math.min(rowA, colA) };
}

/**
 * P(X = k) for every k in the support, at odds ratio psi. Computed in log space
 * and normalised there, so large tables do not underflow to all-zero.
 */
function ncHyperProbs(psi, rowA, rowB, colA) {
	const { lo, hi } = support(rowA, rowB, colA);
	const logPsi = Math.log(psi);
	const logs = [];
	for (let k = lo; k <= hi; k++) logs.push(logWeight(k, rowA, rowB, colA) + k * logPsi);
	const max = Math.max(...logs);
	const raw = logs.map((l) => Math.exp(l - max));
	const total = raw.reduce((s, v) => s + v, 0);
	return { lo, hi, probs: raw.map((v) => v / total) };
}

/** E[X] at odds ratio psi. Strictly increasing in psi, which is what makes the solve safe. */
function ncHyperMean(psi, rowA, rowB, colA) {
	const { lo, probs } = ncHyperProbs(psi, rowA, rowB, colA);
	let m = 0;
	for (let i = 0; i < probs.length; i++) m += (lo + i) * probs[i];
	return m;
}

/**
 * CONDITIONAL maximum-likelihood estimate of the odds ratio.
 *
 * This is NOT the sample odds ratio ad/bc. It is the value of psi under which
 * the observed cell count is the expected one, conditional on both margins —
 * the same conditioning the test itself uses, which is why it is the estimate
 * R's fisher.test reports and the one a confidence interval can be inverted
 * from. On [[7,3],[2,23]] the sample OR is 26.83 while the cMLE is 22.93.
 *
 * Solved by bisection on log(psi): E[X; psi] is strictly increasing, so the root
 * is unique. Returns 0 or Infinity at the ends of the support, where the
 * likelihood is maximised only in the limit.
 */
export function conditionalOddsRatio(table) {
	if (!Array.isArray(table) || table.length !== 2) return NaN;
	const [[a, b], [c, d]] = table.map((row) => row.map(Number));
	const rowA = a + b;
	const rowB = c + d;
	const colA = a + c;
	const { lo, hi } = support(rowA, rowB, colA);
	if (!(hi > lo)) return NaN; // degenerate margins: nothing to estimate
	if (a <= lo) return 0;
	if (a >= hi) return Infinity;

	let loLog = -50;
	let hiLog = 50;
	for (let i = 0; i < 200; i++) {
		const mid = (loLog + hiLog) / 2;
		if (ncHyperMean(Math.exp(mid), rowA, rowB, colA) < a) loLog = mid;
		else hiLog = mid;
	}
	return Math.exp((loLog + hiLog) / 2);
}

/** P(X >= a) and P(X <= a) at odds ratio psi. */
function tailProbs(psi, a, rowA, rowB, colA) {
	const { lo, probs } = ncHyperProbs(psi, rowA, rowB, colA);
	let upper = 0;
	let lower = 0;
	for (let i = 0; i < probs.length; i++) {
		const k = lo + i;
		if (k >= a) upper += probs[i];
		if (k <= a) lower += probs[i];
	}
	return { upper, lower };
}

/**
 * Conditional confidence interval for the odds ratio, obtained by INVERTING the
 * exact test — the same construction R's fisher.test uses, so the numbers line
 * up with it. The bounds are the odds ratios at which the observed table sits
 * exactly at the alpha/2 tail.
 *
 * A one-sided `alternative` gives the one-sided interval R's fisher.test reports:
 * 'less' is [0, upper] and 'greater' is [lower, Infinity], with the single bound
 * at the full 1 - confidence tail rather than half of it.
 *
 * A zero cell pushes one bound to 0 or Infinity, which is correct rather than a
 * failure: the data are consistent with an arbitrarily extreme odds ratio on
 * that side.
 *
 * @param {number[][]} table
 * @param {number} [confidence=0.95]
 * @param {string} [alternative='two-sided'] 'two-sided' | 'less' | 'greater'
 * @returns {[number, number]} [lower, upper]
 */
export function oddsRatioCI(table, confidence = 0.95, alternative = 'two-sided') {
	if (!Array.isArray(table) || table.length !== 2) return [NaN, NaN];
	const [[a, b], [c, d]] = table.map((row) => row.map(Number));
	const rowA = a + b;
	const rowB = c + d;
	const colA = a + c;
	const { lo, hi } = support(rowA, rowB, colA);
	if (!(hi > lo)) return [NaN, NaN];
	const oneSided = alternative === 'less' || alternative === 'greater';
	const alpha = oneSided ? 1 - confidence : (1 - confidence) / 2;

	// Lower bound: the psi at which P(X >= a) = alpha. Increasing in psi.
	let lower = 0;
	if (a > lo && alternative !== 'less') {
		let l = -50;
		let h = 50;
		for (let i = 0; i < 200; i++) {
			const mid = (l + h) / 2;
			if (tailProbs(Math.exp(mid), a, rowA, rowB, colA).upper < alpha) l = mid;
			else h = mid;
		}
		lower = Math.exp((l + h) / 2);
	}

	// Upper bound: the psi at which P(X <= a) = alpha. Decreasing in psi.
	let upper = Infinity;
	if (a < hi && alternative !== 'greater') {
		let l = -50;
		let h = 50;
		for (let i = 0; i < 200; i++) {
			const mid = (l + h) / 2;
			if (tailProbs(Math.exp(mid), a, rowA, rowB, colA).lower > alpha) l = mid;
			else h = mid;
		}
		upper = Math.exp((l + h) / 2);
	}
	return [lower, upper];
}

/**
 * Build a 2x2 table from two paired categorical columns, then run Fisher's exact.
 *
 * Rows are the two levels of `rowVar`, columns the two levels of `colVar`, both
 * in first-seen order so the table matches the order the labels appear in the
 * data. Pairs where either value is missing are dropped (a row with only one of
 * the two variables recorded carries no information about their association).
 *
 * @returns {{pvalue, oddsRatio, alternative, valid, reason, table, rowLabels, colLabels, n}}
 */
export function fisherExactFromColumns(rowVar, colVar, alternative = 'two-sided') {
	const fail = (reason) => ({
		...EMPTY,
		alternative,
		reason,
		table: [],
		rowLabels: [],
		colLabels: [],
		n: 0
	});
	if (!Array.isArray(rowVar) || !Array.isArray(colVar)) return fail('need two columns');
	const len = Math.min(rowVar.length, colVar.length);
	if (len === 0) return fail('no data');

	const rowLabels = [];
	const colLabels = [];
	const counts = new Map();
	let n = 0;
	for (let i = 0; i < len; i++) {
		const r = rowVar[i];
		const c = colVar[i];
		// Same missing-value rule as contingencyTable: NaN is missing data, not a
		// category. Admitting it would make a 2x2 table 3x3 and this test refuse.
		if (isMissingCategory(r) || isMissingCategory(c)) continue;
		const rk = String(r);
		const ck = String(c);
		if (!rowLabels.includes(rk)) rowLabels.push(rk);
		if (!colLabels.includes(ck)) colLabels.push(ck);
		const key = rk + '\u0000' + ck;
		counts.set(key, (counts.get(key) ?? 0) + 1);
		n++;
	}

	if (rowLabels.length !== 2 || colLabels.length !== 2) {
		return {
			...fail(
				`Fisher's exact test needs exactly 2 categories in each variable (found ${rowLabels.length} and ${colLabels.length}).`
			),
			rowLabels,
			colLabels,
			n
		};
	}

	const table = rowLabels.map((r) => colLabels.map((c) => counts.get(r + '\u0000' + c) ?? 0));
	const res = fisherExact(table, alternative);
	return { ...res, table, rowLabels, colLabels, n };
}
