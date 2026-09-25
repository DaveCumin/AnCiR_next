/**
 * PhaseMarkerClass ↔ per-parameter fit locks.
 *
 * τ (the slope, the period in hours) and θ (the phase, the time of day at the
 * reference day) are each independently fitted from the block's selected
 * markers or fixed at a value the user typed or dragged to. This file pins the
 * four combinations at class level, the honest residuals, the "a drag fixes
 * that parameter" rule, persistence and the migration of sessions saved before
 * the locks existed.
 *
 * The baseline values asserted in the migration tests were captured by running
 * these same constructions against the code BEFORE the locks were added.
 */
import { describe, it, expect } from 'vitest';
import { PhaseMarkerClass } from './PhaseMarker.svelte';

const P = 24;

function stubParent({ Ndays = 10 } = {}) {
	return {
		colour: 'black',
		binSize: 0.25,
		x: { hoursSinceStart: [] },
		y: { getData: () => [] },
		dataByDays: { xByPeriod: {}, yByPeriod: {} },
		parentPlot: {
			periodHrs: P,
			Ndays,
			doublePlot: 2,
			plotwidth: 400,
			eachplotheight: 10,
			spaceBetween: 2,
			padding: { left: 40, top: 20 }
		}
	};
}

/**
 * A manual block whose markers lie on hour = theta0 + (tau - P) * dayIndex,
 * optionally with per-day noise. In the fit's frame that is a straight line of
 * slope tau, so the free fit recovers tau exactly when noise is absent.
 */
function manualBlock(tau, theta0, { nDays = 6, noise = null, ...extra } = {}) {
	const manualMarkers = [];
	for (let i = 0; i < nDays; i++) {
		manualMarkers.push(i * P + (theta0 + (tau - P) * i + (noise?.[i] ?? 0)));
	}
	return new PhaseMarkerClass(stubParent(), { type: 'manual', manualMarkers, ...extra });
}

/** A source-less line, exactly as the "Add line" preset (addFitLine) builds it. */
function lineBlock(extra = {}) {
	return new PhaseMarkerClass(stubParent(), {
		type: 'manual',
		manualMarkers: [],
		lockTau: 'fixed',
		lockTheta: 'fixed',
		name: 'fit_0',
		fitSlope: P,
		fitIntercept: P / 2,
		lineMinDay: 1,
		lineMaxDay: 10,
		showLine: true,
		lineWidth: 2,
		...extra
	});
}

describe('defaults', () => {
	it('a marker block fits both parameters', () => {
		const m = manualBlock(23.5, 6);
		expect(m.lockTau).toBe('fit');
		expect(m.lockTheta).toBe('fit');
		expect(m.canFit).toBe(true);
	});

	it('a line-only block fixes both, and cannot fit: it has no markers', () => {
		const m = lineBlock();
		expect(m.lockTau).toBe('fixed');
		expect(m.lockTheta).toBe('fixed');
		expect(m.canFit).toBe(false);
		expect(m.markers).toEqual([]);
	});
});

