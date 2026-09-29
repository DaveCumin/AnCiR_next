// Which actogram rows (days) a marker block's line is FITTED to.
//
// Pure: plain arrays in, plain values out, no Svelte state. The Python and R ports of the
// marker rules (plan 2026-09-30-actogram-marker-rules-and-outputs, Parity decision) mirror
// this module function by function, beside onsetUnwrap.js (detection, unwrap, phase) and
// lineFit.js (the four constrained fits).
//
// Two ingredients, composed with AND (Decision 1a):
//
//  1. The series' own per-day ticks, `selectedPeriods`, indexed by 0-based ROW. A missing
//     entry counts as ticked: the array is sized when the block is made and a series can
//     gain rows later, and a new row must not silently drop out of the fit.
//  2. The day range `lineMinDay..lineMaxDay` (1-indexed, inclusive, null = unbounded on
//     that side), but ONLY when the range scopes the fit. It always does for a rule
//     instance; for an own block it does only when the block carries `fitWithinRange`
//     (a block detached from a rule does, so it computes exactly what its instance did).
//     Otherwise the range clips the DRAWN line only, which is what it has always meant for
//     a per-series block, so no saved session changes.

/**
 * The inclusive 1-indexed day range the fit may use.
 * @param {{lineMinDay?: number|null, lineMaxDay?: number|null}} range
 * @returns {{lo: number, hi: number}} hi is Infinity when unbounded.
 */
export function fitDayRange({ lineMinDay = null, lineMaxDay = null } = {}) {
	const lo = Number.isFinite(lineMinDay) ? Math.max(1, lineMinDay) : 1;
	const hi = Number.isFinite(lineMaxDay) ? lineMaxDay : Infinity;
	return { lo, hi };
}

/**
 * Whether row `i` (0-based) enters the fit.
 * @param {number} i
 * @param {ArrayLike<boolean>|null|undefined} selectedPeriods per-row ticks (missing = ticked)
 * @param {{rangeScopesFit?: boolean, lineMinDay?: number|null, lineMaxDay?: number|null}} [opts]
 */
export function isDaySelected(i, selectedPeriods, opts = {}) {
	if (!(selectedPeriods?.[i] ?? true)) return false;
	if (!opts.rangeScopesFit) return true;
	const { lo, hi } = fitDayRange(opts);
	const day = i + 1;
	return day >= lo && day <= hi;
}

/**
 * The selection for rows 0..n-1 as a dense boolean array (the shape `unwrapOnsets` takes).
 * @param {number} n number of rows
 * @param {ArrayLike<boolean>|null|undefined} selectedPeriods
 * @param {{rangeScopesFit?: boolean, lineMinDay?: number|null, lineMaxDay?: number|null}} [opts]
 * @returns {boolean[]}
 */
export function selectionMask(n, selectedPeriods, opts = {}) {
	const out = new Array(Math.max(0, n | 0));
	for (let i = 0; i < out.length; i++) out[i] = isDaySelected(i, selectedPeriods, opts);
	return out;
}

/**
 * Whether row `i` is ticked by the series but left out by the range (the per-day list shows
 * such a row as "outside the range" rather than as unticked).
 */
export function isOutsideFitRange(i, opts = {}) {
	if (!opts.rangeScopesFit) return false;
	const { lo, hi } = fitDayRange(opts);
	const day = i + 1;
	return day < lo || day > hi;
}
