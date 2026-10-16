// zoomAdapters.js
//
// Per-plot-type zoom adapter: the single place that knows each point plot's
// axis-limit field names, scales, and reset defaults. Consumed by the shared
// brush/wheel controller (plotZoomController.js) and the selection toolbar
// (isZoomed / reset), so neither has to branch on plot type.
//
// An adapter is: {
//   axes: [{ orient:'x'|'y', scale():d3scale, key, shared, set(lims) }],  // for brush/wheel
//   apply(writes, opts): void   // several axes at once: [{ axis, lims }], ONE undo step
//   isZoomed(): boolean,        // toolbar Reset state
//   reset(): void               // toolbar/dblclick reset, ONE undo step
// }
// Every write goes through plotZoom.writeAxisLimits, so a zoom is an undo step; `set` is one
// axis on its own.

import { scaleLinear } from 'd3-scale';
import { applyLinkedZoom, writeAxisLimits } from '$lib/plots/plotZoom.js';

/** Plot types that support brush/wheel zoom (drive the toolbar Zoom button). */
export function isZoomCapable(type) {
	return (
		type === 'scatterplot' || type === 'periodogram' || type === 'correlogram' || type === 'fft'
	);
}

const pairEq = (a, b) =>
	(a?.[0] ?? null) === (b?.[0] ?? null) && (a?.[1] ?? null) === (b?.[1] ?? null);
const eitherSet = (a) => a?.[0] != null || a?.[1] != null;

function linX(p, domain) {
	return scaleLinear().domain(domain).range([0, p.plotwidth]);
}
function linY(p, domain) {
	return scaleLinear().domain(domain).range([p.plotheight, 0]);
}

/**
 * @param plot a Plot or a FacetPanel (the workspace and the toolbar hand over whichever
 *   they render). Reads come off its inner (`plot.plot`: a panel's projected instance, so an
 *   override shows as zoomed); writes go through `writeAxisLimit`, which on a panel sends an
 *   x axis to the generator (shared by every panel) and a y axis to the panel's override.
 */
export function getZoomAdapter(plot) {
	const p = plot?.plot;
	if (!p) return null;
	// An axis that zooms: its scale, and the limit key it writes (x is shared by a facet set).
	const X = (key, scale) => axis('x', key, scale, true);
	const Y = (key, scale) => axis('y', key, scale, false);
	function axis(orient, key, scale, shared) {
		return { orient, key, shared, scale, set: (l) => apply([{ axis: { key, shared }, lims: l }]) };
	}
	function apply(writes, opts) {
		writeAxisLimits(
			plot,
			writes.map((w) => ({ key: w.axis.key, value: w.lims, shared: w.axis.shared })),
			opts
		);
	}
	const withApply = (adapter) => (adapter ? { ...adapter, apply } : null);
	switch (plot?.type) {
		case 'scatterplot':
			return scatterAdapter(plot, p);
		case 'periodogram':
			return withApply(periodogramAdapter(p, X, Y, apply));
		case 'correlogram':
			return withApply(correlogramAdapter(p, X, Y, apply));
		case 'fft':
			return withApply(fftAdapter(p, X, Y, apply));
		default:
			return null;
	}
}

/** One reset of several axes: [axis, lims] pairs, ONE undo step. */
const resetAll = (apply, pairs) => apply(pairs.map(([axis, lims]) => ({ axis, lims })));

// Scatterplot keeps its own inline brush/wheel handlers (facet link-zoom), so its
// adapter only serves the toolbar: isZoomed + a facet-aware reset. No `axes`.
function scatterAdapter(plot, p) {
	return {
		isZoomed: () => eitherSet(p.xlimsIN) || eitherSet(p.ylimsLeftIN) || eitherSet(p.ylimsRightIN),
		reset: () =>
			applyLinkedZoom(plot, {
				xlims: [null, null],
				ylimsLeft: [null, null],
				ylimsRight: [null, null]
			})
	};
}

// Period on X (default [1,30]), power on Y (single; linear or log, the scale it is drawn with).
function periodogramAdapter(p, X, Y, apply) {
	const x = X('periodlimsIN', () => linX(p, p.periodlimsIN));
	const y = Y('ylimsIN', () => p.yScale ?? linY(p, p.ylims));
	return {
		axes: [x, y],
		isZoomed: () => !pairEq(p.periodlimsIN, [1, 30]) || eitherSet(p.ylimsIN),
		reset: () =>
			resetAll(apply, [
				[x, [1, 30]],
				[y, [null, null]]
			])
	};
}

// Lag on X, correlation on Y (single); both default auto.
function correlogramAdapter(p, X, Y, apply) {
	const x = X('laglimsIN', () => linX(p, p.laglims));
	const y = Y('ylimsIN', () => linY(p, p.ylims));
	return {
		axes: [x, y],
		isZoomed: () => eitherSet(p.laglimsIN) || eitherSet(p.ylimsIN),
		reset: () =>
			resetAll(apply, [
				[x, [null, null]],
				[y, [null, null]]
			])
	};
}

// Period/frequency on X (default [4,30]), magnitude on Y (linear or log), plus a
// phase Y axis when any series shows phase.
function fftAdapter(p, X, Y, apply) {
	// The scale the magnitudes are drawn with (log with its own lower end, plots/logAxis.js).
	// It used to rebuild a log scale from the LINEAR limits, and fell back to linear whenever
	// the linear lower limit was 0 (the default), so a brush on a log plot zoomed elsewhere.
	const magScale = () => p.yScale ?? linY(p, p.ylims);
	const hasPhase = p.data?.some((d) => d.showPhase);
	const x = X('xlimsIN', () => linX(p, p.xlims));
	const y = Y('ylimsIN', magScale);
	const phase = Y('phaseYlimsIN', () => linY(p, p.phaseYlims));
	const axes = [x, y];
	if (hasPhase) axes.push(phase);
	return {
		axes,
		isZoomed: () =>
			!pairEq(p.xlimsIN, [4, 30]) || eitherSet(p.ylimsIN) || eitherSet(p.phaseYlimsIN),
		reset: () =>
			resetAll(apply, [
				[x, [4, 30]],
				[y, [null, null]],
				[phase, [null, null]]
			])
	};
}