describe('the four combinations', () => {
	const noise = [0.4, -0.3, 0.2, -0.5, 0.1, 0.3];

	it('fit / fit is the plain least-squares line', () => {
		const m = manualBlock(23.5, 6, { noise });
		expect(m.linearRegression.slope).toBeGreaterThan(23.3);
		expect(m.linearRegression.slope).toBeLessThan(23.7);
		expect(m.linearRegression.rSquared).toBeGreaterThan(0.999);
	});

	it('τ fixed / θ fitted re-fits the phase and keeps the fixed τ', () => {
		const m = manualBlock(23.5, 6, { noise });
		const free = { ...m.linearRegression };
		m.setLockTau('fixed');
		m.setTau(25);
		expect(m.linearRegression.slope).toBe(25);
		// The phase moved: the intercept is the mean residual under the fixed slope.
		const { xs, ys } = m.fitPoints;
		const expected = xs.reduce((s, x, i) => s + (ys[i] - 25 * x), 0) / xs.length;
		expect(m.linearRegression.intercept).toBeCloseTo(expected, 9);
		expect(m.linearRegression.rSquared).toBeLessThan(free.rSquared);
	});

	it('θ fixed / τ fitted re-fits the slope about the anchor', () => {
		const m = manualBlock(23.5, 6, { noise });
		const free = { ...m.linearRegression };
		m.setTheta(10); // 4 hrs away from the fitted phase at day 1
		expect(m.lockTheta).toBe('fixed');
		expect(m.lockTau).toBe('fit');
		// The slope is free, so it moved away from the free fit to reach the anchor.
		expect(m.linearRegression.slope).not.toBeCloseTo(free.slope, 3);
		// And the line passes exactly through the anchor.
		const rd = m.fitRefDay;
		expect((m.linearRegression.slope - P) * rd + m.linearRegression.intercept).toBeCloseTo(10, 9);
		expect(m.linearRegression.rSquared).toBeLessThan(free.rSquared);
	});

	it('both fixed draws exactly what the user set', () => {
		const m = manualBlock(23.5, 6, { noise });
		m.setTau(25);
		m.setTheta(9);
		expect(m.linearRegression.slope).toBe(25);
		const rd = m.fitRefDay;
		expect((m.linearRegression.slope - P) * rd + m.linearRegression.intercept).toBeCloseTo(9, 9);
	});

	it('flipping a lock to Fixed adopts the drawn value and does not move the line', () => {
		const m = manualBlock(23.5, 6, { noise });
		const before = { ...m.linearRegression };
		expect(m.tauValue).toBeNull(); // nothing pinned yet
		m.setLockTau('fixed');
		// The fixed value is seeded from the line as drawn, so the number the user
		// now sees in the field is the fitted one they were just looking at.
		expect(m.tauValue).toBeCloseTo(before.slope, 12);
		expect(m.thetaValue).toBeCloseTo((before.slope - P) * m.fitRefDay + before.intercept, 12);
		expect(m.linearRegression.slope).toBeCloseTo(before.slope, 12);
		expect(m.linearRegression.intercept).toBeCloseTo(before.intercept, 12);
		m.setLockTheta('fixed');
		expect(m.linearRegression.slope).toBeCloseTo(before.slope, 12);
		expect(m.linearRegression.intercept).toBeCloseTo(before.intercept, 12);
	});

	it('releasing a lock back to Fit returns the free fit', () => {
		const m = manualBlock(23.5, 6, { noise });
		const free = { ...m.linearRegression };
		m.setTau(25);
		m.setLockTau('fit');
		expect(m.linearRegression.slope).toBeCloseTo(free.slope, 12);
		expect(m.linearRegression.intercept).toBeCloseTo(free.intercept, 12);
	});
});

describe('a drag (or a typed value) fixes that parameter', () => {
	it('rotating (setTau) fixes τ and leaves θ fitted', () => {
		const m = manualBlock(23.5, 6);
		m.setTau(24.8);
		expect(m.lockTau).toBe('fixed');
		expect(m.lockTheta).toBe('fit');
		expect(m.tauValue).toBe(24.8);
	});

	it('translating (setTheta) fixes θ and leaves τ fitted', () => {
		const m = manualBlock(23.5, 6);
		m.setTheta(8);
		expect(m.lockTheta).toBe('fixed');
		expect(m.lockTau).toBe('fit');
		expect(m.thetaValue).toBeCloseTo(8, 9);
	});

	it('rotating about the reference day keeps θ when θ is fixed', () => {
		const m = manualBlock(23.5, 6);
		m.setLockTheta('fixed');
		const rd = m.fitRefDay;
		const todBefore = (m.linearRegression.slope - P) * rd + m.linearRegression.intercept;
		m.setTau(26);
		const todAfter = (m.linearRegression.slope - P) * rd + m.linearRegression.intercept;
		expect(todAfter).toBeCloseTo(todBefore, 9);
	});

	it('rotating while θ is still fitted lets the phase re-fit to the markers', () => {
		const m = manualBlock(23.5, 6);
		const rd = m.fitRefDay;
		const todBefore = (m.linearRegression.slope - P) * rd + m.linearRegression.intercept;
		m.setTau(26);
		// The stored pair still remembers the phase the rotation pivoted about …
		expect(m.thetaValue).toBeCloseTo(todBefore, 9);
		// … but the DRAWN line re-fits θ, because that lock is still 'fit'.
		const todAfter = (m.linearRegression.slope - P) * rd + m.linearRegression.intercept;
		expect(todAfter).not.toBeCloseTo(todBefore, 3);
	});

	it('a line-only block still rotates and translates from its stored pair', () => {
		const m = lineBlock();
		m.setTau(23.2);
		expect(m.linearRegression.slope).toBe(23.2);
		m.setTheta(7);
		expect(m.linearRegression.slope).toBe(23.2);
		expect(m.fitTimeOfDayAt(m.fitRefDay)).toBeCloseTo(7, 9);
	});
});

