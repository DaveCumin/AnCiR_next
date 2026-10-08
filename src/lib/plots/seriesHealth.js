// Why a wired series draws NOTHING — said out loud, where the wiring is.
//
// A series whose inputs cannot compute used to render silence: no curve, no
// message, only a console-side "broken reference" warning nobody sees. The two
// ways a WIRED series goes dead are (1) a wired column that resolves to zero
// rows (its source column or producing node was deleted — the broken-ref
// convention in Column.svelte degrades to `[]`), and (2) paired x/y inputs of
// different lengths, so the plot has no way to pair the points (the classic
// mismatch: an x from one recording, a y from another). Both are wiring
// problems the user can only fix in the Data tab, so that is where the warning
// renders — SeriesBlockHeader shows it under the block title in the same
// `.data-warning` house style Periodogram and Boxplot already use for their
// data-quality cautions.
//
// A block with NO wired channel stays silent: a freshly added series is not
// broken, it is just not wired yet, and the empty pickers already say so.
//
// Reads only (called from $derived in templates): column data comes through the
// same cached getData() the renderers use, so this adds no recompute — and must
// never write $state (the state_unsafe_mutation trap).

/** The column-bearing fields a plot series may carry, with the label the
 *  warning calls each one. `column` is the single-input family
 *  (Histogram / QQPlot / PairsPlot / CorrelationHeatmap). */
const CHANNELS = [
	['x', 'x'],
	['y', 'y'],
	['column', 'input']
];

function isColumnLike(v) {
	return v != null && typeof v === 'object' && typeof v.getData === 'function';
}

/** Wired = the user connected something: a reference to another column, or a
 *  producer-node output. refId -1 is the shared "unwired / broken" default. */
function isWired(col) {
	if (!isColumnLike(col)) return false;
	if (col.producerNodeId != null && col.refId == null) return true;
	return col.refId != null && col.refId !== -1;
}

function rowCount(col) {
	const data = col.getData?.();
	return Array.isArray(data) ? data.length : 0;
}

/**
 * Why this series cannot be computed, or null when it can (or is simply unwired).
 *
 * @param {any} datum one entry of a plot's inner `data` array
 * @param {string} [name] the series' display name, for the message
 * @returns {string | null} requirement/actual/remedy-style message, or null
 */
export function seriesComputeWarning(datum, name = 'this series') {
	if (!datum || typeof datum !== 'object') return null;

	const wired = CHANNELS.filter(([key]) => key in datum && isWired(datum[key]));
	if (wired.length === 0) return null; // not wired yet ≠ broken

	// (1) A wired channel that resolves to no rows: its source is gone or empty.
	for (const [key, label] of wired) {
		if (rowCount(datum[key]) === 0) {
			return (
				`Series "${name}" cannot be computed: the ${label} input needs a column with data, ` +
				`but its wired column provides none (the source may have been deleted or emptied). ` +
				`Re-wire the ${label} input to a column that still has values.`
			);
		}
	}

	// (2) Paired x/y of different lengths: nothing can be paired point-for-point.
	if ('x' in datum && 'y' in datum && isWired(datum.x) && isWired(datum.y)) {
		const nx = rowCount(datum.x);
		const ny = rowCount(datum.y);
		if (nx !== ny) {
			return (
				`Series "${name}" cannot be computed: x and y must provide the same number of values, ` +
				`but x has ${nx} and y has ${ny}. Check the x and y columns are compatible ` +
				`(wired from the same recording).`
			);
		}
	}

	return null;
}

/**
 * Why a density curve (Gaussian KDE) is not drawn for these values, or null when it can be.
 *
 * A KDE estimates the shape of a spread, so it needs at least 2 distinct values. With
 * fewer, the automatic (Silverman) bandwidth is undefined (sample SD 0, or n < 2; see
 * utils/kde.js silvermanBandwidth) or, when rounding leaves the SD a hair above 0 (1,000
 * copies of 0.153 give about 7e-16), an invisible needle. A manual bandwidth would draw
 * one kernel-shaped bump whose width is the bandwidth itself, not anything about the
 * data. Callers skip the curve in all these cases and show this message instead of
 * failing silently. Values are compared exactly, so this is a test for "one value", not
 * for "a very narrow spread".
 *
 * Empty input returns null: a series with no values has its own warnings (above).
 *
 * @param {number[] | null | undefined} values present (finite) values of the series
 * @param {string} [name] the series' display name, for the message
 * @param {{manualBandwidth?: boolean}} [opts] whether the user set a bandwidth
 * @returns {string | null}
 */
export function densityCurveWarning(values, name = 'this series', opts = {}) {
	const n = values?.length ?? 0;
	if (n === 0) return null;
	const first = values[0];
	for (let i = 1; i < n; i++) if (values[i] !== first) return null;

	const shown = Number(first.toPrecision(4));
	const what = n === 1 ? `it has only one value (${shown})` : `every value is the same (${shown})`;
	let msg = `No density curve for "${name}": ${what}, so there is no spread to estimate.`;
	if (opts.manualBandwidth) {
		msg +=
			' With a manual bandwidth it would be a single bump the width of the bandwidth, so it is not drawn.';
	}
	return msg;
}
