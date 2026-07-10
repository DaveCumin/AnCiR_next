/**
 * Mean ± SEM grouped statistics.
 *
 * Pure numeric core for the Mean ± SEM overlay plot. Groups paired (x, y)
 * observations by their x value and, for each group, computes the arithmetic
 * mean of the y values and the standard error of the mean (SEM).
 *
 * SEM uses the SAMPLE standard deviation (Bessel's correction, divisor n - 1):
 *   sd  = sqrt( Σ (yᵢ - ȳ)² / (n - 1) )
 *   sem = sd / sqrt(n)
 * For a group with a single observation (n = 1) the SEM is 0 (undefined
 * spread; reported as 0 so an error bar simply collapses to the point).
 *
 * Pairs are ignored when the x key is null/undefined/NaN or the y value is
 * null/undefined/NaN, so partial columns behave sensibly.
 *
 * @module meanSem
 */

/**
 * True for a usable group key: a non-null value that, if numeric, is finite.
 * String categories are always valid keys; NaN/Infinity numbers are not.
 * @param {*} v
 * @returns {boolean}
 */
function isValidKey(v) {
	if (v == null) return false;
	if (typeof v === 'number') return Number.isFinite(v);
	return true;
}

/**
 * True for a usable numeric observation.
 * @param {*} v
 * @returns {boolean}
 */
function isValidValue(v) {
	return v != null && typeof v === 'number' && !Number.isNaN(v);
}

/**
 * Numeric-aware ascending comparator matching the Boxplot category sort:
 * compares as numbers when both parse as numbers, otherwise lexicographically.
 * @param {*} a
 * @param {*} b
 * @returns {number}
 */
export function compareGroupKeys(a, b) {
	const sa = String(a);
	const sb = String(b);
	const na = Number(sa);
	const nb = Number(sb);
	if (sa !== '' && sb !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
	return sa.localeCompare(sb);
}

/**
 * Group paired (x, y) observations by x and compute mean ± SEM per group.
 *
 * @param {Array<number|string>} xs - Group labels / x positions.
 * @param {Array<number>} ys - Numeric observations, aligned with `xs`.
 * @returns {Array<{ x: number|string, mean: number, sem: number, sd: number, n: number }>}
 *   One entry per distinct valid x, sorted ascending (numeric-aware). Empty
 *   when there is no valid pair.
 */
export function meanSemByGroup(xs, ys) {
	const xArr = Array.isArray(xs) ? xs : [];
	const yArr = Array.isArray(ys) ? ys : [];
	const len = Math.min(xArr.length, yArr.length);

	// Preserve the representative (original-typed) x value per group while
	// keying the map by a stable string so 3 and "3" collapse together the same
	// way the categorical axis renders them.
	const groups = new Map();
	for (let i = 0; i < len; i++) {
		const xv = xArr[i];
		const yv = yArr[i];
		if (!isValidKey(xv) || !isValidValue(yv)) continue;
		const key = String(xv);
		let g = groups.get(key);
		if (!g) {
			g = { x: xv, values: [] };
			groups.set(key, g);
		}
		g.values.push(yv);
	}

	const out = [];
	for (const g of groups.values()) {
		const vals = g.values;
		const n = vals.length;
		let sum = 0;
		for (let i = 0; i < n; i++) sum += vals[i];
		const mean = sum / n;
		let sd = 0;
		if (n > 1) {
			let ss = 0;
			for (let i = 0; i < n; i++) {
				const d = vals[i] - mean;
				ss += d * d;
			}
			sd = Math.sqrt(ss / (n - 1));
		}
		const sem = n > 1 ? sd / Math.sqrt(n) : 0;
		out.push({ x: g.x, mean, sem, sd, n });
	}

	out.sort((a, b) => compareGroupKeys(a.x, b.x));
	return out;
}
