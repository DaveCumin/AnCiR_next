/**
 * The actogram marker line's fit, with each of its two parameters independently
 * either FITTED from the block's markers or FIXED at a value the user set.
 *
 * Frame (identical to PhaseMarkerClass.linearRegression):
 *   x = the 1-indexed day number,
 *   y = the marker's absolute time = hour-of-day + day * periodHrs.
 * So the slope IS tau (the free-running period in hours), and the line's
 * time-of-day at day d is `(slope - periodHrs) * d + intercept`. The phase
 * theta is that time-of-day at the reference day, which puts the line through
 * the anchor point
 *   x0 = refDay,  y0 = theta + periodHrs * refDay
 * (note y0 does not depend on the slope, which is what makes "fix theta, fit
 * tau" a rotation about a fixed point).
 *
 * Residuals are ALWAYS measured from the line that is actually drawn against
 * the markers that are actually selected: predicted y = slope * x + intercept.
 * A constrained fit therefore reports a genuinely worse R squared, and a line
 * with no markers to compare against reports null rather than a fabricated 1 / 0.
 *
 * R SQUARED IS MEASURED IN THE TIME-OF-DAY FRAME. The total sum of squares is
 * that of z = y - periodHrs * x (each marker's unwrapped time of day) about its
 * mean, not that of the absolute time y. On absolute time the 24 h-per-day ramp
 * dominates the total, so even onsets placed uniformly at random scored a
 * median R squared of 0.986 over 7 days (review finding FIT-4). In this frame R
 * squared is the share of the time-of-day variance that the line's drift
 * (slope - periodHrs per day) explains: near 0 for random onsets, near 1 for a
 * clean free-running drift. Two consequences a reader must know:
 *  - an entrained record whose slope equals periodHrs has no drift to explain,
 *    so its R squared is near 0 however tight the onsets are (read RMSE);
 *  - a constrained (fixed tau or fixed theta) line can do worse than the mean
 *    time of day, so its R squared can legitimately be negative.
 * The residuals and RMSE are unchanged (y - (slope*x + intercept) equals
 * z - ((slope - periodHrs)*x + intercept)). R squared is null when the markers'
 * time of day does not vary at all (the ratio is 0 / 0).
 */

import { linearRegression } from '$lib/components/plotbits/helpers/wrangleData';
import { KahanSum } from '$lib/utils/numerics.js';

/**
 * @param {number[]} xs 1-indexed day numbers of the selected markers.
 * @param {number[]} ys Absolute marker times, same length as `xs`.
 * @param {object} opts
 * @param {number|null} [opts.tau] Fixed period in hours, or null to fit it.
 * @param {number|null} [opts.theta] Fixed time-of-day at `refDay`, or null to fit it.
 * @param {number} [opts.refDay] 1-indexed day `theta` is anchored to.
 * @param {number} [opts.periodHrs] The actogram's plotted period.
 * @returns {{slope: number, intercept: number, rSquared: number|null, rmse: number|null, n: number}}
 */
export function fitLine(xs, ys, { tau = null, theta = null, refDay = 1, periodHrs = 24 } = {}) {
	if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length) {
		throw new Error('fitLine: x and y must be arrays of the same length');
	}
	const n = xs.length;
	const tauFixed = tau != null && Number.isFinite(tau);
	const thetaFixed = theta != null && Number.isFinite(theta);
	// The anchor the fixed phase pins the line to.
	const x0 = refDay;
	const y0 = (thetaFixed ? /** @type {number} */ (theta) : 0) + periodHrs * refDay;

	let slope;
	let intercept;

	if (!tauFixed && !thetaFixed) {
		// Both free: the plain least-squares fit, from the shared helper so there
		// is exactly one copy of that arithmetic in the app.
		if (n === 0) {
			slope = NaN;
			intercept = NaN;
		} else {
			const reg = linearRegression(xs, ys);
			slope = reg.slope;
			intercept = reg.intercept;
		}
	} else if (tauFixed && !thetaFixed) {
		// tau known: the best phase is the mean residual, expressed through the
		// intercept so the drawn line, Est phi and the harmonic check are unchanged.
		slope = /** @type {number} */ (tau);
		if (n === 0) {
			intercept = NaN;
		} else {
			const kMean = new KahanSum();
			for (let i = 0; i < n; i++) kMean.add(ys[i] - slope * xs[i]);
			intercept = kMean.value / n;
		}
	} else if (!tauFixed && thetaFixed) {
		// theta known: least squares for the slope of a line pivoting about the anchor.
		let num = 0;
		let den = 0;
		for (let i = 0; i < n; i++) {
			const dx = xs[i] - x0;
			num += dx * (ys[i] - y0);
			den += dx * dx;
		}
		slope = den === 0 ? NaN : num / den;
		intercept = y0 - slope * x0;
	} else {
		// Both fixed: the eye-fit line exactly as the user set it.
		slope = /** @type {number} */ (tau);
		intercept = y0 - slope * x0;
	}

	return { slope, intercept, ...residuals(xs, ys, slope, intercept, periodHrs), n };
}

/**
 * R squared and RMSE of the drawn line against the markers. Null (not 1 and 0)
 * when there is nothing to compare against. R squared is in the time-of-day
 * frame (see the header): SS_tot is the spread of z = y - periodHrs * x.
 *
 * @param {number[]} xs
 * @param {number[]} ys
 * @param {number} slope
 * @param {number} intercept
 * @param {number} periodHrs
 * @returns {{rSquared: number|null, rmse: number|null}}
 */
function residuals(xs, ys, slope, intercept, periodHrs) {
	const n = xs.length;
	if (n === 0 || !Number.isFinite(slope) || !Number.isFinite(intercept)) {
		return { rSquared: null, rmse: null };
	}
	// Compensated sums, matching the shared least-squares helper.
	const kZ = new KahanSum();
	for (let i = 0; i < n; i++) kZ.add(ys[i] - periodHrs * xs[i]);
	const meanZ = kZ.value / n;
	const kTot = new KahanSum();
	const kRes = new KahanSum();
	for (let i = 0; i < n; i++) {
		kTot.add((ys[i] - periodHrs * xs[i] - meanZ) ** 2);
		kRes.add((ys[i] - (slope * xs[i] + intercept)) ** 2);
	}
	const rSquared = kTot.value > 0 ? 1 - kRes.value / kTot.value : null;
	return { rSquared, rmse: Math.sqrt(kRes.value / n) };
}
