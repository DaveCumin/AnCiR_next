/**
 * Unit tests for the actogram marker-line fit with per-parameter locks.
 *
 * The frame matches PhaseMarkerClass.linearRegression: x is the 1-indexed day
 * number, y is the marker's absolute time (hour-of-day + day * periodHrs), so
 * the slope IS tau (the period in hours) and theta (the phase) is the
 * time-of-day the line crosses at the reference day.
 */
import { describe, it, expect } from 'vitest';
import { fitLine } from './lineFit.js';

const P = 24;

/**
 * Markers lying exactly on tau/theta0: hour at day index i is
 * theta0 + (tau - P) * i, so y_i = intercept + tau * x_i with x_i = i + 1 and
 * intercept = theta0 + P - tau.
 */
function exactMarkers(tau, theta0, n = 6) {
	const xs = [];
	const ys = [];
	for (let i = 0; i < n; i++) {
		xs.push(i + 1);
		ys.push(theta0 + (tau - P) * i + (i + 1) * P);
	}
	return { xs, ys, intercept: theta0 + P - tau };
}

describe('fitLine: the four lock combinations', () => {
	it('tau fitted, theta fitted: plain least squares', () => {
		const { xs, ys, intercept } = exactMarkers(23.5, 6);
		const r = fitLine(xs, ys, { tau: null, theta: null, refDay: 1, periodHrs: P });
		expect(r.slope).toBeCloseTo(23.5, 9);
		expect(r.intercept).toBeCloseTo(intercept, 9);
		expect(r.rSquared).toBeCloseTo(1, 9);
		expect(r.rmse).toBeCloseTo(0, 9);
		expect(r.n).toBe(6);
	});

	it('tau FIXED, theta fitted: intercept is the mean residual', () => {
		// Markers are exact for tau = 23.5; forcing tau = 24 must keep the best
		// possible theta, i.e. intercept = mean(y_i - 24 * x_i).
		const { xs, ys } = exactMarkers(23.5, 6);
		const r = fitLine(xs, ys, { tau: 24, theta: null, refDay: 1, periodHrs: P });
		expect(r.slope).toBe(24);
		const expected = xs.reduce((s, x, i) => s + (ys[i] - 24 * x), 0) / xs.length;
		expect(r.intercept).toBeCloseTo(expected, 9);
		// Mean residual ⇒ the residuals sum to zero.
		const resid = xs.reduce((s, x, i) => s + (ys[i] - (24 * x + r.intercept)), 0);
		expect(resid).toBeCloseTo(0, 9);
	});

	it('tau fitted, theta FIXED: slope through the anchor (refDay, theta)', () => {
		const { xs, ys } = exactMarkers(23.5, 6);
		// Anchor the phase 2 hrs away from the true one at day 3.
		const refDay = 3;
		const theta = 6 + (23.5 - P) * (refDay - 1) + 2;
		const r = fitLine(xs, ys, { tau: null, theta, refDay, periodHrs: P });
		const x0 = refDay;
		const y0 = theta + P * refDay;
		const num = xs.reduce((s, x, i) => s + (x - x0) * (ys[i] - y0), 0);
		const den = xs.reduce((s, x) => s + (x - x0) ** 2, 0);
		expect(r.slope).toBeCloseTo(num / den, 9);
		// The line passes exactly through the anchor.
		expect(r.slope * x0 + r.intercept).toBeCloseTo(y0, 9);
	});

	it('both FIXED: the line is exactly what the user set', () => {
		const { xs, ys } = exactMarkers(23.5, 6);
		const refDay = 2;
		const theta = 5;
		const r = fitLine(xs, ys, { tau: 25, theta, refDay, periodHrs: P });
		expect(r.slope).toBe(25);
		expect(r.slope * refDay + r.intercept).toBeCloseTo(theta + P * refDay, 9);
	});
});

