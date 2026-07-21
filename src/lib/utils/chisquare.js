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
	for (let i = 0; i < k; i++) stat += ((O[i] - E[i]) ** 2) / E[i];
	const df = k - 1 - ddof;
	return { statistic: stat, pvalue: pUpperFromChiSq(stat, df), df, k };
}

/**
 * Build a contingency table (counts of co-occurring categories) from two equal-length arrays.
 * @returns {{rowLabels:string[], colLabels:string[], table:number[][]}}
 */
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
		if (r == null || c == null || r === '' || c === '') continue; // skip incomplete rows
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
	return { statistic: stat, pvalue: pUpperFromChiSq(stat, df), df, expected };
}
