// Column widths for the Tableplot grid.
//
// A column the user has resized keeps that width. Every other ("auto") column
// shares the width left over, so a table that fits its box fills it with no
// horizontal scrollbar and no dead gutter on the right, and a column name gets
// as much room as the box allows before its header has to wrap. Auto widths are
// clamped: never so narrow a short value is cut, never so wide a two-column
// table in a full-screen view turns into two long bars. When the box width is
// not known yet (first render), auto columns use the old fixed default.

export const DEFAULT_COL_W = 130;
export const MIN_COL_W = 56; // floor for a user resize
export const MIN_AUTO_COL_W = 80;
export const MAX_AUTO_COL_W = 240;

/**
 * @param {Array<string|number>} colIds   visible columns, in order
 * @param {Record<string, number>} fixed  user-set widths (colId -> px)
 * @param {number} available              inner width of the scroll box (px); 0 = unknown
 * @param {number} [reserved]             px already taken (e.g. the row-number column)
 * @returns {Record<string, number>} colId -> px for every column in colIds
 */
export function columnWidths(colIds, fixed, available, reserved = 0) {
	const widths = {};
	const auto = [];
	let used = reserved;
	for (const id of colIds) {
		const w = fixed?.[id];
		if (Number.isFinite(w)) {
			widths[id] = w;
			used += w;
		} else {
			auto.push(id);
		}
	}
	if (auto.length === 0) return widths;
	let each = DEFAULT_COL_W;
	if (Number.isFinite(available) && available > 0) {
		// floor: the columns must never sum past the box, or a 1px scrollbar appears.
		each = Math.floor((available - used) / auto.length);
		each = Math.min(MAX_AUTO_COL_W, Math.max(MIN_AUTO_COL_W, each));
	}
	for (const id of auto) widths[id] = each;
	return widths;
}