describe('honest residuals', () => {
	it('a line with no markers reports null, not the old 1 and 0', () => {
		const m = lineBlock();
		expect(m.linearRegression.rSquared).toBeNull();
		expect(m.linearRegression.rmse).toBeNull();
		expect(m.linearRegression.n).toBe(0);
	});

	it('a fixed line over real markers reports its actual error', () => {
		const m = manualBlock(23.5, 6);
		m.setTau(26);
		m.setTheta(12);
		expect(m.linearRegression.rSquared).not.toBe(1);
		expect(m.linearRegression.rmse).toBeGreaterThan(1);
	});

	it('deselecting markers changes the residuals the line is judged against', () => {
		const m = manualBlock(23.5, 6, { noise: [0, 0, 0, 0, 0, 4] });
		const all = m.linearRegression.rmse;
		m.selectedPeriods = [true, true, true, true, true, false];
		expect(m.linearRegression.rmse).toBeLessThan(all);
	});
});

describe('persistence', () => {
	it('round-trips both locks', () => {
		const m = manualBlock(23.5, 6);
		m.setTau(24.9);
		m.setLockTheta('fixed');
		const json = JSON.parse(JSON.stringify(m.toJSON()));
		expect(json.lockTau).toBe('fixed');
		expect(json.lockTheta).toBe('fixed');
		const back = PhaseMarkerClass.fromJSON(json, stubParent());
		expect(back.lockTau).toBe('fixed');
		expect(back.lockTheta).toBe('fixed');
		expect(back.linearRegression.slope).toBeCloseTo(m.linearRegression.slope, 12);
		expect(back.linearRegression.intercept).toBeCloseTo(m.linearRegression.intercept, 12);
	});

	it('a fitted block round-trips as fitted', () => {
		const m = manualBlock(23.5, 6);
		const back = PhaseMarkerClass.fromJSON(JSON.parse(JSON.stringify(m.toJSON())), stubParent());
		expect(back.lockTau).toBe('fit');
		expect(back.lockTheta).toBe('fit');
	});
});

describe('migration of sessions saved before the locks existed', () => {
	// Baseline captured from the pre-change code:
	//   manual block (τ = 23.5, θ₀ = 6) → slope 23.5, intercept 6.5, Est φ 6 @ day 1
	//   legacy fitline (23.7 / 6.3)     → slope 23.7, intercept 6.3, Est φ 6 @ day 1
	it('a legacy onset/manual block still fits both parameters, identically', () => {
		const legacy = {
			name: 'marker_0',
			type: 'manual',
			centileThreshold: 50,
			templateHrsBefore: 3,
			templateHrsAfter: 3,
			colour: 'black',
			manualMarkers: [0 * P + 6, 1 * P + 5.5, 2 * P + 5, 3 * P + 4.5, 4 * P + 4, 5 * P + 3.5]
		};
		expect('lockTau' in legacy).toBe(false);
		const m = PhaseMarkerClass.fromJSON(legacy, stubParent());
		expect(m.lockTau).toBe('fit');
		expect(m.lockTheta).toBe('fit');
		expect(m.linearRegression.slope).toBeCloseTo(23.5, 9);
		expect(m.linearRegression.intercept).toBeCloseTo(6.5, 9);
		expect(m.linearRegression.rSquared).toBeCloseTo(1, 9);
		expect(m.estimatedPhase).toEqual({ phase: 6, refDay: 1 });
	});

	it('a legacy fitline loads as a line-only manual block, drawing its saved pair', () => {
		const legacy = {
			name: 'fit_0',
			type: 'fitline',
			colour: 'red',
			fitSlope: 23.7,
			fitIntercept: 6.3,
			lineMinDay: 1,
			lineMaxDay: 8,
			showLine: true,
			lineWidth: 2
		};
		expect('lockTau' in legacy).toBe(false);
		const m = PhaseMarkerClass.fromJSON(legacy, stubParent());
		// The `fitline` TYPE is gone: it was only ever a manual block with no
		// markers and both parameters fixed, so that is what it loads as.
		expect(m.type).toBe('manual');
		expect(m.manualMarkers).toEqual([]);
		expect(m.markers).toEqual([]);
		expect(m.markerPoints).toBe('');
		expect(m.lockTau).toBe('fixed');
		expect(m.lockTheta).toBe('fixed');
		expect(m.linearRegression.slope).toBe(23.7);
		expect(m.linearRegression.intercept).toBeCloseTo(6.3, 12);
		expect(m.estimatedPhase.phase).toBeCloseTo(6, 9);
		expect(m.estimatedPhase.refDay).toBe(1);
		// The only deliberate change: the fabricated rSquared 1 / rmse 0 are gone.
		expect(m.linearRegression.rSquared).toBeNull();
		expect(m.linearRegression.rmse).toBeNull();
	});
});

describe('marker path stays valid before the plot has sized itself', () => {
	it('skips dots whose row position is not finite instead of writing "Infinity"', () => {
		const block = manualBlock(24.5, 6);
		block.parentData.parentPlot.eachplotheight = Infinity;
		expect(block.markerPoints).not.toMatch(/Infinity|NaN/);
	});
});
