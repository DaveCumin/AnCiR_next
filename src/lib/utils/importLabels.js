// Pure helpers for capturing per-column group/replicate labels during import.
//
// A "group label" (BioDare2 terminology: trace label) tags each data column
// with the biological group / condition it belongs to, so replicates that share
// a label can later be aggregated for grouped analysis. These helpers are the
// risk-bearing logic (string parsing + row detection); the ImportData component
// wires them into the preview UI. Keeping them pure keeps them unit-testable.

/** A value is "numeric-like" if it is a finite number or a string that parses
 * cleanly to one. Empty / whitespace / null count as NOT numeric.
 * @param {*} v */
export function isNumericLike(v) {
	if (v == null) return false;
	if (typeof v === 'number') return Number.isFinite(v);
	const s = String(v).trim();
	if (s === '') return false;
	const n = Number(s);
	return Number.isFinite(n);
}

/**
 * Derive a group label from a column name by stripping a trailing replicate
 * token: an optional separator (space / underscore / hyphen / dot) followed by
 * digits at the end of the name. "WT_1" -> "WT", "LL 12" -> "LL", "S-03" -> "S",
 * "Sample10" -> "Sample". If stripping leaves nothing, or the name has no
 * trailing digits, the original name is returned unchanged.
 *
 * @param {string} name
 * @returns {string}
 */
export function deriveLabelFromName(name) {
	const s = String(name ?? '').trim();
	if (s === '') return s;
	// Optional separator + trailing digits (with optional trailing separator).
	const stripped = s.replace(/[ _.\-]*\d+[ _.\-]*$/, '').trim();
	return stripped === '' ? s : stripped;
}

/**
 * Build a { name -> label } map for a list of column names by deriving each
 * label from its name. Only useful when at least two names collapse to a
 * shared label (i.e. a replicate pattern is present); callers should check
 * `hasReplicatePattern` before offering this as a suggestion.
 *
 * @param {string[]} names
 * @returns {Record<string,string>}
 */
export function deriveLabelsFromNames(names) {
	/** @type {Record<string,string>} */
	const out = {};
	for (const name of names ?? []) {
		out[name] = deriveLabelFromName(name);
	}
	return out;
}

/**
 * True when deriving labels from these names collapses at least two distinct
 * names onto a shared label AND that label differs from the name for those
 * columns (i.e. a real "prefix + replicate index" pattern exists).
 *
 * @param {string[]} names
 * @returns {boolean}
 */
export function hasReplicatePattern(names) {
	const counts = new Map();
	let anyStripped = false;
	for (const name of names ?? []) {
		const label = deriveLabelFromName(name);
		if (label !== name) anyStripped = true;
		counts.set(label, (counts.get(label) ?? 0) + 1);
	}
	if (!anyStripped) return false;
	for (const c of counts.values()) if (c >= 2) return true;
	return false;
}

/**
 * Heuristically detect whether the first data row looks like a row of trace
 * labels rather than data. A column is a "data candidate" when a strong
 * majority of its values BELOW the first row are numeric-like; the first row is
 * flagged as labels when a strong majority of those data-candidate columns have
 * a NON-numeric first-row value.
 *
 * @param {Record<string, any[]>} data  column-oriented preview data
 * @param {string[]} headers  column names to consider
 * @param {object} [opts]
 * @param {number} [opts.threshold=0.6]  majority fraction
 * @param {number} [opts.maxScanRows=25]  how many rows below row 0 to sample
 * @returns {{ rowIndex: number, dataCandidates: string[] } | null}
 */
export function detectLabelRow(data, headers, opts = {}) {
	const threshold = opts.threshold ?? 0.6;
	const maxScanRows = opts.maxScanRows ?? 25;
	if (!data || !Array.isArray(headers) || headers.length === 0) return null;

	const dataCandidates = [];
	let row0NonNumeric = 0;

	for (const col of headers) {
		const arr = data[col];
		if (!Array.isArray(arr) || arr.length < 2) continue;

		const below = arr.slice(1, 1 + maxScanRows);
		const nonEmptyBelow = below.filter((v) => String(v ?? '').trim() !== '');
		if (nonEmptyBelow.length === 0) continue;

		const numericBelow = nonEmptyBelow.filter(isNumericLike).length / nonEmptyBelow.length;
		if (numericBelow < threshold) continue; // not a numeric data column

		dataCandidates.push(col);
		if (!isNumericLike(arr[0]) && String(arr[0] ?? '').trim() !== '') {
			row0NonNumeric++;
		}
	}

	if (dataCandidates.length < 2) return null;
	if (row0NonNumeric / dataCandidates.length < threshold) return null;

	return { rowIndex: 0, dataCandidates };
}

/**
 * Extract row `rowIndex` from each column as a { name -> value(string) } map.
 * Empty cells become '' (no label). Used to turn a picked label row into the
 * per-column label map.
 *
 * @param {Record<string, any[]>} data
 * @param {string[]} headers
 * @param {number} rowIndex
 * @returns {Record<string,string>}
 */
export function extractRowAsLabels(data, headers, rowIndex) {
	/** @type {Record<string,string>} */
	const out = {};
	for (const col of headers ?? []) {
		const v = data?.[col]?.[rowIndex];
		out[col] = v == null ? '' : String(v).trim();
	}
	return out;
}

/**
 * Return a NEW column-oriented data object with `rowIndex` removed from every
 * column array. The original is left untouched. Out-of-range indices are a
 * no-op (returns a shallow copy).
 *
 * @param {Record<string, any[]>} data
 * @param {number} rowIndex
 * @returns {Record<string, any[]>}
 */
export function stripRowFromColumns(data, rowIndex) {
	/** @type {Record<string, any[]>} */
	const out = {};
	for (const key of Object.keys(data ?? {})) {
		const arr = data[key];
		if (Array.isArray(arr) && rowIndex >= 0 && rowIndex < arr.length) {
			out[key] = [...arr.slice(0, rowIndex), ...arr.slice(rowIndex + 1)];
		} else {
			out[key] = Array.isArray(arr) ? [...arr] : arr;
		}
	}
	return out;
}
