/**
 * Migration pin on a REAL shipped session.
 *
 * static/sessions/demos/demo-workflow-free-running.json is the free-running
 * period demo: a real 14-day actogram over real activity data. Every shipped
 * session stores its actogram with `phaseMarkers: []`, so to exercise the
 * migration this splices a LEGACY (lock-free, exactly the shape the app wrote
 * before lockTau/lockTheta existed) marker block into that session's actogram
 * and reconstructs it through the real Column → Plot → ActogramDataclass →
 * PhaseMarkerClass.fromJSON path. The markers therefore come from the real
 * onset detection over the real binned data, not from a synthetic fixture.
 *
 * The expected values below were captured by running this same file against
 * the code BEFORE the locks were added. They must not move.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { scaleLinear } from 'd3-scale';

const SESSION = join(
	process.cwd(),
	'static',
	'sessions',
	'demos',
	'demo-workflow-free-running.json'
);

/** A marker block exactly as the app serialised one before the locks existed. */
const LEGACY_ONSET = {
	name: 'marker_0',
	type: 'onset',
	centileThreshold: 50,
	templateHrsBefore: 3,
	templateHrsAfter: 3,
	colour: '#234154',
	showLine: true,
	showMarkers: true,
	lineWidth: 1,
	markerSize: 5,
	lineMinDay: null,
	lineMaxDay: null,
	phaseRefDay: null,
	selectedPeriods: null,
	manualMarkers: []
};

/** An eye-fit line exactly as the app serialised one before the locks existed. */
const LEGACY_FITLINE = {
	name: 'fit_0',
	type: 'fitline',
	colour: '#234154',
	showLine: true,
	showMarkers: true,
	lineWidth: 2,
	markerSize: 5,
	lineMinDay: 1,
	lineMaxDay: 14,
	phaseRefDay: null,
	selectedPeriods: null,
	manualMarkers: [],
	fitSlope: 24.5,
	fitIntercept: 7.25
};

/**
 * Rebuild the demo's actogram with `phaseMarkers` spliced in, and hand back its
 * first series' marker blocks.
 */
function actogramWithMarkers(phaseMarkers) {
	return actogramWith(phaseMarkers).markers;
}

/** As above, but also hands back the series, so the "Add line" preset can be run. */
function actogramWith(phaseMarkers) {
	const session = JSON.parse(readFileSync(SESSION, 'utf8'));
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.groups = [];
	core.storedValues = {};
	core.rawData = new Map(Object.entries(session.rawData ?? {}).map(([k, v]) => [+k, v]));
	for (const cd of session.data ?? []) pushObj(Column.fromJSON(cd));

	const plotJson = session.plots.find((p) => p.type === 'actogram');
	expect(plotJson).toBeTruthy();
	// The shipped session really does carry an actogram with no marker blocks.
	expect(plotJson.plot.data[0].phaseMarkers ?? []).toEqual([]);
	// …and those blocks really are lock-free, which is what migration must handle.
	for (const m of phaseMarkers) {
		expect('lockTau' in m).toBe(false);
		expect('lockTheta' in m).toBe(false);
	}
	plotJson.plot.data[0].phaseMarkers = phaseMarkers;

	const plot = Plot.fromJSON(plotJson);
	core.plots.push(plot);
	// Plot sizes come from the DOM in the app; give the class a real box so the
	// day count and the plot geometry are finite.
	plot.parentBox = { id: plot.id, width: 600, height: 500 };
	return { series: plot.plot.data[0], markers: plot.plot.data[0].phaseMarkers };
}

/**
 * The line exactly as the plot snippet draws it (see PhaseMarker.svelte's `plot`
 * snippet): the four SVG endpoint coordinates. Pinned so the migration is proved
 * to DRAW identically, not merely to carry the same numbers.
 */
function lineEndpoints(m) {
	const plot = m.parentData.parentPlot;
	const reg = m.linearRegression;
	const P = plot.periodHrs;
	const xscale = scaleLinear()
		.domain([0, P * plot.doublePlot])
		.range([0, plot.plotwidth]);
	const lo = Math.max(1, m.lineMinDay ?? 1);
	const hi = Math.min(plot.Ndays, m.lineMaxDay ?? plot.Ndays);
	const dx = reg.slope - P;
	const eph = plot.eachplotheight;
	const sb = plot.spaceBetween;
	return {
		x1: xscale(reg.intercept + (lo - 1) * dx) + plot.padding.left,
		y1: plot.padding.top + (lo - 1) * (eph + sb),
		x2: xscale(reg.intercept + hi * dx) + plot.padding.left,
		y2: plot.padding.top + (hi - 1) * (eph + sb) + eph
	};
}

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
});

