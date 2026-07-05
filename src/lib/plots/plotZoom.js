// plotZoom.js
//
// Applying brush-zoom limits to a plot, with facet "link-zoom" propagation.
//
// A facet set is one generator plot (`facet` truthy) plus its per-series child
// plots (each carrying `facetParent === generator.id`). Small multiples share
// the X axis (typically time) but each child shows a DIFFERENT series, so the Y
// range is meaningful per-plot. Link-zoom therefore shares the x-range across
// the whole set while keeping y-limits local to the plot the user brushed.
//
// Pure module (no `core`/Svelte import) so callers pass the plot list in and it
// stays unit-testable. Each `plot` is an outer Plot ({ id, facet, facetParent,
// plot }) whose inner `.plot` holds the `*IN` limit-override arrays.

/**
 * @typedef {{ xlims?: (number|null)[], ylimsLeft?: (number|null)[]|null, ylimsRight?: (number|null)[]|null }} Limits
 */

/** Write limit overrides onto one plot's inner model. Missing keys are skipped. */
function applyLimitsToPlot(plot, limits, { xOnly = false } = {}) {
	const p = plot?.plot;
	if (!p) return;
	if (limits.xlims) p.xlimsIN = [...limits.xlims];
	if (xOnly) return;
	if (limits.ylimsLeft) p.ylimsLeftIN = [...limits.ylimsLeft];
	if (limits.ylimsRight) p.ylimsRightIN = [...limits.ylimsRight];
}

/**
 * The facet set a plot belongs to: [generator, ...children]. Returns just
 * [plot] for a standalone plot. Order is not significant to callers.
 * @param {any} plot
 * @param {any[]} allPlots
 * @returns {any[]}
 */
export function facetSetFor(plot, allPlots = []) {
	if (!plot) return [];
	if (plot.facetParent != null) {
		const parentId = plot.facetParent;
		const parent = allPlots.find((q) => q.id === parentId);
		const kids = allPlots.filter((q) => q.facetParent === parentId);
		return parent ? [parent, ...kids] : kids;
	}
	if (plot.facet) {
		return [plot, ...allPlots.filter((q) => q.facetParent === plot.id)];
	}
	return [plot];
}

/**
 * Apply zoom limits to `plot`, propagating the x-range to its facet siblings.
 * The brushed plot gets the full x+y limits; siblings get only the shared x.
 * @param {any} plot   the plot the user brushed
 * @param {Limits} limits
 * @param {any[]} allPlots  full plot list (e.g. core.plots)
 */
export function applyLinkedZoom(plot, limits, allPlots = []) {
	applyLimitsToPlot(plot, limits);
	const set = facetSetFor(plot, allPlots);
	if (set.length <= 1) return;
	for (const member of set) {
		if (member === plot || (member?.id != null && member.id === plot?.id)) continue;
		applyLimitsToPlot(member, limits, { xOnly: true });
	}
}
