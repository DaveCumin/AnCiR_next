// @ts-nocheck
// Logistic regression by iteratively-reweighted least squares (IRLS / Fisher scoring).
//
// Fits P(y=1) = logit⁻¹(β₀ + β₁x₁ + …). Reports per-coefficient estimate, standard error,
// Wald z, two-sided p, odds ratio and its 95% CI, plus the model log-likelihood and the
// likelihood-ratio test against the intercept-only null.
//
// STATS-LIBRARY POLICY: the Wald p-value goes through @stdlib (z² ~ χ²(1), via the shared
// pUpperFromChiSq — the same χ² CDF the rest of the app uses), so no bespoke normal-tail
// approximation is introduced. The IRLS loop and its small Gaussian solve/inverse are elementary
// and kept bespoke, pinned to statsmodels' Logit in the parity harness. Returns a `converged`
// flag rather than throwing on separation or a singular information matrix.
import { pUpperFromChiSq } from './chisquare.js';

const Z_975 = 1.959963984540054; // Φ⁻¹(0.975) for the 95% CI
const sigmoid = (x) => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));

/** Solve A·x = b in place-safe copies by Gaussian elimination with partial pivoting. */
function solve(A, b) {
	const n = b.length;
	const M = A.map((row, i) => [...row, b[i]]);
	for (let col = 0; col < n; col++) {
		let piv = col;
		for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
		if (Math.abs(M[piv][col]) < 1e-12) return null; // singular
		[M[col], M[piv]] = [M[piv], M[col]];
		for (let r = 0; r < n; r++) {
			if (r === col) continue;
			const f = M[r][col] / M[col][col];
			for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
		}
	}
	// Full elimination above leaves M diagonal, so xᵢ = M[i][n] / M[i][i].
	return M.map((row, i) => row[n] / M[i][i]);
}

/** Full inverse of a symmetric positive-definite matrix (solve against each unit column). */
function inverse(A) {
	const n = A.length;
	const inv = Array.from({ length: n }, () => new Array(n).fill(0));
	for (let col = 0; col < n; col++) {
		const e = new Array(n).fill(0);
		e[col] = 1;
		const x = solve(A, e);
		if (!x) return null;
		for (let row = 0; row < n; row++) inv[row][col] = x[row];
	}
	return inv;
}

/**
 * @param {number[]} y  binary outcome (0/1)
 * @param {number[][]} predictorCols  one array per predictor (all length y.length)
 * @param {string[]} names  predictor names (excluding the intercept)
 * @param {{maxIter?:number, tol?:number}} [opts]
 * @returns {{
 *   converged:boolean, iterations:number, n:number,
 *   coefficients:Array<{name:string, coef:number, se:number, z:number, pvalue:number, oddsRatio:number, ciLow:number, ciHigh:number}>,
 *   logLik:number, nullLogLik:number, lrChiSq:number, lrDf:number, lrPvalue:number, pseudoR2:number
 * }}
 */
export function logisticRegression(y, predictorCols, names, opts = {}) {
	const maxIter = opts.maxIter ?? 50;
	const tol = opts.tol ?? 1e-8;
	const p = predictorCols.length;

	// Assemble complete rows (drop any with a missing outcome or predictor).
	const rows = [];
	const ys = [];
	for (let i = 0; i < y.length; i++) {
		const yi = Number(y[i]);
		if (yi !== 0 && yi !== 1) continue;
		const xr = [1];
		let ok = true;
		for (let j = 0; j < p; j++) {
			const v = Number(predictorCols[j][i]);
			if (!Number.isFinite(v)) {
				ok = false;
				break;
			}
			xr.push(v);
		}
		if (!ok) continue;
		rows.push(xr);
		ys.push(yi);
	}
	const n = rows.length;
	const k = p + 1;
	const labels = ['(intercept)', ...names];
	if (n < k + 1) {
		return { converged: false, iterations: 0, n, coefficients: [], logLik: NaN, nullLogLik: NaN, lrChiSq: NaN, lrDf: p, lrPvalue: NaN, pseudoR2: NaN };
	}

	let beta = new Array(k).fill(0);
	let converged = false;
	let iter = 0;
	for (; iter < maxIter; iter++) {
		// XtWX and XtW(y-mu) accumulation (Newton step on the log-likelihood).
		const XtWX = Array.from({ length: k }, () => new Array(k).fill(0));
		const grad = new Array(k).fill(0);
		for (let i = 0; i < n; i++) {
			let eta = 0;
			for (let j = 0; j < k; j++) eta += rows[i][j] * beta[j];
			const mu = sigmoid(eta);
			const w = Math.max(mu * (1 - mu), 1e-10);
			const r = ys[i] - mu;
			for (let a = 0; a < k; a++) {
				grad[a] += rows[i][a] * r;
				for (let b = 0; b < k; b++) XtWX[a][b] += rows[i][a] * rows[i][b] * w;
			}
		}
		const step = solve(XtWX, grad);
		if (!step) break; // singular information matrix (e.g. perfect separation)
		let maxDelta = 0;
		for (let j = 0; j < k; j++) {
			beta[j] += step[j];
			maxDelta = Math.max(maxDelta, Math.abs(step[j]));
		}
		if (maxDelta < tol) {
			converged = true;
			iter++;
			break;
		}
	}

	// Covariance = (XtWX)⁻¹ at the solution.
	const XtWX = Array.from({ length: k }, () => new Array(k).fill(0));
	let logLik = 0;
	for (let i = 0; i < n; i++) {
		let eta = 0;
		for (let j = 0; j < k; j++) eta += rows[i][j] * beta[j];
		const mu = sigmoid(eta);
		const w = Math.max(mu * (1 - mu), 1e-10);
		logLik += ys[i] === 1 ? Math.log(Math.max(mu, 1e-300)) : Math.log(Math.max(1 - mu, 1e-300));
		for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) XtWX[a][b] += rows[i][a] * rows[i][b] * w;
	}
	const cov = inverse(XtWX);

	const coefficients = labels.map((name, j) => {
		const coef = beta[j];
		const se = cov && cov[j][j] >= 0 ? Math.sqrt(cov[j][j]) : NaN;
		const z = se ? coef / se : NaN;
		const pvalue = Number.isFinite(z) ? pUpperFromChiSq(z * z, 1) : NaN;
		return {
			name,
			coef,
			se,
			z,
			pvalue,
			oddsRatio: Math.exp(coef),
			ciLow: Number.isFinite(se) ? Math.exp(coef - Z_975 * se) : NaN,
			ciHigh: Number.isFinite(se) ? Math.exp(coef + Z_975 * se) : NaN
		};
	});

	// Null model (intercept only): closed form β₀ = logit(ȳ).
	const ybar = ys.reduce((s, v) => s + v, 0) / n;
	let nullLogLik = 0;
	for (const yi of ys) nullLogLik += yi === 1 ? Math.log(Math.max(ybar, 1e-300)) : Math.log(Math.max(1 - ybar, 1e-300));
	const lrChiSq = 2 * (logLik - nullLogLik);
	const lrPvalue = pUpperFromChiSq(lrChiSq, p);
	const pseudoR2 = nullLogLik !== 0 ? 1 - logLik / nullLogLik : NaN; // McFadden's

	return { converged, iterations: iter, n, coefficients, logLik, nullLogLik, lrChiSq, lrDf: p, lrPvalue, pseudoR2 };
}
