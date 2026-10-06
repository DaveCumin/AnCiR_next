// @ts-nocheck
/**
 * Multiple-comparison p-value adjustment.
 *
 * One shared implementation for the whole app. Holm previously lived privately
 * inside GroupComparison (pairwise post-hoc only); it is here now so the FDR
 * node and the post-hoc path cannot drift apart.
 *
 * Every method returns adjusted p-values **in the caller's original order** and
 * enforces monotonicity, so a smaller raw p never yields a larger adjusted p.
 * All are capped at 1. Inputs that are missing, non-finite or outside [0, 1] are
 * not p-values: they come back NaN and do not count towards n (R p.adjust's NA
 * handling).
 *
 * References — pinned by parity fixtures against scipy / statsmodels:
 * - Holm, S. (1979) Scand. J. Statist. 6:65-70. Step-down, controls FWER.
 * - Benjamini, Y. & Hochberg, Y. (1995) JRSS-B 57:289-300. Controls FDR under
 *   independence or positive regression dependence (PRDS).
 * - Benjamini, Y. & Yekutieli, D. (2001) Ann. Statist. 29:1165-1188. Controls
 *   FDR under ARBITRARY dependence, at the cost of a sum(1/i) penalty.
 *
 * Choosing between BH and BY is a real decision, not a default to skip past:
 * circadian p-values across probes, tissues or animals are often dependent in
 * ways that are not obviously PRDS, and BH is only valid under PRDS.
 */

export const PADJUST_METHODS = [
	'none',
	'bonferroni',
	'holm',
	'benjamini-hochberg',
	'benjamini-yekutieli'
];

/**
 * The numeric value of `raw`, or NaN when it is missing or non-finite.
 * NOT a bare Number(): Number(null), Number('') and Number(false) are all 0,
 * which would silently enter a MISSING p-value as a maximally significant one.
 * Only real numbers and numeric strings count.
 */
function numericP(raw) {
	if (raw == null || typeof raw === 'boolean' || raw === '') return NaN;
	const p = Number(raw);
	return Number.isFinite(p) ? p : NaN;
}

/**
 * True for a finite number that cannot be a p-value because it lies outside
 * [0, 1]. pAdjust treats these as missing; callers use this to say so.
 */
export function isOutOfRangeP(raw) {
	const p = numericP(raw);
	return Number.isFinite(p) && (p < 0 || p > 1);
}

/**
 * Missing, non-finite and out-of-range values are carried through as NaN and
 * EXCLUDED from n, as R p.adjust does for NA, rather than silently counted as 1
 * or clamped into [0, 1]. A node that failed to converge should not tighten the
 * correction applied to the ones that did, and a -0.5 (a mis-wired column, a
 * test statistic) must not enter the family as p = 0.
 */
function partition(pValues) {
	const entries = [];
	const out = new Array(pValues.length).fill(NaN);
	pValues.forEach((raw, idx) => {
		const p = numericP(raw);
		if (p >= 0 && p <= 1) entries.push({ p, idx });
	});
	return { entries, out };
}

/**
 * Adjust a set of p-values for multiple comparisons.
 *
 * @param {number[]} pValues raw p-values (non-finite or out-of-range entries pass through as NaN)
 * @param {string} [method='benjamini-hochberg']
 * @returns {number[]} adjusted p-values, same length and order as the input
 */
export function pAdjust(pValues, method = 'benjamini-hochberg') {
	if (!Array.isArray(pValues) || pValues.length === 0) return [];
	const { entries, out } = partition(pValues);
	const n = entries.length;
	if (n === 0) return out;

	if (method === 'none') {
		for (const e of entries) out[e.idx] = e.p;
		return out;
	}

	if (method === 'bonferroni') {
		for (const e of entries) out[e.idx] = Math.min(1, e.p * n);
		return out;
	}

	if (method === 'holm') {
		// Step DOWN: sort ascending, multiply by (n - i), enforce a running max.
		const sorted = [...entries].sort((a, b) => a.p - b.p);
		let running = 0;
		for (let i = 0; i < n; i++) {
			running = Math.max(running, Math.min(1, sorted[i].p * (n - i)));
			out[sorted[i].idx] = running;
		}
		return out;
	}

	if (method === 'benjamini-hochberg' || method === 'benjamini-yekutieli') {
		// c(n) = 1 for BH; sum(1/i) for BY, the arbitrary-dependence penalty.
		let c = 1;
		if (method === 'benjamini-yekutieli') {
			c = 0;
			for (let i = 1; i <= n; i++) c += 1 / i;
		}
		// Step UP: sort descending, scale by n*c/rank, enforce a running min.
		const sorted = [...entries].sort((a, b) => b.p - a.p);
		let running = 1;
		for (let i = 0; i < n; i++) {
			const rank = n - i; // 1-based rank in ASCENDING order
			running = Math.min(running, Math.min(1, (sorted[i].p * n * c) / rank));
			out[sorted[i].idx] = running;
		}
		return out;
	}

	throw new Error(`pAdjust: unknown method "${method}"`);
}

/**
 * Convenience: adjusted p-values plus rejection flags at level alpha.
 *
 * @returns {{adjusted:number[], reject:boolean[], nSignificant:number, nTested:number}}
 */
export function pAdjustWithDecision(pValues, method = 'benjamini-hochberg', alpha = 0.05) {
	const adjusted = pAdjust(pValues, method);
	const reject = adjusted.map((p) => Number.isFinite(p) && p < alpha);
	return {
		adjusted,
		reject,
		nSignificant: reject.filter(Boolean).length,
		nTested: adjusted.filter(Number.isFinite).length
	};
}
