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
 * @param {{ label?: string, y?: { name?: string }, parentPlot?: { data?: any[] } }} datum
 * @returns {string}
 */
export function seriesDisplayLabel(datum) {
	if (!datum) return '';
	if (datum.label) return datum.label;
	const yName = datum.y?.name;
	if (yName) return yName;
	const siblings = datum.parentPlot?.data;
	const idx = Array.isArray(siblings) ? siblings.indexOf(datum) : -1;
	return 'Data ' + (idx >= 0 ? idx + 1 : (siblings?.length ?? 0) + 1);
}
