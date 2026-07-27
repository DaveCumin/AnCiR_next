// @ts-nocheck
// Chi-squared tests: goodness-of-fit and test of independence (contingency table).
//
// STATS-LIBRARY POLICY (see the project note): the distribution tail goes through @stdlib
// (@stdlib/stats-base-dists-chisquare-cdf, the same χ² CDF the periodogram uses). The statistic
// itself — Σ(O−E)²/E and the contingency-table expected counts — is elementary and kept bespoke,
// pinned to scipy (chisquare / chi2_contingency) in the parity harness.
//
// Returns NaN rather than throwing on degenerate input (empty table, zero total).
import cdf_chisq from '@stdlib/stats-base-dists-chisquare-cdf';

/** Upper-tail P(X > x) for X ~ χ²(df). */
export function pUpperFromChiSq(x, df) {
	if (!Number.isFinite(x) || !Number.isFinite(df) || df <= 0 || x < 0) return NaN;
	return 1 - cdf_chisq(x, df);
}

/**
 * Pearson goodness-of-fit: are the observed counts consistent with the expected counts?
 * @param {number[]} observed  category counts (each ≥ 0)
 * @param {number[]|null} expected  expected counts; null ⇒ uniform (total / k)
 * @param {number} [ddof]  extra parameters estimated from the data (df = k − 1 − ddof)
 * @returns {{statistic:number, pvalue:number, df:number, k:number}}
 */
export function chiSquareGoodnessOfFit(observed, expected = null, ddof = 0) {
	const O = (observed ?? []).map(Number).filter((v) => Number.isFinite(v));
	const k = O.length;
	if (k < 2) return { statistic: NaN, pvalue: NaN, df: NaN, k };
	const total = O.reduce((s, v) => s + v, 0);
	let E;
	if (expected == null) {
		E = O.map(() => total / k);
	} else {
		E = expected.map(Number);
		if (E.length !== k) return { statistic: NaN, pvalue: NaN, df: NaN, k };
		// scipy rescales expected to match the observed total when they differ.
		const eTot = E.reduce((s, v) => s + v, 0);
		if (eTot > 0 && Math.abs(eTot - total) > 1e-9) E = E.map((v) => (v * total) / eTot);
	}
	if (E.some((v) => v <= 0)) return { statistic: NaN, pvalue: NaN, df: NaN, k };
	let stat = 0;
	for (let i = 0; i < k; i++) stat += (O[i] - E[i]) ** 2 / E[i];
	const df = k - 1 - ddof;
	return { statistic: stat, pvalue: pUpperFromChiSq(stat, df), df, k };
}

/**
 * Build a contingency table (counts of co-occurring categories) from two equal-length arrays.
 * @returns {{rowLabels:string[], colLabels:string[], table:number[][]}}
 */
/**
 * True for a cell that carries no category: null/undefined, blank, or NaN in
 * either numeric or stringified form.
 */
export function isMissingCategory(v) {
	if (v == null || v === '') return true;
	if (typeof v === 'number' && Number.isNaN(v)) return true;
	return String(v) === 'NaN';
}

export function contingencyTable(rowVar, colVar) {
	const n = Math.min(rowVar?.length ?? 0, colVar?.length ?? 0);
	const rowLabels = [];
	const colLabels = [];
	const rowIdx = new Map();
	const colIdx = new Map();
	const cells = new Map(); // "r,c" -> count
	for (let i = 0; i < n; i++) {
		const r = rowVar[i];
		const c = colVar[i];
		// Skip incomplete rows. NaN counts as MISSING, not as a category called
		// "NaN": the data grid renders an empty/invalid cell as NaN, so admitting it
		// would silently add a phantom row AND column to the table, inflating df
		// (a 2x2 test reported df = 4) and changing the p-value. Categorical values
		// must not be coerced with Number() — Number('a') is NaN too.
		if (isMissingCategory(r) || isMissingCategory(c)) continue;
		const rk = String(r);
		const ck = String(c);
		if (!rowIdx.has(rk)) {
			rowIdx.set(rk, rowLabels.length);
			rowLabels.push(rk);
		}
		if (!colIdx.has(ck)) {
			colIdx.set(ck, colLabels.length);
			colLabels.push(ck);
		}
		const key = rowIdx.get(rk) + ',' + colIdx.get(ck);
		cells.set(key, (cells.get(key) ?? 0) + 1);
	}
	const table = rowLabels.map((_, r) => colLabels.map((__, c) => cells.get(r + ',' + c) ?? 0));
	return { rowLabels, colLabels, table };
}

