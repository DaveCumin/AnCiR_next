// @ts-nocheck
// Correlation matrix straight from the raw data columns — the self-contained form the
// correlation heatmap and pairs plots use (they take the columns directly, like Histogram,
// rather than depending on the Correlation node's long-form output).
//
// Reuses the pairwise `correlate` (utils/correlation.js), so the same Pearson/Spearman +
// p-value maths — scipy-pinned via parity — backs both the node and the plots.
import { correlate } from './correlation.js';

/**
 * @param {number[][]} columns  one array per variable (raw data)
 * @param {string[]|null} names variable names; falls back to the column index
 * @param {'pearson'|'spearman'} method
 * @returns {{labels: string[], r: number[][], p: number[][]}} square symmetric matrices;
 *          r has 1 on the diagonal, p has NaN there (a variable has no p-value against itself).
 */
export function correlationGrid(columns, names, method = 'pearson') {
	const cols = columns ?? [];
	const N = cols.length;
	if (N === 0) return { labels: [], r: [], p: [] };

	const labels = cols.map((_, k) => (names && names[k] != null ? String(names[k]) : String(k)));
	const r = Array.from({ length: N }, () => new Array(N).fill(NaN));
	const p = Array.from({ length: N }, () => new Array(N).fill(NaN));
	for (let i = 0; i < N; i++) {
		r[i][i] = 1; // a variable correlates perfectly with itself; p stays NaN (undefined)
		for (let j = i + 1; j < N; j++) {
			const c = correlate(cols[i], cols[j], method);
			r[i][j] = r[j][i] = c.r;
			p[i][j] = p[j][i] = c.pvalue;
		}
	}
	return { labels, r, p };
}
