// @ts-check
/**
 * The ONE list of columns a plot series reads.
 *
 * A plot series (one entry of `plot.plot.data`) reads its columns through fixed wrapper
 * fields: `x` and `y` (every x/y plot, including the time-series plots, which store their
 * public `time` / `values` inputs as x / y), `column` (single-input plots: Histogram, Q-Q,
 * Correlation heatmap, Pairs plot) and `z` (vestigial: no plot defines it today, but saved
 * sessions are not checked for it yet, so it stays readable; colour-by plan 2026-10-20,
 * section 9).
 *
 * Until v82.35 that list was spelled out in six places (data hash, chain routes,
 * passthrough ports, chain validation, column delete, ref remapping) plus the Table's
 * column picker, the node catalogue and the MCP session, and they had drifted: column
 * delete and ref remapping knew x/y/z but not `column`, so deleting ANY column emptied
 * every Histogram, Q-Q, Correlation heatmap and Pairs plot, and the Table's "Plots" picker
 * read fields a Plot does not have and never listed anything. Every one of them now asks
 * this module, so a new channel (the colour-by and size-by encodings, colour-by plan
 * section 3.2) is added here once. `seriesChannelRefs.guard.test.js` fails if a
 * hand-written list comes back.
 *
 * Wrapper fields are `$state` accessors on the plot classes, so they are read by name;
 * they do not enumerate.
 */

/**
 * @typedef {object} SeriesChannel
 * @property {string} field      the series field holding the wrapper (`x`, `y`, `z`, `column`)
 * @property {any} holder        the wrapper itself (a Column instance or its plain JSON)
 * @property {any} refId         `holder.refId` as stored (may be -1 or null when unwired)
 * @property {string} display    the plot node's passthrough-port suffix ('' for `column`)
 * @property {'x' | 'y' | null} axis  the passthrough port's axis (null for `column`)
 * @property {boolean} perSeries whether the passthrough port carries a series number
 * @property {boolean} primary   a data channel: a series with no primary column left is
 *                               empty and is dropped on column delete. Encodings are not
 *                               primary: a colour column alone is no series.
 * @property {boolean} passthrough whether the plot node re-exposes the column as a passthrough
 *                               output port. Encodings do not (like overlays: a colour column
 *                               is an encoding of the series, not a series to chain off).
 * @property {string|null} encoding the encoding channel ('colour', 'size') or null for a data channel
 */

// A data channel: drawn, passed through, and what keeps a series alive.
const DATA = { primary: true, passthrough: true, encoding: null };

/**
 * The fixed wrapper fields, in the order every caller has always visited them, then the
 * encodings. `colourBy` is the colour-by column (colour-by plan 2026-10-20, phase 1b): a
 * Column wrapper like x and y, present only while the series has Colour by switched on
 * (ScatterDataclass.colourBy is null otherwise, so a plain series has no extra channel).
 * Its canvas port is `enc<id>_colour` (encodingHost.js), not a passthrough. `sizeBy`, the
 * size-by column, is the same kind of channel (port `enc<id>_size`).
 */
const FIXED_CHANNELS = Object.freeze([
	Object.freeze({ field: 'x', display: 'x', axis: 'x', perSeries: true, ...DATA }),
	Object.freeze({ field: 'y', display: 'y', axis: 'y', perSeries: true, ...DATA }),
	Object.freeze({ field: 'z', display: 'z', axis: 'y', perSeries: true, ...DATA }),
	Object.freeze({ field: 'column', display: '', axis: null, perSeries: false, ...DATA }),
	Object.freeze({
		field: 'colourBy',
		display: 'colour',
		axis: null,
		perSeries: true,
		primary: false,
		passthrough: false,
		encoding: 'colour'
	}),
	// The size-by column (colour-by plan 2026-10-20, phase 3), the same kind of channel; its
	// port is `enc<id>_size`.
	Object.freeze({
		field: 'sizeBy',
		display: 'size',
		axis: null,
		perSeries: true,
		primary: false,
		passthrough: false,
		encoding: 'size'
	})
]);

/** The fixed series fields that hold a column wrapper. */
export const SERIES_COLUMN_FIELDS = Object.freeze(FIXED_CHANNELS.map((c) => c.field));

/** A usable column id (a wired channel): a number, 0 or above. */
export function isWiredRef(refId) {
	return typeof refId === 'number' && refId >= 0;
}

/**
 * Every column channel of one series, wired or not, in field order. A field the series
 * does not have (or holds no wrapper object) is skipped.
 * @param {any} dp a plot series (class instance or plain JSON)
 * @returns {SeriesChannel[]}
 */
export function seriesChannelRefs(dp) {
	/** @type {SeriesChannel[]} */
	const out = [];
	if (!dp || typeof dp !== 'object') return out;
	for (const ch of FIXED_CHANNELS) {
		const holder = dp[ch.field];
		if (!holder || typeof holder !== 'object') continue;
		out.push({ ...ch, holder, refId: holder.refId });
	}
	return out;
}

/** The wired column ids one series reads, in field order (duplicates kept). */
export function seriesColumnIds(dp) {
	return seriesChannelRefs(dp)
		.map((c) => c.refId)
		.filter(isWiredRef);
}

/** True while the series reads `colId` on any channel. */
export function seriesReadsColumn(dp, colId) {
	if (!isWiredRef(colId)) return false;
	return seriesChannelRefs(dp).some((c) => c.refId === colId);
}

/** True while the series still has a wired PRIMARY channel (else it is an empty series). */
export function seriesHasData(dp) {
	return seriesChannelRefs(dp).some((c) => c.primary && isWiredRef(c.refId));
}

/**
 * Re-point every channel of one series: `next(refId)` returns the new id, or the same id
 * to leave the channel alone. Writes in place (keeps each wrapper instance), and only
 * when the id changes.
 * @param {any} dp
 * @param {(refId: any) => any} next
 */
export function remapSeriesRefs(dp, next) {
	for (const c of seriesChannelRefs(dp)) {
		const to = next(c.refId);
		if (to !== c.refId) c.holder.refId = to;
	}
}

/**
 * The distinct wired column ids a plot's inner shows: a Table's `columnRefs`, else every
 * series channel. In first-seen order.
 * @param {any} inner `plot.plot`
 * @returns {number[]}
 */
export function plotColumnIds(inner) {
	const ids = [];
	for (const id of inner?.columnRefs ?? []) if (isWiredRef(id)) ids.push(id);
	for (const dp of inner?.data ?? []) ids.push(...seriesColumnIds(dp));
	return [...new Set(ids)];
}

/** True while a plot's inner shows `colId` (a Table column or any series channel). */
export function plotInnerUsesColumn(inner, colId) {
	if (!isWiredRef(colId)) return false;
	if ((inner?.columnRefs ?? []).includes(colId)) return true;
	return (inner?.data ?? []).some((dp) => seriesReadsColumn(dp, colId));
}
