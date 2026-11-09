// The order of the groups on a categorical x axis (Boxplot, Mean +/- SEM).
//
// Text groups keep the order they first appear in the data, as the user entered or imported
// them ("control, early, late" was being drawn as an alphabetical list, which put a control in
// the middle of a time course as soon as it was named "baseline" or "zeitgeber"). Groups that
// are ALL numbers (days 1 .. 10, hours of day) are drawn in numeric order, which is the order a
// reader expects and is not alphabetical ("10" before "2"). There is no user-set order yet; this
// is the automatic one.

/** True when `v` reads as a finite number ('' and whitespace do not). */
export function isNumberLike(v) {
	if (typeof v === 'number') return Number.isFinite(v);
	if (typeof v !== 'string' || v.trim() === '') return false;
	return Number.isFinite(Number(v));
}

/**
 * @template T
 * @param {Iterable<T>} firstSeen  the distinct groups, in the order they first appear
 * @returns {T[]}
 */
export function orderCategories(firstSeen) {
	const list = Array.from(firstSeen);
	if (list.length > 1 && list.every(isNumberLike)) {
		return list.sort((a, b) => Number(a) - Number(b));
	}
	return list;
}

/**
 * Per-group statistics (utils/meanSem.js meanSemByGroup, which sorts its groups) put in the same
 * order: by first appearance (each group's first row, `rows[0]`) unless every group is a number.
 * @template {{x: unknown, rows: number[]}} S
 * @param {S[]} stats
 * @returns {S[]}
 */
export function orderGroupStats(stats) {
	if (stats.length < 2 || stats.every((s) => isNumberLike(s.x))) return stats;
	return [...stats].sort((a, b) => (a.rows?.[0] ?? 0) - (b.rows?.[0] ?? 0));
}

/** More numeric groups than this on a box plot's x is almost certainly a continuous column. */
export const MAX_NUMERIC_GROUPS = 24;

/**
 * A warning when a categorical x has been given a numeric column with so many distinct values
 * that each number became its own group (time in hours, a measurement), or null.
 * @param {unknown[]} groups  the distinct groups drawn
 * @param {string} [columnName]
 * @returns {string|null}
 */
export function numericGroupsWarning(groups, columnName = '') {
	if (!Array.isArray(groups) || groups.length <= MAX_NUMERIC_GROUPS) return null;
	if (!groups.every(isNumberLike)) return null;
	const what = columnName ? `"${columnName}"` : 'The x column';
	return `${what} is numeric with ${groups.length} distinct values, so each value is drawn as its own group. Use a column of group names (or bin the values first) for groups, or a scatterplot for a numeric x.`;
}
