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
import { applyLinkedZoom } from '$lib/plots/plotZoom.js';
import { core } from '$lib/core/core.svelte.js';

/** Plot types that support brush/wheel zoom (drive the toolbar Zoom button). */
export function isZoomCapable(type) {
	return (
		type === 'scatterplot' ||
		type === 'periodogram' ||
		type === 'correlogram' ||
		type === 'fft'
	);
}

const pairEq = (a, b) => (a?.[0] ?? null) === (b?.[0] ?? null) && (a?.[1] ?? null) === (b?.[1] ?? null);
const eitherSet = (a) => a?.[0] != null || a?.[1] != null;

function linX(p, domain) {
	return scaleLinear().domain(domain).range([0, p.plotwidth]);
}
function linY(p, domain) {
	return scaleLinear().domain(domain).range([p.plotheight, 0]);
}

export function getZoomAdapter(plot) {
	const p = plot?.plot;
	if (!p) return null;
	switch (plot?.type) {
		case 'scatterplot':
			return scatterAdapter(plot, p);
		case 'periodogram':
			return periodogramAdapter(p);
		case 'correlogram':
			return correlogramAdapter(p);
		case 'fft':
			return fftAdapter(p);
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
			applyLinkedZoom(
				plot,
				{ xlims: [null, null], ylimsLeft: [null, null], ylimsRight: [null, null] },
				core.plots
			)
	};
}

// Period on X (default [1,30]), power on Y (single).
function periodogramAdapter(p) {
	return {
		axes: [
			{ orient: 'x', scale: () => linX(p, p.periodlimsIN), set: (l) => (p.periodlimsIN = l) },
			{ orient: 'y', scale: () => linY(p, p.ylims), set: (l) => (p.ylimsIN = l) }
		],
		isZoomed: () => !pairEq(p.periodlimsIN, [1, 30]) || eitherSet(p.ylimsIN),
		reset: () => {
			p.periodlimsIN = [1, 30];
			p.ylimsIN = [null, null];
		}
	};
}

// Lag on X, correlation on Y (single); both default auto.
function correlogramAdapter(p) {
	return {
		axes: [
			{ orient: 'x', scale: () => linX(p, p.laglims), set: (l) => (p.laglimsIN = l) },
			{ orient: 'y', scale: () => linY(p, p.ylims), set: (l) => (p.ylimsIN = l) }
		],
		isZoomed: () => eitherSet(p.laglimsIN) || eitherSet(p.ylimsIN),
		reset: () => {
			p.laglimsIN = [null, null];
			p.ylimsIN = [null, null];
		}
	};
}

// Period/frequency on X (default [4,30]), magnitude on Y (linear or log), plus a
// phase Y axis when any series shows phase.
function fftAdapter(p) {
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
		{ orient: 'x', scale: () => linX(p, p.xlims), set: (l) => (p.xlimsIN = l) },
		{ orient: 'y', scale: magScale, set: (l) => (p.ylimsIN = l) }
	];
	if (hasPhase) {
		axes.push({ orient: 'y', scale: () => linY(p, p.phaseYlims), set: (l) => (p.phaseYlimsIN = l) });
	}
	return {
		axes,
		isZoomed: () => !pairEq(p.xlimsIN, [4, 30]) || eitherSet(p.ylimsIN) || eitherSet(p.phaseYlimsIN),
		reset: () => {
			p.xlimsIN = [4, 30];
			p.ylimsIN = [null, null];
			p.phaseYlimsIN = [null, null];
		}
	};
}
