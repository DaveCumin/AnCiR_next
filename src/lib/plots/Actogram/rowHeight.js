/**
 * Height of one actogram row.
 *
 * The plot height is shared by `nRows` rows separated by `spaceBetween` pixels.
 * While a session is still loading the actogram briefly has no rows; dividing by
 * zero then gave an infinite row height, which reached SVG path data as
 * "Infinity" and made the browser reject the marker path. No rows means no row
 * height, so return 0 (and never a negative or non-finite height).
 *
 * @param {number} plotHeight
 * @param {number} nRows
 * @param {number} spaceBetween
 * @returns {number}
 */
export function rowHeight(plotHeight, nRows, spaceBetween) {
	if (!(nRows > 0)) return 0;
	const h = (plotHeight - (nRows - 1) * spaceBetween) / nRows;
	return Number.isFinite(h) && h > 0 ? h : 0;
}

/** The most actogram rows drawn; past it the plot says why instead (see Actogram Ndays). */
export const MAX_ACTOGRAM_ROWS = 20_000;

/**
 * The gap and height the rows are actually drawn with.
 *
 * The user's gap (`spaceBetween`) is kept while every row still gets at least 1 px. A long
 * record in a short plot used to leave the gaps eating the whole height: rowHeight() went to
 * 0 and the actogram drew nothing, silently, from a few hundred rows on (e.g. two years in a
 * 600 px plot). Past that point the gap shrinks so each row keeps 1 px, and once there is
 * less than 1 px per row the gap is 0 and the rows share the height (they are then drawn as
 * one raster image; see actogramRaster.js).
 *
 * @param {number} plotHeight
 * @param {number} nRows
 * @param {number} spaceBetween the user's gap in px
 * @returns {{ gap: number, height: number }}
 */
export function rowGeometry(plotHeight, nRows, spaceBetween) {
	const sb = Number.isFinite(spaceBetween) && spaceBetween > 0 ? spaceBetween : 0;
	const asSet = rowHeight(plotHeight, nRows, sb);
	if (asSet >= 1 || !(nRows > 0) || !(plotHeight > 0)) return { gap: sb, height: asSet };
	if (plotHeight >= nRows) {
		const gap = nRows > 1 ? Math.min(sb, (plotHeight - nRows) / (nRows - 1)) : 0;
		return { gap, height: rowHeight(plotHeight, nRows, gap) };
	}
	return { gap: 0, height: plotHeight / nRows };
}
