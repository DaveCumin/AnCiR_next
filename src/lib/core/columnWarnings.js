// @ts-nocheck
/**
 * Warnings about a column's own data, shown wherever the column is shown (its row in a
 * group card, a data node, the Data panel).
 *
 * Today one: a time column whose times repeat. Multi-file import keeps every row (David,
 * 2026-10-17: "import data simply imports the data (without merging)"), so files that
 * overlap leave times that appear more than once; one file can have them too.
 *
 * Worked out from the data each time it is asked for, never stored: it is right after
 * save and load, and after any edit, with nothing to keep in step. The count is
 * remembered per data array (a column's getData() returns the same array until its
 * data changes), so the several places showing one column count it once.
 */

/** Distinct times that appear more than once; blank cells (null, NaN) are not times. */
export function countRepeatedTimes(values) {
	const seen = new Set();
	const repeated = new Set();
	for (const v of values ?? []) {
		if (v == null || (typeof v === 'number' && !Number.isFinite(v))) continue;
		if (seen.has(v)) repeated.add(v);
		else seen.add(v);
	}
	return repeated.size;
}

/** The warning for `n` repeated times, or null for none. */
export function repeatedTimesWarning(n) {
	if (!(n > 0)) return null;
	const count = n === 1 ? '1 time appears' : `${n.toLocaleString()} times appear`;
	return (
		`${count} more than once (files that overlap, for example). ` +
		'To combine rows that share a time, bin the data (Bin\u00a0Data).'
	);
}

const repeatCounts = new WeakMap();

function repeatedTimesOf(data) {
	if (!data || typeof data !== 'object') return 0;
	let n = repeatCounts.get(data);
	if (n === undefined) {
		n = countRepeatedTimes(data);
		repeatCounts.set(data, n);
	}
	return n;
}

/**
 * The warnings for a column (strings, empty when none). Never throws: a column that
 * cannot be read has nothing to warn about here (its own error shows elsewhere).
 */
export function columnWarnings(col) {
	if (!col || col.type !== 'time') return [];
	try {
		const msg = repeatedTimesWarning(repeatedTimesOf(col.getData()));
		return msg ? [msg] : [];
	} catch {
		return [];
	}
}
