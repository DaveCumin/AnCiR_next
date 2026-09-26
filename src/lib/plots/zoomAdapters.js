// zoomAdapters.js
//
// Per-plot-type zoom adapter: the single place that knows each point plot's
// axis-limit field names, scales, and reset defaults. Consumed by the shared
// brush/wheel controller (plotZoomController.js) and the selection toolbar
// (isZoomed / reset), so neither has to branch on plot type.
//
// An adapter is: {
//   axes: [{ orient:'x'|'y', scale():d3scale, set(lims) }],  // for brush/wheel
//   isZoomed(): boolean,                                     // toolbar Reset state
//   reset(): void                                            // toolbar/dblclick reset
// }

import { scaleLinear, scaleLog } from 'd3-scale';
import { applyLinkedZoom, writeAxisLimit } from '$lib/plots/plotZoom.js';

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
	const setX = (key) => (l) => writeAxisLimit(plot, key, l, { shared: true });
	const setY = (key) => (l) => writeAxisLimit(plot, key, l);
	switch (plot?.type) {
		case 'scatterplot':
			return scatterAdapter(plot, p);
		case 'periodogram':
			return periodogramAdapter(p, setX, setY);
		case 'correlogram':
			return correlogramAdapter(p, setX, setY);
		case 'fft':
			return fftAdapter(p, setX, setY);
		default:
			return null;
	}
}

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

// Period on X (default [1,30]), power on Y (single).
function periodogramAdapter(p, setX, setY) {
	return {
		axes: [
			{ orient: 'x', scale: () => linX(p, p.periodlimsIN), set: setX('periodlimsIN') },
			{ orient: 'y', scale: () => linY(p, p.ylims), set: setY('ylimsIN') }
		],
		isZoomed: () => !pairEq(p.periodlimsIN, [1, 30]) || eitherSet(p.ylimsIN),
		reset: () => {
			setX('periodlimsIN')([1, 30]);
			setY('ylimsIN')([null, null]);
		}
	};
}

// Lag on X, correlation on Y (single); both default auto.
function correlogramAdapter(p, setX, setY) {
	return {
		axes: [
			{ orient: 'x', scale: () => linX(p, p.laglims), set: setX('laglimsIN') },
			{ orient: 'y', scale: () => linY(p, p.ylims), set: setY('ylimsIN') }
		],
		isZoomed: () => eitherSet(p.laglimsIN) || eitherSet(p.ylimsIN),
		reset: () => {
			setX('laglimsIN')([null, null]);
			setY('ylimsIN')([null, null]);
		}
	};
}

// Period/frequency on X (default [4,30]), magnitude on Y (linear or log), plus a
// phase Y axis when any series shows phase.
function fftAdapter(p, setX, setY) {
	const magScale = () => {
		if (p.logScale && p.ylims[0] > 0 && p.ylims[1] > 0) {
			return scaleLog()
				.domain([Math.max(p.ylims[0], 1e-6), p.ylims[1]])
				.range([p.plotheight, 0]);
		}
		return linY(p, p.ylims);
	};
	const hasPhase = p.data?.some((d) => d.showPhase);
	const axes = [
		{ orient: 'x', scale: () => linX(p, p.xlims), set: setX('xlimsIN') },
		{ orient: 'y', scale: magScale, set: setY('ylimsIN') }
	];
	if (hasPhase) {
		axes.push({
			orient: 'y',
			scale: () => linY(p, p.phaseYlims),
			set: setY('phaseYlimsIN')
		});
	}
	return {
		axes,
		isZoomed: () =>
			!pairEq(p.xlimsIN, [4, 30]) || eitherSet(p.ylimsIN) || eitherSet(p.phaseYlimsIN),
		reset: () => {
			setX('xlimsIN')([4, 30]);
			setY('ylimsIN')([null, null]);
			setY('phaseYlimsIN')([null, null]);
		}
	};
}
