// @ts-nocheck
// Which rows of a wired column an overlay on a FACET PANEL reads (faceted Periodogram with a
// self-wired `peak_period` line, 2026-10-15).
//
// A plot's metric output (Periodogram `peak_period`, FFT, Correlogram, Q-Q, Actogram) holds one
// value per series, in the generator's data order (plotMetricOutputs.svelte.js). Unfaceted, a
// line wired to it marks every series' peak on the one plot, which is right. A facet panel
// shows only some of those series (`panel.unit.seriesIdx`, generator data indices), so the
// same wire drew every series' peak on every panel. Here the panel keeps only its own rows.
//
// Part of the overlay host contract by duck typing, so every faceted host gets it with no
// per-plot code: a host is a facet panel's inner when `host.parentBox.generator` is set
// (facetPanels.svelte.js). Only the GENERATOR's own per-series metric columns are narrowed; a
// typed value, a column from elsewhere, another plot's metric, and a whole-column output (a
// node-results Table, `portKind: 'column'`) read every row, as before. Pure: no imports but
// the import-free metric definitions.
import { plotOutputsAreMetric } from '$lib/plots/plotMetricDefs.js';

/**
 * The generator data indices a facet panel's overlay should read from column `refId`, or
 * null for "every row" (not a panel, or not one of its generator's per-series metrics).
 * @param {object} host   the overlay's host (a plot's inner data object)
 * @param {number} refId  the wired column's id
 * @returns {number[] | null}
 */
export function facetPanelOverlayRows(host, refId) {
	const panel = host?.parentBox;
	const gen = panel?.generator;
	const rows = panel?.unit?.seriesIdx;
	if (!gen || !Array.isArray(rows) || refId == null) return null;
	if (!plotOutputsAreMetric(gen.type)) return null;
	const own = Object.values(gen.metricOut ?? {}).some((colId) => colId === refId);
	return own ? rows : null;
}
