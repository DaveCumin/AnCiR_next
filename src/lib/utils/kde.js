// @ts-nocheck
// Gaussian kernel density estimation (KDE).
//
// Pure, Svelte-free numerical core (mirrored in tools/ancir_runtime.py `kde`).
// Used by the Histogram plot to draw a smooth density curve over the count bars.
//
// Method: place a standard-normal kernel of width `h` (the bandwidth) on every
// data point and average them on an evenly spaced grid:
//
//     f_hat(x) = (1 / (n·h)) · Σ_i  φ( (x − v_i) / h )
//
// with φ(u) = exp(−u²/2) / √(2π) the standard-normal pdf. When `bandwidth` is
// null the bandwidth is chosen by Silverman's rule of thumb (the normal-reference
// rule), h = 1.06 · σ · n^(−1/5), where σ is the SAMPLE standard deviation
// (÷(n−1)). Reference: Silverman, B.W. (1986), "Density Estimation for
// Statistics and Data Analysis", eq. 3.28.

import { sampleStd } from './sampleStats.js';

const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);

/** Standard-normal pdf. */
function gaussianKernel(u) {
	return INV_SQRT_2PI * Math.exp(-0.5 * u * u);
}

/**
 * Silverman rule-of-thumb bandwidth: 1.06 · σ · n^(−1/5).
 * Returns NaN when the sample std is undefined (fewer than 2 values) or 0.
 * @param {number[]} cleaned pre-cleaned finite numeric array
 * @returns {number}
 */
export function silvermanBandwidth(cleaned) {
	const n = cleaned.length;
	if (n < 2) return NaN;
	const sigma = sampleStd(cleaned);
	if (!Number.isFinite(sigma) || sigma <= 0) return NaN;
	return 1.06 * sigma * Math.pow(n, -1 / 5);
}

/**
 * Gaussian KDE on an evenly spaced grid.
 *
 * @param {number[]} values raw data; null/NaN/±Infinity are ignored.
 * @param {{bandwidth?: number|null, gridSize?: number}} [opts]
 *   bandwidth — kernel width; when null/undefined, chosen by Silverman's rule.
 *   gridSize  — number of evaluation points (default 128, clamped to ≥2).
 * @returns {{x: number[], density: number[]}} grid points and density estimates.
 *   Returns empty arrays when there is nothing to estimate (no valid data, or an
 *   auto bandwidth cannot be formed because σ is 0 / n < 2).
 */
export function gaussianKDE(values, opts = {}) {
	const gridSize = Math.max(2, Math.floor(opts.gridSize ?? 128));
	const requested = opts.bandwidth;

	const cleaned = [];
	if (Array.isArray(values)) {
		for (const v of values) {
			// Skip null/undefined explicitly: Number(null) === 0 would leak a
			// spurious data point at the origin.
			if (v == null) continue;
			const num = typeof v === 'number' ? v : Number(v);
			if (Number.isFinite(num)) cleaned.push(num);
		}
	}
	const n = cleaned.length;
	if (n === 0) return { x: [], density: [] };

	// Resolve bandwidth.
	let h;
	if (requested != null && Number.isFinite(requested) && requested > 0) {
		h = requested;
	} else {
		h = silvermanBandwidth(cleaned);
	}
	if (!Number.isFinite(h) || h <= 0) return { x: [], density: [] };

	// Grid spans [min − 3h, max + 3h] so the tails of the kernels are captured.
	let lo = Infinity;
	let hi = -Infinity;
	for (const v of cleaned) {
		if (v < lo) lo = v;
		if (v > hi) hi = v;
	}
	lo -= 3 * h;
	hi += 3 * h;

	const x = new Array(gridSize);
	const density = new Array(gridSize);
	const span = hi - lo;
	const step = span / (gridSize - 1);
	const norm = 1 / (n * h);

	for (let j = 0; j < gridSize; j++) {
		const xj = lo + j * step;
		x[j] = xj;
		let sum = 0;
		for (let i = 0; i < n; i++) {
			sum += gaussianKernel((xj - cleaned[i]) / h);
		}
		density[j] = norm * sum;
	}

	return { x, density };
}
