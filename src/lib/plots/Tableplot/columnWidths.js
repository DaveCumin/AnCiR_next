// Column widths for the Tableplot grid.
//
// A column the user has resized keeps that width. Every other ("auto") column
// shares the width left over, so a table that fits its box fills it with no
// horizontal scrollbar and no dead gutter on the right, and a column name gets
// as much room as the box allows before its header has to wrap. Auto widths are
// clamped: never so narrow a short value is cut, never so wide a two-column
// table in a full-screen view turns into two long bars. When the box width is
// not known yet (first render), auto columns use the old fixed default.
//
// An auto column is also never narrower than its header's longest WORD (capped at
// MAX_AUTO_COL_W): headers wrap at spaces, but a single word wider than the column
// ("Rhythmicity" in an 80px column) could only be broken mid-word. Columns that need
// that much take it first; the others share what is left.

export const DEFAULT_COL_W = 130;
export const MIN_COL_W = 56; // floor for a user resize
export const MIN_AUTO_COL_W = 80;
export const MAX_AUTO_COL_W = 240;
// Horizontal space a header cell spends on other than its text, when it cannot be read
// off the rendered header: the cell's 12px padding each side and 1px right border
// (.tp-th in Tableplot.svelte), plus the editable name's own 4px padding and 1px border
// each side (Editable.svelte).
export const HEADER_PAD_X = 35;

/**
 * Minimum width each column's header needs so its longest word fits on one line.
 * @param {Record<string, string>} headers  colId -> header text
 * @param {(word: string) => number} measure px width of a word in the header font
 * @param {number} [padX] px the header cell spends around its text
 * @returns {Record<string, number>} colId -> px (0 for an empty header)
 */
export function headerMinWidths(headers, measure, padX = HEADER_PAD_X) {
	const out = {};
	for (const [id, text] of Object.entries(headers ?? {})) {
		let longest = 0;
		for (const word of String(text ?? '').split(/\s+/)) {
			if (word) longest = Math.max(longest, measure(word) || 0);
		}
		out[id] = longest > 0 ? Math.ceil(longest + padX) : 0;
	}
	return out;
}

/**
 * @param {Array<string|number>} colIds   visible columns, in order
 * @param {Record<string, number>} fixed  user-set widths (colId -> px)
 * @param {number} available              inner width of the scroll box (px); 0 = unknown
 * @param {number} [reserved]             px already taken (e.g. the row-number column)
 * @param {Record<string, number>} [minWidths] content minimum per column (headerMinWidths)
 * @returns {Record<string, number>} colId -> px for every column in colIds
 */
export function columnWidths(colIds, fixed, available, reserved = 0, minWidths = {}) {
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
	// The least an auto column may be: the auto floor, or its header's longest word.
	const floorOf = (id) => {
		const m = Number(minWidths?.[id]);
		return Math.min(MAX_AUTO_COL_W, Math.max(MIN_AUTO_COL_W, Number.isFinite(m) ? m : 0));
	};
	if (!(Number.isFinite(available) && available > 0)) {
		for (const id of auto) widths[id] = Math.max(DEFAULT_COL_W, floorOf(id));
		return widths;
	}
	// Columns whose floor is above the fair share take their floor; the rest share what is
	// left. Repeat, since each one taken out lowers the share for the others.
	let pool = available - used;
	let rest = auto;
	for (;;) {
		// floor: the columns must never sum past the box, or a 1px scrollbar appears.
		const share = Math.floor(pool / rest.length);
		const needy = rest.filter((id) => floorOf(id) > share);
		if (needy.length === 0) {
			const each = Math.min(MAX_AUTO_COL_W, Math.max(MIN_AUTO_COL_W, share));
			for (const id of rest) widths[id] = each;
			break;
		}
		for (const id of needy) {
			widths[id] = floorOf(id);
			pool -= widths[id];
		}
		rest = rest.filter((id) => !needy.includes(id));
		if (rest.length === 0) break;
	}
	return widths;
}
