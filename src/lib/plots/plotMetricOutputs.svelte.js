// @ts-nocheck
// Scalar-metric OUTPUT PORTS for analysis plots (Periodogram / FFT / Actogram /
// Correlogram / Q-Q): the stats each plot computes per series (spectral peaks,
// or the Q-Q plot's probability-plot correlation), exposed as real columns
// (one value per series, in plot-data order) so they can be wired downstream
// exactly like a table process's metric ports.
//
// The columns are tracked in `plot.metricOut` ({ key → colId }, persisted with
// the session). Reconcile + writes are driven by EACH PLOT COMPONENT's own
// metric effect (call usePlotMetricOutputs from the component), piggybacking
// on the values the component already computes to render its stats panel.
//
// ONE writer per plot, in every view and facet state: the plot's own component
// instance. Unfaceted, that is the instance on screen (`which === 'plot'`). A
// facet GENERATOR is never on screen (only its derived panels are, and panels
// carry no metric outputs), so the facet host mounts the generator's component
// once, headless, as `which === 'compute'` (FacetGeneratorCompute.svelte): it
// runs the generator's calculation and metric effects and renders nothing. The
// facet flag picks exactly one of the two branches, so they never coexist; the
// shared last-written snapshot below also makes a toggle write nothing when the
// stats did not change. Without the headless instance a faceted plot's ports
// went stale (v77.0 regression): FFT/Correlogram stats sit in deriveds nobody
// read, and the Periodogram's spectrum is $state filled only by the component's
// own calculation effect, so no headless READ could have kept it current.
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
import { PLOT_METRIC_DEFS, plotMetricKeys, plotMetricColumnName } from './plotMetricDefs.js';

export * from './plotMetricDefs.js';

/** Whether a plot type has metric output columns (Periodogram, FFT, Correlogram, Q-Q, Actogram). */
export function hasPlotMetrics(type) {
	return PLOT_METRIC_DEFS[type] != null;
}

/**
 * Whether a plot component instance mounted as `which` owns its plot's calculation and
 * metric outputs: the on-screen instance (`'plot'`) or the headless one a facet host mounts
 * for its generator (`'compute'`). The controls instance never does.
 */
export function ownsPlotMetrics(which) {
	return which === 'plot' || which === 'compute';
}

/**
 * True when this plot should carry metric output columns. Only a Plot in core.plots does:
 * a facet panel (facetPanels.svelte.js) has no `metricOut`, and its generator already
 * emits one value per series, which IS the per-panel metric (written by the generator's
 * headless instance while faceted, see the header).
 */
function isMetricPlot(plot) {
	return plot && plot.generator == null && PLOT_METRIC_DEFS[plot.type] != null;
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
	const desired = isMetricPlot(plot) ? plotMetricKeys(plot) : [];
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
		// Same naming convention as table-process metric out-columns (a rule's columns carry
		// its name: 'Onsets_tau_0'; a rename rewrites them in the same undo step).
		col.name = plotMetricColumnName(plot, key);
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
	for (const key of plotMetricKeys(plot)) {
		writeOutputColumn(
			plot.metricOut?.[key],
			statsBySeries.map((s) => s?.[key] ?? NaN),
			{ processHash }
		);
	}
}

/**
 * Component hook: call once from a metric plot component's instance script
 * (active for the instance `ownsPlotMetrics(which)` accepts) with a getter for
 * the wrapper Plot.
 * Tracks the per-series stats the component already computes for display and
 * keeps `plot.metricOut` columns reconciled + written. Column CREATION is
 * deferred out of the effect (new Column() under an active reaction goes
 * derived_inert).
 *
 * Svelte requires $effect at component init — hence a hook, not a plain call.
 * @param {() => object} getPlot - returns the wrapper Plot (theData)
 * @param {() => boolean} isActive - e.g. () => ownsPlotMetrics(which)
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