/**
 * Pearson χ² test of independence on a contingency table.
 * @param {number[][]} table  r×c observed counts
 * @param {boolean} [correction]  Yates' continuity correction (only applied to 2×2, as in scipy)
 * @returns {{statistic:number, pvalue:number, df:number, expected:number[][]}}
 */
export function chiSquareIndependence(table, correction = true) {
	const rows = table?.length ?? 0;
	const cols = rows ? table[0].length : 0;
	if (rows < 2 || cols < 2) return { statistic: NaN, pvalue: NaN, df: NaN, expected: [] };
	const rowSums = table.map((row) => row.reduce((s, v) => s + v, 0));
	const colSums = table[0].map((_, c) => table.reduce((s, row) => s + row[c], 0));
	const total = rowSums.reduce((s, v) => s + v, 0);
	if (total <= 0) return { statistic: NaN, pvalue: NaN, df: NaN, expected: [] };

	const expected = rowSums.map((rs) => colSums.map((cs) => (rs * cs) / total));
	const useYates = correction && rows === 2 && cols === 2;
	let stat = 0;
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			const e = expected[r][c];
			if (e <= 0) continue;
			let diff = Math.abs(table[r][c] - e);
			if (useYates) diff = Math.max(0, diff - 0.5);
			stat += (diff * diff) / e;
		}
	}
	const df = (rows - 1) * (cols - 1);

	// Effect size. Reported from the UNCORRECTED statistic even when Yates is
	// applied: the correction is a device for making the p-value less liberal on a
	// 2x2 table, not an estimate of association strength, and shrinking the effect
	// size with it would understate the association. So recompute without it.
	let uncorrected = stat;
	if (useYates) {
		uncorrected = 0;
		for (let r = 0; r < rows; r++) {
			for (let c = 0; c < cols; c++) {
				const e = expected[r][c];
				if (e <= 0) continue;
				const d = table[r][c] - e;
				uncorrected += (d * d) / e;
			}
		}
	}
	// Cramer's V (Cramer 1946): chi2 scaled to [0, 1] by n and the smaller
	// dimension, so tables of different sizes are comparable. On a 2x2 the
	// min(r-1, c-1) term is 1, so V reduces exactly to the phi coefficient.
	const k = Math.min(rows - 1, cols - 1);
	const cramersV = total > 0 && k > 0 ? Math.sqrt(uncorrected / (total * k)) : NaN;
	// phi carries a SIGN on a 2x2 (which diagonal dominates); V never can, because
	// it is a square root. Only defined for 2x2.
	let phi = NaN;
	if (rows === 2 && cols === 2) {
		const [[a, b], [c2, d2]] = table;
		const denom = Math.sqrt((a + b) * (c2 + d2) * (a + c2) * (b + d2));
		phi = denom > 0 ? (a * d2 - b * c2) / denom : NaN;
	}

	return {
		statistic: stat,
		pvalue: pUpperFromChiSq(stat, df),
		df,
		expected,
		cramersV,
		phi,
		n: total
	};
}

/**
 * Cohen's w for a goodness-of-fit test: sqrt(chi2 / n).
 *
 * Cohen's (1988) conventional landmarks are 0.1 small, 0.3 medium, 0.5 large.
 * Unlike Cramer's V it is not bounded by 1 — with many categories and a strong
 * departure it can exceed 1 — so it is not a correlation and should not be read
 * as one.
 */
export function cohensW(statistic, n) {
	if (!Number.isFinite(statistic) || !Number.isFinite(n) || n <= 0) return NaN;
	return Math.sqrt(statistic / n);
}

/**
 * Conventional verbal label for a Cramer's V / phi magnitude, following Cohen
 * (1988) as adapted for contingency tables by Rea & Parker (1992).
 *
 * Deliberately coarse and clearly labelled as a convention: these cutoffs are a
 * rule of thumb, not a property of the data, and a "small" effect can matter
 * enormously depending on the question.
 */
export function effectSizeLabel(v) {
	const x = Math.abs(Number(v));
	if (!Number.isFinite(x)) return '';
	if (x < 0.1) return 'negligible';
	if (x < 0.2) return 'small';
	if (x < 0.4) return 'moderate';
	if (x < 0.6) return 'relatively strong';
	return 'strong';
}
