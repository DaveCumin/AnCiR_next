// @ts-nocheck
// Scalar-metric OUTPUT PORTS for analysis plots (Periodogram / FFT /
// Correlogram): the peak stats each plot computes per series, exposed as real
// columns (one value per series, in plot-data order) so they can be wired
// downstream exactly like a table process's metric ports.
//
// The columns are tracked in `plot.metricOut` ({ key → colId }, persisted with
// the session). Reconcile + writes are driven by EACH PLOT COMPONENT's own
// metric effect (call usePlotMetricOutputs from the component), piggybacking
// on the values the component already computes to render its stats panel.
//
// Deliberately NOT a global effect: to track the stats, an effect must READ
// them, and Correlogram/FFT stats sit behind synchronous full-series
// $deriveds (acfData/fftData). Evaluating those eagerly outside the component
// — e.g. repeatedly while a session/demo is still being seeded, on partial
// data that hits computeAutocorrelation's non-uniform O(n·lags²) slow path —
// froze the main thread. Inside the component the read is free (the template
// already computed it, $derived memoises) and runs on complete data.
import { Column, getColumnById, removeColumn } from '$lib/core/Column.svelte';
import { core, pushObj } from '$lib/core/core.svelte.js';
import { writeOutputColumn } from '$lib/tableProcesses/outputColumns.js';

/**
 * Per-plot-type metric definitions. `statsFor(datum)` reads the same deriveds
 * the plot's stats panel shows (visiblePeak preferred, matching the display
 * and the legacy StoreValueButton getters).
 */
export const PLOT_METRIC_DEFS = {
	periodogram: {
		keys: ['peak_period', 'peak_power'],
		statsFor(datum) {
			const p = datum?.visiblePeak ?? datum?.peak;
			return { peak_period: p?.period ?? NaN, peak_power: p?.power ?? NaN };
		}
	},
	fft: {
		keys: ['peak_period', 'peak_frequency', 'peak_magnitude'],
		statsFor(datum) {
			const p = datum?.visiblePeak ?? datum?.peak;
			return {
				peak_period: p?.period ?? NaN,
				peak_frequency: p?.frequency ?? NaN,
				peak_magnitude: p?.magnitude ?? NaN
			};
		}
	},
	correlogram: {
		keys: ['peak_lag', 'peak_correlation'],
		statsFor(datum) {
			const p = datum?.visiblePeak ?? datum?.peak;
			return { peak_lag: p?.lag ?? NaN, peak_correlation: p?.correlation ?? NaN };
		}
	}
};

/** True when this plot should carry metric output columns. */
function isMetricPlot(plot) {
	return plot && plot.facetParent == null && PLOT_METRIC_DEFS[plot.type] != null;
}

/**
 * Read the current per-series stats for one plot (reactive: touches the data
 * classes' peak deriveds). One entry per plot-data point, in data order.
 */
export function plotMetricStats(plot) {
	const def = PLOT_METRIC_DEFS[plot?.type];
	if (!def) return [];
	return (plot.plot?.data ?? []).map((datum) => def.statsFor(datum));
}

/**
 * Create/remove this plot's metric out-columns to match its type's keys.
 * Constructs Columns — call only from onMount / a microtask-deferred effect
 * (never synchronously inside an $effect: derived_inert).
 */
export function syncPlotMetricColumns(plot) {
	if (!plot.metricOut || typeof plot.metricOut !== 'object') plot.metricOut = {};
	// Plain array (a handful of keys, local + throwaway — not reactive state).
	const desired = isMetricPlot(plot) ? PLOT_METRIC_DEFS[plot.type].keys : [];
	let changed = false;

	for (const key of Object.keys(plot.metricOut)) {
		if (desired.includes(key)) continue;
		const colId = plot.metricOut[key];
		if (colId != null && colId >= 0) {
			core.rawData.delete(colId);
			removeColumn(colId);
		}
		delete plot.metricOut[key];
		changed = true;
	}

	for (const key of desired) {
		if (Number(plot.metricOut[key]) >= 0 && getColumnById(plot.metricOut[key])) continue;
		const col = new Column({});
		// Same naming convention as table-process metric out-columns.
		col.name = `${key}_${plot.id}`;
		pushObj(col);
		plot.metricOut[key] = col.id;
		changed = true;
	}

	return changed;
}

/** Write the current stats into the plot's metric columns (one value per series). */
export function writePlotMetricOutputs(plot, statsBySeries = plotMetricStats(plot)) {
	const def = PLOT_METRIC_DEFS[plot?.type];
	if (!def) return;
	const processHash = crypto.randomUUID();
	for (const key of def.keys) {
		writeOutputColumn(
			plot.metricOut?.[key],
			statsBySeries.map((s) => s?.[key] ?? NaN),
			{ processHash }
		);
	}
}

/**
 * Component hook: call once from a metric plot component's instance script
 * (the `which === 'plot'` instance) with a getter for the wrapper Plot.
 * Tracks the per-series stats the component already computes for display and
 * keeps `plot.metricOut` columns reconciled + written. Column CREATION is
 * deferred out of the effect (new Column() under an active reaction goes
 * derived_inert).
 *
 * Svelte requires $effect at component init — hence a hook, not a plain call.
 * @param {() => object} getPlot - returns the wrapper Plot (theData)
 * @param {() => boolean} isActive - e.g. () => which === 'plot'
 */
// Last-written stats snapshot per plot: unrelated effect re-runs (e.g. a zoom
// that doesn't move the visible peak) skip the write — every write stamps a
// fresh processHash, which would otherwise ripple hash bumps downstream.
const _lastWrittenStats = new WeakMap();

export function usePlotMetricOutputs(getPlot, isActive) {
	$effect(() => {
		if (!isActive()) return;
		const plot = getPlot();
		if (!isMetricPlot(plot)) return;
		// Track: per-series stats (already memoised by the data classes'
		// deriveds) + the series list itself.
		const stats = plotMetricStats(plot);
		const snapshot = JSON.stringify(stats);
		queueMicrotask(() => {
			const columnsChanged = syncPlotMetricColumns(plot);
			if (!columnsChanged && _lastWrittenStats.get(plot) === snapshot) return;
			_lastWrittenStats.set(plot, snapshot);
			writePlotMetricOutputs(plot, stats);
		});
	});
}

/** Delete the metric out-columns of plots being removed (called by deletePlotIds). */
export function removePlotMetricColumns(plot) {
	for (const colId of Object.values(plot?.metricOut ?? {})) {
		if (colId == null || colId < 0) continue;
		core.rawData.delete(colId);
		removeColumn(colId);
	}
	if (plot?.metricOut) plot.metricOut = {};
}
