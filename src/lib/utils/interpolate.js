// Pure 1-D interpolation helpers used by the Interpolate table-process.
//
// All functions operate on KNOWN sample points (finite x AND y), which the
// caller must pass sorted ascending by x. Queries outside the known range are
// clamped to the nearest endpoint value (no wild extrapolation) — sensible for
// gap-filling and resampling of time-series.

/** Is v a usable finite number? */
export function isFiniteNum(v) {
	return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Extract the finite (x, y) pairs from parallel arrays, sorted ascending by x
 * and de-duplicated on x (last one wins). These are the "known" points to
 * interpolate between.
 * @returns {{ xs: number[], ys: number[] }}
 */
export function knownPoints(xData, yData) {
	const pairs = [];
	const n = Math.min(xData?.length ?? 0, yData?.length ?? 0);
	for (let i = 0; i < n; i++) {
		const x = Number(xData[i]);
		const y = Number(yData[i]);
		if (isFiniteNum(x) && isFiniteNum(y)) pairs.push([x, y]);
	}
	pairs.sort((a, b) => a[0] - b[0]);
	const xs = [];
	const ys = [];
	for (const [x, y] of pairs) {
		if (xs.length && xs[xs.length - 1] === x) {
			ys[ys.length - 1] = y; // duplicate x → keep the later value
		} else {
			xs.push(x);
			ys.push(y);
		}
	}
	return { xs, ys };
}

/** Largest index i with xs[i] <= q (xs ascending, length >= 1). Clamped to [0, n-1). */
function bracket(xs, q) {
	let lo = 0;
	let hi = xs.length - 1;
	if (q <= xs[0]) return 0;
	if (q >= xs[hi]) return hi - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (xs[mid] <= q) lo = mid;
		else hi = mid;
	}
	return lo;
}

/**
 * Build a reusable interpolator `(q) => value` over the known points using the
 * chosen method. Precomputes spline second-derivatives once so evaluating many
 * query points is cheap.
 * @param {number[]} xs sorted ascending
 * @param {number[]} ys
 * @param {'linear'|'nearest'|'spline'} method
 */
export function makeInterpolator(xs, ys, method = 'linear') {
	const n = xs.length;
	if (n === 0) return () => NaN;
	if (n === 1) return () => ys[0];

	if (method === 'nearest') {
		return (q) => {
			if (q <= xs[0]) return ys[0];
			if (q >= xs[n - 1]) return ys[n - 1];
			const i = bracket(xs, q);
			return q - xs[i] <= xs[i + 1] - q ? ys[i] : ys[i + 1];
		};
	}

	if (method === 'spline') {
		// Natural cubic spline second derivatives (Numerical Recipes tridiagonal).
		const y2 = new Array(n).fill(0);
		const u = new Array(n).fill(0);
		for (let i = 1; i < n - 1; i++) {
			const sig = (xs[i] - xs[i - 1]) / (xs[i + 1] - xs[i - 1]);
			const p = sig * y2[i - 1] + 2;
			y2[i] = (sig - 1) / p;
			let ui =
				(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) -
				(ys[i] - ys[i - 1]) / (xs[i] - xs[i - 1]);
			u[i] = (6 * ui) / (xs[i + 1] - xs[i - 1]);
			u[i] = (u[i] - sig * u[i - 1]) / p;
		}
		for (let k = n - 2; k >= 0; k--) y2[k] = y2[k] * y2[k + 1] + u[k];
		return (q) => {
			if (q <= xs[0]) return ys[0];
			if (q >= xs[n - 1]) return ys[n - 1];
			const klo = bracket(xs, q);
			const khi = klo + 1;
			const h = xs[khi] - xs[klo];
			const a = (xs[khi] - q) / h;
			const b = (q - xs[klo]) / h;
			return (
				a * ys[klo] +
				b * ys[khi] +
				(((a * a * a - a) * y2[klo] + (b * b * b - b) * y2[khi]) * (h * h)) / 6
			);
		};
	}

	// default: piecewise linear
	return (q) => {
		if (q <= xs[0]) return ys[0];
		if (q >= xs[n - 1]) return ys[n - 1];
		const i = bracket(xs, q);
		const t = (q - xs[i]) / (xs[i + 1] - xs[i]);
		return ys[i] + t * (ys[i + 1] - ys[i]);
	};
}

/**
 * Interpolate y at each `queryXs` from the known (finite) points of
 * (xData, yData). Returns an array the same length as queryXs. If there are no
 * finite points, returns all-NaN.
 * @param {'linear'|'nearest'|'spline'} method
 */
export function interpolate(xData, yData, queryXs, method = 'linear') {
	const { xs, ys } = knownPoints(xData, yData);
	const f = makeInterpolator(xs, ys, method);
	return (queryXs ?? []).map((q) => f(Number(q)));
}

/**
 * Build an evenly-spaced grid from `start` to `end` (inclusive) with the given
 * `step`. Guards against non-positive step and runaway sizes.
 * @returns {number[]}
 */
export function makeGrid(start, end, step, maxPoints = 2_000_000) {
	if (!isFiniteNum(start) || !isFiniteNum(end) || !isFiniteNum(step) || step <= 0 || end < start) {
		return [];
	}
	const count = Math.floor((end - start) / step + 1e-9) + 1;
	if (count > maxPoints) return [];
	const grid = new Array(count);
	for (let i = 0; i < count; i++) grid[i] = start + i * step;
	return grid;
}
