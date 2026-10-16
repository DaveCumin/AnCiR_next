// @ts-nocheck
// The log value axis shared by the Periodogram (power) and the FFT (magnitude).
//
// A log axis cannot reach 0, so it needs a lower end of its own. Taking the linear axis's
// lower end (0) through a floor, as the FFT once did, put the floor (1e-6) at the bottom and
// spent most of the height on decades below the data. Both plots now start from the smallest
// positive value they draw. Values at or below zero have no place on the axis and are gaps.
// Ticks are labelled as plain numbers ("0.01", "1000"), never SI prefixes ("10m", "1k"):
// these are statistics, not units. Gridlines follow the labelled ticks (Axis.svelte).
//
// Display only: nothing computed, exported as data, or wired to a port changes with the
// axis. The Python export mirrors it (ancir_runtime.py log_axis_domain / _apply_log_axis).

/** The lowest the automatic lower end goes. */
export const LOG_AXIS_FLOOR = 1e-6;

/**
 * The y domain of a log axis. A user-set positive minimum wins; otherwise the smallest
 * positive value drawn, lowered by 5% of the decades shown so that point sits off the axis
 * line, and never below LOG_AXIS_FLOOR.
 * @param {number|null} userMin  the stored lower limit (ylimsIN[0])
 * @param {number} minPositive  smallest positive value drawn (Infinity if none)
 * @param {number} hi  the top of the linear domain (ylims[1])
 * @returns {[number, number]}
 */
export function logAxisDomain(userMin, minPositive, hi) {
	let top = hi > 0 && Number.isFinite(hi) ? hi : 1;
	let lo;
	if (userMin != null && userMin > 0) lo = userMin;
	else if (Number.isFinite(minPositive) && minPositive > 0 && minPositive < top)
		lo = minPositive / Math.pow(top / minPositive, 0.05);
	else lo = top / 10;
	lo = Math.max(lo, LOG_AXIS_FLOOR);
	if (!(top > lo)) top = lo * 10;
	return [lo, top];
}

/**
 * The smallest positive finite number across arrays (and loose extra values), Infinity if none.
 * @param {Iterable<ArrayLike<number>|null|undefined>} arrays
 * @param {number[]} [extra]  e.g. an overlay extent
 */
export function minPositiveOf(arrays, extra = []) {
	let m = Infinity;
	for (const a of arrays) {
		if (!a) continue;
		for (const v of a) if (v > 0 && v < m) m = v;
	}
	for (const v of extra ?? []) if (v > 0 && v < m) m = v;
	return m;
}

/** Values as drawn on a log axis: a value at or below zero has no place, so it is a gap. */
export function drawableOnLog(arr) {
	return (arr ?? []).map((v) => (v > 0 ? v : NaN));
}

/**
 * Tick labels for a log scale as plain numbers ('~g': 0.01, 0.1, 1, 10, 1000), and only on
 * the ticks d3 chooses to label for `nticks`.
 * @param {import('d3-scale').ScaleLogarithmic<number, number>} scale
 * @param {number} [nticks]
 */
export function logTickFormat(scale, nticks) {
	return scale.tickFormat(nticks, '~g');
}
