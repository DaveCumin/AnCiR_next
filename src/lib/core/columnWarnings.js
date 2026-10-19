// @ts-nocheck
/**
 * Warnings about a column's own data, shown wherever the column is shown (its row in a
 * group card, a data node, the Data panel).
 *
 * Today one: a time column whose times repeat. Multi-file import keeps every row (David,
 * 2026-10-17: "import data simply imports the data (without merging)"), so files that
 * overlap leave times that appear more than once; one file can have them too, and so does
 * long-format data (one row per subject per time).
 *
 * Which advice (David, 2026-10-19, "option 3 with fallback"):
 * - Long format. A category column beside the time column (same group, same node's
 *   outputs) in which every (label, time) pair is unique explains the repeats: the warning
 *   names it and points to Long To Wide. Exact uniqueness; rows with a blank label or a
 *   blank time are left out of the check. The label column must have at least 2 labels,
 *   at most half as many labels as rows (a row-id column is not a grouping), and some time
 *   must still repeat among the labelled rows. Several qualify: the fewest labels wins,
 *   then column order.
 * - A column that marks where rows came from (import's "Source file", Join Data's source
 *   output) is never the label: rows that share a time there are overlapping files or
 *   datasets, and the advice is to bin. See isSourceColumn.
 * - Otherwise a broader text naming both remedies.
 *
 * Worked out from the data each time it is asked for, never stored: it is right after
 * save and load, and after any edit, with nothing to keep in step. Counts are remembered
 * per data array (a column's getData() returns the same array until its data changes), and
 * the long-format check per (time data, label data) pair, so the several places showing
 * one column work it out once.
 */
import { core } from './core.svelte.js';
import { columnDisplayName } from './columnLabels.js';

const NB = ' ';
const BIN_DATA = `Bin${NB}Data`;
const LONG_TO_WIDE = `Long${NB}To${NB}Wide`;

/** Above this many rows the long-format check is skipped (the broader text shows). */
export const LONG_FORMAT_MAX_ROWS = 1_000_000;
/** At most this many label candidates are checked per time column, in column order. */
export const LONG_FORMAT_MAX_CANDIDATES = 8;

/**
 * The shared marker for a column that says where each row came from (a file, a dataset, a
 * node's input). Such a column is never read as a long-format label. A column is one when:
 * - its name (or display name) starts with "Source", "File", "Filename" or "Dataset"
 *   (import names it "Source file", "Source file (2)", ...; Join Data should name its
 *   source output "Source"); or
 * - it is a node output under an out key that matches the same pattern (Join Data's
 *   `out.source`), so renaming it does not change what it is; or
 * - it carries `isSourceColumn === true`; or
 * - every label in it looks like a file name ("a.csv", "mouse3.awd"), so a renamed
 *   "Source file" column still counts.
 */
export const SOURCE_COLUMN_NAME = /^\s*(source|file|filename|dataset)(?![a-z])/i;
const FILE_NAME_VALUE = /\.[a-z][a-z0-9]{0,4}$/i;

/** A blank cell: null, NaN, empty or whitespace-only text (the label rule). */
function isBlank(v) {
	if (v == null) return true;
	if (typeof v === 'number') return !Number.isFinite(v);
	if (typeof v === 'string') return v.trim() === '' || v === 'NaN';
	return false;
}

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

/** The broader warning for `n` repeated times, or null for none. */
export function repeatedTimesWarning(n) {
	if (!(n > 0)) return null;
	const count = n === 1 ? '1 time appears' : `${n.toLocaleString()} times appear`;
	return (
		`${count} more than once. ` +
		`If files or datasets overlap, bin the data (${BIN_DATA}) to combine rows that share a time. ` +
		`If there is one row per subject or group at each time, use ${LONG_TO_WIDE} to give each its own column.`
	);
}

/** The long-format warning: times repeat once per `name`, which has `k` labels. */
export function longFormatWarning(name, k) {
	return (
		`Times repeat once per '${name}' (${k.toLocaleString()} values): this looks like long ` +
		`format (one row per ${name} per time). Use ${LONG_TO_WIDE} to give each ${name} its own column.`
	);
}

/**
 * Does `labels` explain the repeats in `times`? Returns { k, unique, fileNames } where `k`
 * is the number of distinct labels, `unique` that no (label, time) pair repeats AND some
 * time repeats among the labelled rows, and `fileNames` that every label looks like a file
 * name. Stops at the first repeated pair.
 */
