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
