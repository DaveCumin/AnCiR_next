// Whether a dayjs time format names INSTANTS (it reads a zone offset from the text) or a wall
// clock with no zone. Pure and import-free, so the MCP Worker reads a session file's columns
// exactly as the app does (mcp/src/emit/timeColumns.js). Plan
// ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md, sections 3.2 and 5f.

/**
 * The token grammar dayjs's own format() uses (dayjs/esm/constant REGEX_FORMAT): a [literal]
 * (its text in group 1) or a token.
 */
export const DAYJS_FORMAT_TOKENS =
	/\[([^\]]+)]|Y{1,4}|M{1,4}|D{1,2}|d{1,4}|H{1,2}|h{1,2}|a|A|m{1,2}|s{1,2}|Z{1,2}|SSS/g;

// Time-of-day tokens: a literal Z straight after one is the ISO 8601 UTC designator.
const TIME_OF_DAY_TOKENS = new Set(['H', 'HH', 'h', 'hh', 'm', 'mm', 's', 'ss', 'SSS', 'a', 'A']);

/**
 * `fmt` with a literal `[Z]` that directly follows a time of day ("…HH:mm:ss.SSS[Z]") turned
 * into the offset token `Z`. In ISO 8601 that Z means UTC, so the text names an instant,
 * exactly as "+00:00" does. The import guesser, Sequence Column, Simulate Data, the demos and
 * the MCP render all write it as a literal (it parses to the same UTC instant either way);
 * before plan 5f the app took such a column for a zone-less wall clock, so setting its zone
 * moved every time. A literal Z anywhere else ("[Z]YYYY", "HH:mm [Z]") stays a literal.
 * @param {string} fmt a dayjs format
 * @returns {string}
 */
export function utcDesignatorAsOffset(fmt) {
	if (typeof fmt !== 'string') return fmt;
	let prev = null;
	let out = '';
	let last = 0;
	for (const m of fmt.matchAll(DAYJS_FORMAT_TOKENS)) {
		const adjacent = prev !== null && prev.index + prev[0].length === m.index;
		if (m[1] === 'Z' && adjacent && prev[1] === undefined && TIME_OF_DAY_TOKENS.has(prev[0])) {
			out += fmt.slice(last, m.index) + 'Z';
			last = m.index + m[0].length;
		}
		prev = m;
	}
	return last === 0 ? fmt : out + fmt.slice(last);
}

/** Whether a dayjs format has an offset token (Z or ZZ) outside [literals]. */
export function hasOffsetToken(fmt) {
	for (const m of String(fmt).matchAll(DAYJS_FORMAT_TOKENS)) {
		if (m[1] === undefined && (m[0] === 'Z' || m[0] === 'ZZ')) return true;
	}
	return false;
}

/**
 * Whether one dayjs format reads an offset from the text: a Z or ZZ token, or a literal Z
 * after the time of day (the UTC designator, `utcDesignatorAsOffset`). Its values are
 * instants; a format without one is a wall clock with no zone.
 * @param {string} fmt a dayjs format (TimeUtils.js normalizeTimeFormat translates older ones)
 */
export function formatReadsOffset(fmt) {
	if (typeof fmt !== 'string' || !fmt.trim()) return false;
	return hasOffsetToken(utcDesignatorAsOffset(fmt));
}