describe('demo-workflow-free-running actogram: legacy marker blocks', () => {
	it('a legacy onset block still fits both parameters over the real data', () => {
		const [m] = actogramWithMarkers([structuredClone(LEGACY_ONSET)]);
		expect(m.type).toBe('onset');
		expect(m.lockTau).toBe('fit');
		expect(m.lockTheta).toBe('fit');
		expect(m.canFit).toBe(true);

		// 14 onsets are detected from the real binned activity.
		expect(m.markers.length).toBe(14);
		const reg = m.linearRegression;
		// Captured from the code BEFORE the locks existed, and reproduced here to
		// the last bit: the unconstrained path is the same compensated arithmetic.
		expect(reg.slope).toBe(24.74945054945055);
		expect(reg.intercept).toBe(0.3076923076923127);
		expect(reg.rSquared).toBe(0.9999917672864215);
		expect(reg.rmse).toBe(0.2862632089594568);
		expect(m.estimatedPhase).toEqual({ phase: 1.057142857142864, refDay: 1 });
	});

	it('a legacy fitline loads as a line-only manual block and draws identically', () => {
		const [m] = actogramWithMarkers([structuredClone(LEGACY_FITLINE)]);
		// MIGRATION: the `fitline` TYPE is gone; it loads as what it always was,
		// a manual block with no markers and both parameters fixed.
		expect(m.type).toBe('manual');
		expect(m.manualMarkers).toEqual([]);
		expect(m.lockTau).toBe('fixed');
		expect(m.lockTheta).toBe('fixed');
		expect(m.canFit).toBe(false);

		const reg = m.linearRegression;
		// Before the change: slope 24.5, intercept 7.25, Est φ 7.75 @ day 1.
		expect(reg.slope).toBe(24.5);
		expect(reg.intercept).toBe(7.25);
		expect(m.estimatedPhase).toEqual({ phase: 7.75, refDay: 1 });
		// The one deliberate change: the fabricated R² = 1 / RMSE = 0 are gone,
		// because there are no markers to measure this line against.
		expect(reg.rSquared).toBeNull();
		expect(reg.rmse).toBeNull();
		// A line-only block has no marker dots at all.
		expect(m.markers.length).toBe(0);
		expect(m.markerPoints).toBe('');
		// …and it DRAWS exactly where it did before the type was removed. These four
		// numbers were captured from the code that still had the `fitline` type.
		expect(lineEndpoints(m)).toEqual({ x1: 92.5, y1: 30, x2: 162.5, y2: 430 });
	});

	it('the "Add line" preset lands exactly where the old fit line did', () => {
		const { series } = actogramWith([]);
		series.addFitLine();
		const m = series.phaseMarkers[0];
		// The preset is now an ordinary manual block with nothing but a line.
		expect(m.type).toBe('manual');
		expect(m.manualMarkers).toEqual([]);
		expect(m.lockTau).toBe('fixed');
		expect(m.lockTheta).toBe('fixed');
		expect(m.canFit).toBe(false);
		expect(m.markerPoints).toBe('');
		// Same seeds as the old `fitline` preset: slope = periodHrs (no drift),
		// intercept = periodHrs / 2 (mid-plot), spanning every day.
		expect(m.fitSlope).toBe(24);
		expect(m.fitIntercept).toBe(12);
		expect(m.lineMinDay).toBe(1);
		expect(m.lineMaxDay).toBe(14);
		// …which draws a VERTICAL line down the middle: same x top and bottom.
		const ends = lineEndpoints(m);
		expect(ends.x1).toBe(ends.x2);
		expect(ends).toEqual({ x1: 140, y1: 30, x2: 140, y2: 430 });
	});

	it('fixing τ away from the fitted value re-fits θ and worsens the residuals', () => {
		const [m] = actogramWithMarkers([structuredClone(LEGACY_ONSET)]);
		const free = { ...m.linearRegression };
		m.setTau(23.2);
		expect(m.lockTau).toBe('fixed');
		expect(m.lockTheta).toBe('fit');
		expect(m.linearRegression.slope).toBe(23.2);
		expect(m.linearRegression.intercept).not.toBeCloseTo(free.intercept, 2);
		expect(m.linearRegression.rSquared).toBeLessThan(free.rSquared);
		expect(m.linearRegression.rmse).toBeGreaterThan(free.rmse);
	});

	it('fixing θ re-fits τ through the anchor', () => {
		const [m] = actogramWithMarkers([structuredClone(LEGACY_ONSET)]);
		const free = { ...m.linearRegression };
		m.setTheta(5.5);
		expect(m.lockTheta).toBe('fixed');
		expect(m.lockTau).toBe('fit');
		const rd = m.fitRefDay;
		const P = 24;
		expect((m.linearRegression.slope - P) * rd + m.linearRegression.intercept).toBeCloseTo(5.5, 9);
		expect(m.linearRegression.slope).not.toBeCloseTo(free.slope, 3);
		expect(m.linearRegression.rSquared).toBeLessThan(free.rSquared);
	});
});
