// @ts-nocheck
// Numbers saved as TEXT in a number column become numbers when a session loads (David,
// 2026-10-25).
//
// The app writes a number column's values as JSON numbers, but a session written by hand, by a
// script or by an older MCP draft can hold "12.5". Analyses compare and add their inputs as
// numbers and met strings instead: Column Function's add joined "10.0" and "0.5" into
// "10.00.5". Only Correlation coerced (v82.61, utils/correlation.js). Converting once, here,
// protects every analysis.
//
// The rule, per saved data array of a column whose type is 'number':
//   - text that reads as a number under the importer's rule (numberFromText: "8.4", " 7 ",
//     "1e3") becomes that number;
//   - blank or whitespace-only text becomes null, the app's missing value (cellEntry.js);
//   - any other text stays as written, exactly as a CSV import leaves a word in a number
//     column. Every analysis reads it as missing (stats.js isInvalidValue), and the column
//     says so in its warnings (columnWarnings.js nonNumericTextWarning), worked out from the
//     data each time, so the warning is right after save and reload too.
// Numbers, nulls and anything that is not a string are untouched. Time and category columns
// are untouched, and so is an array that a non-number column also reads.
//
// Byte for byte: a session that already stores numbers comes back as the SAME object (no
// copy), so it loads exactly as before. An array is copied only when it holds a string.
//
// Mirrored in tools/ancir_runtime.py (Column.get_data, coerce_numeric_text) and
// tools/ancir_runtime.R (col_data, .coerce_numeric_text). Pure (JSON in, JSON out, no app
// state), run by importJson before anything is built; the input is never mutated.
import { numberFromText } from '$lib/utils/importColumnTypes.js';

const BLANK = /^\s*$/;

/**
 * One value as the load reads it: numeric text to its number, blank text to null, anything
 * else as it is.
 */
export function readNumericText(v) {
	if (typeof v !== 'string') return v;
	if (BLANK.test(v)) return null;
	const n = numberFromText(v);
	return n === null ? v : n;
}

/** `values` with its text read (readNumericText), or the same array when it holds no text. */
export function coerceNumericText(values) {
	if (!Array.isArray(values)) return values;
	let i = 0;
	const n = values.length;
	while (i < n && typeof values[i] !== 'string') i++;
	if (i === n) return values;
	const out = values.slice();
	for (; i < n; i++) {
		const v = out[i];
		if (typeof v === 'string') out[i] = readNumericText(v);
	}
	return out;
}

const isList = (v) => Array.isArray(v);

/**
 * @param {any} json a parsed session
 * @returns {{ json: any, columns: number[] }} the session (the same object when nothing
 *   changed) and the ids of the columns whose saved values were read.
 */
export function migrateNumericText(json) {
	const columns = Array.isArray(json?.data) ? json.data : [];
	const raw = json?.rawData && typeof json.rawData === 'object' ? json.rawData : null;
	const changed = [];

	if (raw) {
		// The rawData keys only number columns read; a key a time or category column also
		// reads keeps its text.
		const numberKeys = new Set();
		const otherKeys = new Set();
		for (const c of columns) {
			if (c?.refId != null || c?.data == null || typeof c.data === 'object') continue;
			(c.type === 'number' ? numberKeys : otherKeys).add(String(c.data));
		}
		let nextRaw = null;
		for (const key of numberKeys) {
			if (otherKeys.has(key) || !isList(raw[key])) continue;
			const read = coerceNumericText(raw[key]);
			if (read === raw[key]) continue;
			nextRaw ??= { ...raw };
			nextRaw[key] = read;
		}
		if (!nextRaw) return { json, columns: changed };
		for (const c of columns) {
			if (
				c?.type === 'number' &&
				c.refId == null &&
				nextRaw[String(c.data)] !== raw[String(c.data)]
			)
				changed.push(c.id);
		}
		return { json: { ...json, rawData: nextRaw }, columns: changed };
	}

	// Legacy sessions (no rawData): each column record carries its own values.
	let nextData = null;
	columns.forEach((c, i) => {
		if (c?.type !== 'number' || c.refId != null || !isList(c.data)) return;
		const read = coerceNumericText(c.data);
		if (read === c.data) return;
		nextData ??= columns.slice();
		nextData[i] = { ...c, data: read };
		changed.push(c.id);
	});
	return nextData
		? { json: { ...json, data: nextData }, columns: changed }
		: { json, columns: changed };
}
