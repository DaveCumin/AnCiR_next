/**
 * Dragging an actogram marker line.
 *
 * The line has exactly two parameters (see lineFit.js): τ, the period in hours,
 * which is the slope in the absolute-time-vs-day frame, and θ, the time of day
 * the line crosses at the reference day. Dragging is just a second way of
 * setting them, beside the τ/θ number fields:
 *
 *   drag the MIDDLE of the line  → translate: θ moves, τ is untouched
 *   drag either END              → rotate about the reference day: τ moves,
 *                                  and θ at that reference day is held exactly
 *
 * Both write through PhaseMarkerClass.setTau / setTheta, which flip the
 * corresponding lock to Fixed, because a drag means "I have decided this
 * parameter".
 *
 * THE DAY COORDINATE. An actogram row is a band, not a line: row k (0-indexed)
 * occupies `eachplotheight` pixels starting at `padTop + k*(eachplotheight +
 * spaceBetween)`, and the drawn line runs from the time of day at the TOP of
 * that row to the time of day at its BOTTOM. So the continuous day coordinate
 * used here is `row + fraction through the row`, which is exactly the `d` of
 * `fitTimeOfDayAt(d) = intercept + d*(τ - periodHrs)`: at d = k the line is at
 * the top of row k, at d = k+1 at its bottom. The gap between rows is dead
 * space, so the fraction is clamped into [0, 1] rather than allowed to run on.
 *
 * NO JUMP ON GRAB. The pointer is almost never exactly on a 2 px line, so both
 * gestures work from the offset measured at pointerdown: the line moves by how
 * far the POINTER has moved, not to where the pointer is. Grabbing and letting
 * go without moving therefore changes nothing at all, which is what lets the
 * caller record one undo step only when the line really moved.
 */

/** Pixels the pointer must travel before a press counts as a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** Fraction of the line's length at each end that rotates rather than translates. */
export const END_ZONE_FRACTION = 0.25;

/**
 * Whether a press has travelled far enough to be a drag.
 *
 * @param {number} dxPx
 * @param {number} dyPx
 * @param {number} [threshold]
 * @returns {boolean}
 */
export function pastThreshold(dxPx, dyPx, threshold = DRAG_THRESHOLD_PX) {
	return Math.hypot(dxPx, dyPx) > threshold;
}

/**
 * Plot pixels → the actogram's own (day, time-of-day) coordinates.
 *
 * @param {number} px x in the plot SVG's own pixel frame
 * @param {number} py y in the plot SVG's own pixel frame
 * @param {{padLeft: number, padTop: number, plotwidth: number, eachplotheight: number,
 *          spaceBetween: number, periodHrs: number, doublePlot: number}} geom
 * @returns {{day: number, tod: number}} `day` is the continuous day coordinate
 *   described above; `tod` is hours across the (possibly repeated) x axis.
 */
export function actogramPointToDayTime(px, py, geom) {
	const rowH = geom.eachplotheight + geom.spaceBetween;
	const tod = ((px - geom.padLeft) / geom.plotwidth) * geom.periodHrs * geom.doublePlot;
	const rel = py - geom.padTop;
	const row = Math.floor(rel / rowH);
	const frac = Math.min(1, Math.max(0, (rel - row * rowH) / geom.eachplotheight));
	return { day: row + frac, tod };
}

/**
 * Which part of the drawn line a day coordinate falls in. The zones are taken
 * from the line's own drawn length (its clipped day range), so a line spanning
 * three days has proportionally the same grab zones as one spanning thirty.
 *
 * @param {number} day continuous day coordinate, as `actogramPointToDayTime` returns
 * @param {{lo: number, hi: number, endFraction?: number}} span 1-indexed drawn day
 *   range, i.e. `lineMinDay`/`lineMaxDay` after clamping
 * @returns {'start'|'middle'|'end'}
 */
export function lineZoneAt(day, { lo, hi, endFraction = END_ZONE_FRACTION }) {
	const a = lo - 1;
	const b = hi;
	if (!(b > a)) return 'middle';
	const t = (day - a) / (b - a);
	if (t <= endFraction) return 'start';
	if (t >= 1 - endFraction) return 'end';
	return 'middle';
}

/** The cursor that tells the user what the zone under the pointer will do. */
export function cursorForZone(zone, dragging = false) {
	if (zone === 'middle') return dragging ? 'grabbing' : 'grab';
	return 'ew-resize';
}

/**
 * The new value of the one parameter this gesture owns.
 *
 * @param {object} args
 * @param {'start'|'middle'|'end'} args.zone the zone grabbed at pointerdown
 * @param {{day: number, tod: number}} args.grab pointer position at pointerdown
 * @param {{day: number, tod: number}} args.pointer pointer position now
 * @param {number} args.tau the line's τ (hours) at pointerdown
 * @param {number} args.theta the line's θ (hours at `refDay`) at pointerdown
 * @param {number} args.refDay the day θ is anchored to, and the rotation pivot
 * @param {number} args.periodHrs the actogram's plotted period
 * @returns {{tau: number}|{theta: number}|null} null when the gesture changes
 *   nothing: the pointer has not moved, the value is not finite, or the pointer
 *   sits on the pivot itself, where no rotation is defined.
 */
export function dragLine({ zone, grab, pointer, tau, theta, refDay, periodHrs }) {
	if (!Number.isFinite(tau) || !Number.isFinite(theta)) return null;

	if (zone === 'middle') {
		const next = theta + (pointer.tod - grab.tod);
		if (!Number.isFinite(next) || next === theta) return null;
		return { theta: next };
	}

	// Rotate about (refDay, θ). The line reads tod(d) = θ + (τ - P)·(d - refDay),
	// so the offset below is how far the grab point sat off the line; subtracting
	// it keeps the line still at the moment of the grab.
	const lever = pointer.day - refDay;
	if (!Number.isFinite(lever) || Math.abs(lever) < 1e-9) return null;
	const offset = grab.tod - (theta + (tau - periodHrs) * (grab.day - refDay));
	const next = periodHrs + (pointer.tod - offset - theta) / lever;
	if (!Number.isFinite(next) || next === tau) return null;
	return { tau: next };
}
