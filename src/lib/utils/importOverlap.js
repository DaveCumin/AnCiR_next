/**
 * Rows that share a time across the files of a multi-file import.
 *
 * Daily logger exports often run past midnight into the next file's day, so the
 * same instant appears in two files (the ESF exports overlap by 1 h 36 min). The
 * import concatenates files, so without this every overlapping time was imported
 * twice. These helpers find those times and merge them into one row.
 *
 * The data is the concatenation of every file's rows (column-oriented, as the
 * import holds it) with, per row, its file index (`fileOf`) and its time as an
 * instant (`times`, epoch ms; NaN or null when the row has no readable time).
 * Parsing times is the caller's job, so files written in different time formats
 * match whenever they parse to the same instant.
 *
 * Merging is per cell: a merged row takes each column's value from the
 * highest-priority file that has one, so a blank cell in one file is filled from
 * the other and only values that really differ follow the first/last rule.
 * A time repeated inside one file is not an overlap between files and is left alone.
 */

/** 'first': one row per time, the first file's value wins; 'last': the last file's; 'all': keep every row. */
export const OVERLAP_MODES = ['first', 'last', 'all'];
export const DEFAULT_OVERLAP_MODE = 'first';

/** A cell with no value: null, undefined, blank text or NaN. */
export function isMissingCell(v) {
	if (v == null) return true;
	if (typeof v === 'number') return Number.isNaN(v);
	if (typeof v === 'string') return v.trim() === '';
	return false;
}

function sameValue(a, b) {
	if (typeof a === 'string' && typeof b === 'string') return a.trim() === b.trim();
	return a === b;
}

function hasTime(t) {
	return t != null && Number.isFinite(t);
}

/**
 * Times shared by more than one file: for each, the first row of each file that
 * has it, in file order. Only groups spanning two or more files are returned.
 * @returns {number[][]} row indices per shared time, in order of first appearance
 */
function sharedTimeGroups(times, fileOf) {
	const byTime = new Map();
	for (let i = 0; i < times.length; i++) {
		const t = times[i];
		if (!hasTime(t)) continue;
		let g = byTime.get(t);
		if (!g) byTime.set(t, (g = new Map()));
		// The first row of each file at this time; a repeat inside a file stays its own row.
		if (!g.has(fileOf[i])) g.set(fileOf[i], i);
	}
	const groups = [];
	for (const g of byTime.values()) {
		if (g.size < 2) continue;
		groups.push([...g.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row));
	}
	return groups;
}

/** Columns of one shared time whose files hold different values. */
function conflictingCells(group, data, compareColumns) {
	let n = 0;
	for (const col of compareColumns) {
		const values = data[col];
		if (!values) continue;
		let seen;
		let differs = false;
		for (const row of group) {
			const v = values[row];
			if (isMissingCell(v)) continue;
			if (seen === undefined) seen = v;
			else if (!sameValue(seen, v)) differs = true;
		}
		if (differs) n++;
	}
	return n;
}

/**
 * What the overlap is: how many times appear in more than one file, how many rows
 * one-row-per-time removes, at how many of those times the files' values differ,
 * and the same per set of files (usually a pair of neighbouring files).
 *
 * @param {{ times: ArrayLike<number|null>, fileOf: ArrayLike<number>,
 *   data: Record<string, any[]>, compareColumns?: string[] }} input
 */
export function findTimeOverlaps({ times, fileOf, data, compareColumns = [] }) {
	const groups = sharedTimeGroups(times, fileOf);
	const pairs = new Map();
	let extraRows = 0;
	let conflicts = 0;
	let conflictCells = 0;
	for (const group of groups) {
		extraRows += group.length - 1;
		const cells = conflictingCells(group, data, compareColumns);
		if (cells > 0) conflicts++;
		conflictCells += cells;
		const files = group.map((row) => fileOf[row]);
		const key = files.join(',');
		const p = pairs.get(key) ?? { files, times: 0, conflicts: 0 };
		p.times++;
		if (cells > 0) p.conflicts++;
		pairs.set(key, p);
	}
	return {
		times: groups.length,
		extraRows,
		conflicts,
		conflictCells,
		pairs: [...pairs.values()].sort((a, b) => a.files[0] - b.files[0] || a.files[1] - b.files[1])
	};
}

/**
 * One row per shared time (see the module comment), or every row for 'all'.
 * The merged row stays where the time first appears; the import sorts afterwards.
 * With `sourceColumn`, that column names the file that supplied the row's values:
 * the highest-priority file with a value in `compareColumns`.
 *
 * @param {{ data: Record<string, any[]>, times: ArrayLike<number|null>,
 *   fileOf: ArrayLike<number>, keep: 'first'|'last'|'all', compareColumns?: string[],
 *   sourceColumn?: string|null, fileNames?: string[] }} input
 * @returns {{ data: Record<string, any[]>, removed: number }}
 */
export function mergeOverlappingRows({
	data,
	times,
	fileOf,
	keep,
	compareColumns = [],
	sourceColumn = null,
	fileNames = []
}) {
	if (keep === 'all') return { data, removed: 0 };
	const groups = sharedTimeGroups(times, fileOf);
	if (groups.length === 0) return { data, removed: 0 };

	const cols = Object.keys(data);
	const out = {};
	for (const col of cols) out[col] = data[col].slice();
	const drop = new Uint8Array(times.length);
	for (const group of groups) {
		const keepRow = group[0];
		const priority = keep === 'last' ? [...group].reverse() : group;
		for (const col of cols) {
			if (col === sourceColumn) continue;
			const values = data[col];
			const from = priority.find((row) => !isMissingCell(values[row]));
			if (from !== undefined) out[col][keepRow] = values[from];
		}
		if (sourceColumn && out[sourceColumn]) {
			const supplier =
				priority.find((row) => compareColumns.some((c) => !isMissingCell(data[c]?.[row]))) ??
				priority[0];
			out[sourceColumn][keepRow] = fileNames[fileOf[supplier]] ?? data[sourceColumn][supplier];
		}
		for (const row of group) if (row !== keepRow) drop[row] = 1;
	}
	const merged = {};
	for (const col of cols) merged[col] = out[col].filter((_, i) => !drop[i]);
	let removed = 0;
	for (let i = 0; i < drop.length; i++) removed += drop[i];
	return { data: merged, removed };
}

/** The earliest and latest instant among `times` (rows without a time ignored), or null. */
export function timeRange(times) {
	let first = Infinity;
	let last = -Infinity;
	for (const t of times) {
		if (!hasTime(t)) continue;
		if (t < first) first = t;
		if (t > last) last = t;
	}
	return first === Infinity ? null : { first, last };
}
