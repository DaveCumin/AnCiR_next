// stableBins.js: keep an actogram series' bins the SAME object while their values are the same.
//
// A series' bins are derived from its x and y columns. Those columns re-derive far more often
// than their values change: a column's cache key is a global counter, and a reference column
// re-keys whenever core.data changes (every analysis output column added during a load does
// that). Each re-derive used to hand the actogram a NEW bins array with the same numbers, so
// every row of every series redrew its bars, once per column added: loading 50 series redrew
// all 700 rows about 110 times over (review ROB-9).
//
// Comparing the freshly built bins with the previous ones costs one pass over plain numbers,
// far less than redrawing, and returning the previous array lets Svelte's derived equality
// check stop the update there. The comparison is by VALUE against the previous OUTPUT, so a
// raw array edited in place (same array object, new numbers) still produces new bins.

/**
 * @template {{ start: number, end: number, y: number }} B
 * @param {B[] | null | undefined} prev
 * @param {B[]} next
 * @returns {boolean} true when both hold the same bins in the same order
 */
export function sameBins(prev, next) {
	if (prev === next) return true;
	if (!prev || !next || prev.length !== next.length) return false;
	for (let i = 0; i < next.length; i++) {
		const a = prev[i];
		const b = next[i];
		if (!Object.is(a.start, b.start) || !Object.is(a.end, b.end) || !Object.is(a.y, b.y)) {
			return false;
		}
	}
	return true;
}

/**
 * `prev` when it holds the same bins as `next`, else `next`.
 * @template T
 * @param {T | null | undefined} prev
 * @param {T} next
 * @returns {T}
 */
export function keepSameBins(prev, next) {
	// @ts-ignore: both are bin arrays
	return prev && sameBins(prev, next) ? prev : next;
}

// One row's bars, per series bins object. The row's {xStart, xEnd, y} are rebuilt by the
// plot snippet whenever anything it reads changes (the snippet argument itself included),
// and a new object makes that row's <Hist> redraw. Caching by the series' binsByPeriod object
// (which now only changes when its values do, see keepSameBins) plus the row's parameters
// hands back the very same object, so an unchanged row is not redrawn.
const rowCache = new WeakMap();

/**
 * @template R
 * @param {object} binsByPeriod the series' per-period bins (the cache owner)
 * @param {number} from first period in the row
 * @param {number} to one past the last period in the row
 * @param {number} periodHrs period length in hours
 * @param {(binsByPeriod: object, from: number, to: number, periodHrs: number) => R} build
 * @returns {R}
 */
export function cachedRowBins(binsByPeriod, from, to, periodHrs, build) {
	if (!binsByPeriod || typeof binsByPeriod !== 'object') {
		return build(binsByPeriod, from, to, periodHrs);
	}
	let rows = rowCache.get(binsByPeriod);
	if (!rows) {
		rows = new Map();
		rowCache.set(binsByPeriod, rows);
	}
	const key = `${from}|${to}|${periodHrs}`;
	let row = rows.get(key);
	if (row === undefined) {
		row = build(binsByPeriod, from, to, periodHrs);
		rows.set(key, row);
	}
	return row;
}