describe('fitLine: honest residuals', () => {
	it('a fixed line that misses the markers does NOT report R² = 1', () => {
		// The old fitline branch hard-coded rSquared: 1, rmse: 0 for ANY drawn line.
		const { xs, ys } = exactMarkers(23.5, 6);
		const r = fitLine(xs, ys, { tau: 26, theta: 12, refDay: 1, periodHrs: P });
		expect(r.rSquared).toBeLessThan(0.99);
		expect(r.rmse).toBeGreaterThan(1);
	});

	it('a visibly worse constrained fit drops R² below the free fit', () => {
		const { xs, ys } = exactMarkers(23.5, 6);
		// Add noise so the free fit is not perfect either.
		const noisy = ys.map((y, i) => y + [0.4, -0.3, 0.2, -0.5, 0.1, 0.3][i]);
		const free = fitLine(xs, noisy, { tau: null, theta: null, refDay: 1, periodHrs: P });
		const forced = fitLine(xs, noisy, { tau: 21, theta: null, refDay: 1, periodHrs: P });
		expect(free.rSquared).toBeGreaterThan(0.999);
		// Note R² is measured on absolute times, whose day-to-day trend dominates
		// the total sum of squares, so even a poor line scores high: what matters
		// is that the constrained fit is measurably WORSE than the free one.
		expect(forced.rSquared).toBeLessThan(0.99);
		expect(free.rSquared - forced.rSquared).toBeGreaterThan(0.01);
		expect(forced.rmse).toBeGreaterThan(free.rmse * 10);
	});

	it('the unconstrained fit has R² ≥ every constrained fit on the same markers', () => {
		const { xs, ys } = exactMarkers(24.6, 3, 9);
		const noisy = ys.map((y, i) => y + Math.sin(i * 1.7) * 0.8);
		const free = fitLine(xs, noisy, { tau: null, theta: null, refDay: 1, periodHrs: P });
		for (const tau of [22, 23, 24, 24.6, 25, 26]) {
			for (const theta of [null, 0, 3, 7, 12]) {
				for (const refDay of [1, 4, 9]) {
					const c = fitLine(xs, noisy, { tau, theta, refDay, periodHrs: P });
					expect(c.rSquared).toBeLessThanOrEqual(free.rSquared + 1e-12);
				}
				const cTheta = fitLine(xs, noisy, { tau: null, theta, refDay: 1, periodHrs: P });
				expect(cTheta.rSquared).toBeLessThanOrEqual(free.rSquared + 1e-12);
			}
		}
	});

	it('a constrained fit that happens to match the free fit ties its R²', () => {
		const { xs, ys } = exactMarkers(23.5, 6);
		const noisy = ys.map((y, i) => y + [0.4, -0.3, 0.2, -0.5, 0.1, 0.1][i]);
		const free = fitLine(xs, noisy, { tau: null, theta: null, refDay: 1, periodHrs: P });
		const same = fitLine(xs, noisy, { tau: free.slope, theta: null, refDay: 1, periodHrs: P });
		expect(same.rSquared).toBeCloseTo(free.rSquared, 12);
		expect(same.intercept).toBeCloseTo(free.intercept, 9);
	});
});

describe('fitLine: no markers to compare against', () => {
	it('reports null residuals, never 1 and 0', () => {
		const r = fitLine([], [], { tau: 24, theta: 6, refDay: 1, periodHrs: P });
		expect(r.slope).toBe(24);
		expect(r.intercept).toBeCloseTo(6, 9);
		expect(r.rSquared).toBeNull();
		expect(r.rmse).toBeNull();
		expect(r.n).toBe(0);
	});

	it('cannot determine a free parameter without markers', () => {
		expect(fitLine([], [], { tau: null, theta: 6, refDay: 1, periodHrs: P }).slope).toBeNaN();
		expect(fitLine([], [], { tau: 24, theta: null, refDay: 1, periodHrs: P }).intercept).toBeNaN();
	});
});

describe('fitLine: degenerate inputs', () => {
	it('a single marker cannot determine a free slope but can determine a fixed-tau phase', () => {
		expect(fitLine([2], [50], { tau: null, theta: null, refDay: 1, periodHrs: P }).slope).toBeNaN();
		const r = fitLine([2], [50], { tau: 24, theta: null, refDay: 1, periodHrs: P });
		expect(r.slope).toBe(24);
		expect(r.intercept).toBeCloseTo(2, 9);
	});

	it('all markers on the anchor day cannot determine a free slope', () => {
		const r = fitLine([3, 3], [70, 71], { tau: null, theta: 0, refDay: 3, periodHrs: P });
		expect(r.slope).toBeNaN();
	});

	it('throws when the arrays disagree in length', () => {
		expect(() => fitLine([1, 2], [1], {})).toThrow();
	});
});
