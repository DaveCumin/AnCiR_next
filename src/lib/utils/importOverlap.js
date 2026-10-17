/**
 * Rows that share a time across the files of a multi-file import.
 *
 * Daily logger exports often run past midnight into the next file's day, so the
 * same instant appears in two files (the ESF exports overlap by 1 h 36 min). The
 * import concatenates files and keeps every row (David, 2026-10-17: "import data
 * simply imports the data (without merging)"); these helpers only find the shared
 * times so the preview can say so. Combining them is Bin Data's job, after import.
 *
 * The data is the concatenation of every file's rows (column-oriented, as the
 * import holds it) with, per row, its file index (`fileOf`) and its time as an
 * instant (`times`, epoch ms; NaN or null when the row has no readable time).
 * Parsing times is the caller's job, so files written in different time formats
 * match whenever they parse to the same instant.
 *
 * A blank cell is never a disagreement: files differ at a time only where two
 * of them have different values. A time repeated inside one file is not an
 * overlap between files.
 */

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
 * What the overlap is: how many times appear in more than one file, at how many of
 * those times the files' values differ, and the same per set of files (usually a
 * pair of neighbouring files).
 *
 * @param {{ times: ArrayLike<number|null>, fileOf: ArrayLike<number>,
 *   data: Record<string, any[]>, compareColumns?: string[] }} input
 */
export function findTimeOverlaps({ times, fileOf, data, compareColumns = [] }) {
	const groups = sharedTimeGroups(times, fileOf);
	const pairs = new Map();
	let conflicts = 0;
	let conflictCells = 0;
	for (const group of groups) {
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
		conflicts,
		conflictCells,
		pairs: [...pairs.values()].sort((a, b) => a.files[0] - b.files[0] || a.files[1] - b.files[1])
	};
}

const BIN_HINT =
	'All rows are imported. To combine rows that share a time, bin the data after import (Bin\u00a0Data).';

/**
 * The preview's note about times shared between files (a `findTimeOverlaps` report),
 * or null when there are none. Information only: the import keeps every row.
 * @param {{ times: number, conflicts: number } | null} report
 */
export function describeOverlapNote(report) {
	if (!report || !(report.times > 0)) return null;
	const n = report.times;
	const c = report.conflicts ?? 0;
	let first;
	if (n === 1) {
		first =
			c > 0
				? '1 time appears in more than one file, and the files have different values there.'
				: '1 time appears in more than one file, and the files agree there.';
	} else {
		const count = `${n.toLocaleString()} times appear in more than one file`;
		first =
			c > 0
				? `${count}; at ${c.toLocaleString()} of them the files have different values.`
				: `${count}, and the files agree at all of them.`;
	}
	return `${first} ${BIN_HINT}`;
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
