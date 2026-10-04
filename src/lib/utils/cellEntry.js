// cellEntry.js
//
// What a value TYPED into a cell means, for every place a user edits data by hand (the Table
// plot's cells, the Enter Data node's grid, the Edit value process).
//
// The house rule for a missing value is `isInvalidValue` in utils/stats.js: null, a blank
// string or anything Number() cannot read. Before this module the editors stored what that rule
// treats as missing in three different ways, and two of them were wrong: clearing a number cell
// wrote 0 (a real value that then entered every mean), and editing a category cell wrote NaN
// (the label was gone). Here a blank entry is always stored as null, a number column only ever
// receives a finite number or null, and a category column keeps the text the user typed.

/**
 * True when an entry counts as "nothing typed": null/undefined, a blank or whitespace-only
 * string, or NaN (how older sessions stored an empty numeric cell).
 */
export function isBlankEntry(v) {
	if (v == null) return true;
	if (typeof v === 'string') return v.trim() === '';
	if (typeof v === 'number') return Number.isNaN(v);
	return false;
}

/**
 * Read a typed entry as a number. Blank is missing (null); a finite number is kept; anything
 * else is not a number (Infinity included, which no analysis can use).
 * @returns {{ok: true, value: number|null} | {ok: false, reason: string}}
 */
export function parseNumberEntry(v) {
	if (isBlankEntry(v)) return { ok: true, value: null };
	const n = typeof v === 'number' ? v : Number(String(v).trim());
	if (Number.isFinite(n)) return { ok: true, value: n };
	return {
		ok: false,
		reason:
			`"${String(v).trim()}" is not a number. This is a number column: enter a number, ` +
			`or clear the cell to mark the value as missing.`
	};
}

/**
 * The value to STORE for an entry typed into a cell of a column of `type`.
 *   number    finite number, or null when blank; anything else is refused (never NaN).
 *   category  the text as typed, or null when blank.
 * Time cells are not handled here: they edit the column's raw series (see Tableplot).
 * @returns {{ok: true, value: any} | {ok: false, reason: string}}
 */
export function parseCellEntry(type, v) {
	if (type === 'number') return parseNumberEntry(v);
	if (isBlankEntry(v)) return { ok: true, value: null };
	return { ok: true, value: String(v) };
}

/**
 * The Edit value process's `edits` list with the edit at 1-based `position` set to `value`
 * (replacing any edit already there, else appended). Returns a NEW array and never mutates the
 * input, so the change can be recorded as one setProcessArg op.
 * @param {Array<{id?: string, position: number, value: any}>} edits
 * @param {() => string} [makeId]
 */
export function upsertEdit(edits, position, value, makeId = () => crypto.randomUUID()) {
	const list = Array.isArray(edits) ? edits : [];
	const idx = list.findIndex((e) => Number(e.position) === position);
	if (idx >= 0) return list.map((e, i) => (i === idx ? { ...e, value } : e));
	return [...list, { id: makeId(), position, value }];
}