export function labelPairs(times, labels) {
	const n = times.length;
	const timesByLabel = new Map();
	const seenTimes = new Set();
	let repeatsAmongLabelled = false;
	let fileNames = true;
	for (let i = 0; i < n; i++) {
		const t = times[i];
		if (t == null || (typeof t === 'number' && !Number.isFinite(t))) continue;
		const l = labels[i];
		if (isBlank(l)) continue;
		let set = timesByLabel.get(l);
		if (!set) {
			set = new Set();
			timesByLabel.set(l, set);
			if (fileNames && !(typeof l === 'string' && FILE_NAME_VALUE.test(l.trim()))) {
				fileNames = false;
			}
		}
		if (set.has(t)) return { k: timesByLabel.size, unique: false, fileNames };
		set.add(t);
		if (seenTimes.has(t)) repeatsAmongLabelled = true;
		else seenTimes.add(t);
	}
	const k = timesByLabel.size;
	return { k, unique: repeatsAmongLabelled, fileNames: fileNames && k > 0 };
}

const repeatCounts = new WeakMap();
const pairResults = new WeakMap();

function repeatedTimesOf(data) {
	if (!data || typeof data !== 'object') return 0;
	let n = repeatCounts.get(data);
	if (n === undefined) {
		n = countRepeatedTimes(data);
		repeatCounts.set(data, n);
	}
	return n;
}

function pairsOf(times, labels) {
	let byLabels = pairResults.get(times);
	if (!byLabels) {
		byLabels = new WeakMap();
		pairResults.set(times, byLabels);
	}
	let r = byLabels.get(labels);
	if (!r) {
		r = labelPairs(times, labels);
		byLabels.set(labels, r);
	}
	return r;
}

/** An array or typed array (compressed time columns read as one). */
function isList(v) {
	return Array.isArray(v) || ArrayBuffer.isView(v);
}

function displayName(col) {
	try {
		return columnDisplayName(col) || col.name || '';
	} catch {
		return col.name ?? '';
	}
}

/** Is column `id` a node output under a source key (Join Data's `out.source`)? */
function isSourceOutput(id) {
	if (id == null) return false;
	for (const tp of core.tableProcesses ?? []) {
		for (const [key, v] of Object.entries(tp?.args?.out ?? {})) {
			if (v === id && SOURCE_COLUMN_NAME.test(key)) return true;
		}
	}
	return false;
}

/** Is `col` a column that says where rows came from (see SOURCE_COLUMN_NAME)? */
export function isSourceColumn(col) {
	if (!col) return false;
	if (col.isSourceColumn === true) return true;
	if (isSourceOutput(col.id)) return true;
	return (
		SOURCE_COLUMN_NAME.test(String(col.name ?? '')) || SOURCE_COLUMN_NAME.test(displayName(col))
	);
}

/**
 * The other columns that share `col`'s container, in order: its group's columns, its
 * table-process node's other outputs, or its producing node's other outputs.
 */
export function columnSiblings(col) {
	if (!col || col.id == null) return [];
	const ids = [];
	const add = (id) => {
		if (typeof id === 'number' && id >= 0 && id !== col.id && !ids.includes(id)) ids.push(id);
	};
	for (const g of core.groups ?? []) {
		const src = g?.sourceColumnIds ?? [];
		if (src.includes(col.id)) src.forEach(add);
	}
	for (const tp of core.tableProcesses ?? []) {
		const outs = Object.values(tp?.args?.out ?? {}).flat();
		if (outs.includes(col.id)) outs.forEach(add);
	}
	if (col.producerNodeId != null) {
		for (const c of core.data ?? []) {
			if (c.producerNodeId === col.producerNodeId) add(c.id);
		}
	}
	const byId = new Map((core.data ?? []).map((c) => [c.id, c]));
	return ids.map((id) => byId.get(id)).filter(Boolean);
}

/**
 * The column that makes `col`'s repeated times long format, as { col, k }, or null. Only
 * category columns of the same length are candidates; source columns never are.
 */
export function longFormatLabel(col, times = col?.getData?.()) {
	if (!isList(times) || times.length > LONG_FORMAT_MAX_ROWS) return null;
	const candidates = columnSiblings(col)
		.filter((c) => c.type === 'category' || c.type === 'text')
		.filter((c) => !isSourceColumn(c))
		.slice(0, LONG_FORMAT_MAX_CANDIDATES);
	let best = null;
	for (const c of candidates) {
		let labels;
		try {
			labels = c.getData();
		} catch {
			continue;
		}
		if (!isList(labels) || labels.length !== times.length) continue;
		const r = pairsOf(times, labels);
		if (!r.unique || r.fileNames || r.k < 2 || r.k > times.length / 2) continue;
		if (!best || r.k < best.k) best = { col: c, k: r.k };
	}
	return best;
}

/**
 * The warnings for a column (strings, empty when none). Never throws: a column that
 * cannot be read has nothing to warn about here (its own error shows elsewhere).
 */
export function columnWarnings(col) {
	if (!col || col.type !== 'time') return [];
	try {
		const times = col.getData();
		const n = repeatedTimesOf(times);
		if (!(n > 0)) return [];
		let label = null;
		try {
			label = longFormatLabel(col, times);
		} catch {
			label = null;
		}
		if (label) return [longFormatWarning(displayName(label.col), label.k)];
		return [repeatedTimesWarning(n)];
	} catch {
		return [];
	}
}
