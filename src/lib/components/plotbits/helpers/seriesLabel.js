/**
 * The label to DISPLAY for a plot data series (legend, tooltip, CSV header, the
 * per-series row in the Data tab).
 *
 * A series carries an explicit `label` string only once the user has typed one.
 * While it is blank we fall back to the NAME OF THE WIRED Y COLUMN, so a freshly
 * wired series reads as e.g. "activity" rather than an opaque "Data 1" / "Data
 * 2". If no y column is wired yet (a blank series), we fall back to the
 * positional "Data N" so the row is still identifiable in the editor.
 *
 * Reactive by construction: reading `datum.label`, `datum.y.name` and
 * `datum.parentPlot.data` each track their reactive source, so the displayed
 * label follows a rewire or a column rename with no extra bookkeeping.
 *
 * @param {{ label?: string, y?: { name?: string }, column?: { name?: string },
 *   parentPlot?: { data?: any[] } }} datum
 * @param {{ fallback?: string }} [options] `fallback` replaces the positional
 *   "Data N" tier only — a wired name or user label still wins. PairsPlot and
 *   CorrelationHeatmap call their series "Variable N".
 * @returns {string}
 */
/**
 * The name to show for a series' wired column wrapper.
 *
 * A plot series holds a thin REFERENTIAL wrapper (`{ refId }`) around the real
 * column, and `Column.name` marks such a wrapper as a reference by appending
 * `*` to the referenced column's name. That marker is right in column lists,
 * wrong in a legend: the user wired "activity", not "activity*". Session load
 * used to hide this by pre-filling every wrapper's `customName`, but a wrapper
 * rebuilt by any `setPlotInner` op (a wire, a series delete, an overlay edit)
 * starts with no customName and the legend flipped to "activity*" mid-session.
 * So read the referenced column's own name; a name the user gave the wrapper
 * (`customName`) still wins, and a plain `{ name }` stand-in still works.
 */
function wiredName(col) {
	if (!col) return undefined;
	if (col.customName != null && col.customName !== '') return col.customName;
	// A real Column tells us whether it is a reference; a referential wrapper
	// with nothing behind it (a blank `{ refId: -1 }` slot, or a reference whose
	// column was deleted) has no name to show: `Column.name` would give a bare
	// "*", which is not a label. Plain stand-ins (tests, stub plots) keep `name`.
	if (typeof col.isReferencial === 'function' && col.isReferencial()) {
		return col.refColumn?.name || undefined;
	}
	return col.name;
}

export function seriesDisplayLabel(datum, options = {}) {
	if (!datum) return options.fallback ?? '';
	if (datum.label) return datum.label;
	// Most plots wire a `y` column per series; PairsPlot / CorrelationHeatmap /
	// CircularPhase-style series bind a single `column` instead.
	const yName = wiredName(datum.y) ?? wiredName(datum.column);
	if (yName) return yName;
	if (options.fallback != null) return options.fallback;
	const siblings = datum.parentPlot?.data;
	const idx = Array.isArray(siblings) ? siblings.indexOf(datum) : -1;
	return 'Data ' + (idx >= 0 ? idx + 1 : (siblings?.length ?? 0) + 1);
}
