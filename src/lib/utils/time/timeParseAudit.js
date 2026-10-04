// @ts-nocheck
// Whole-column check of a text time column, at no extra parsing cost.
//
// Time columns keep their raw strings and are parsed on read (Column.getData), so
// the parse that check needs has already happened: this only counts the non-blank
// inputs that came out missing and, above a small threshold, tells the user which
// column and how many. The import-time guess only samples a column; this is what
// catches a format that fits the sample but not row 40,000.
//
// Reported once per column per (format, raw data) combination, and debounced, so
// typing a format into the Time Format field does not raise a toast per keystroke.
// The notification is queued outside the read because getData runs inside
// $derived/$effect, where writing notification state is not allowed.
import { addNotification } from '$lib/core/notifications.svelte.js';
import { countUnparsedTimes, hasTimeFormat, shouldWarnUnparsedTimes } from './TimeUtils.js';

export const TIME_PARSE_WARNING_DELAY_MS = 1500;

/** colId -> signature of the parse last audited (reported or not). */
const audited = new Map();
/** colId -> pending timer id. */
const pending = new Map();

function signatureOf(col, raw) {
	return `${JSON.stringify(col.timeFormat ?? null)}|${col.data}|${col.rawDataVersion ?? 0}|${raw?.length ?? 0}`;
}

/**
 * Audit one parse of a raw time column. Call with the raw array and the epoch-ms
 * array getData produced from it.
 * @param {{ id: unknown, name?: string, timeFormat: unknown, data: unknown, rawDataVersion?: number }} col
 * @param {unknown[]} raw
 * @param {unknown[]} parsed
 */
export function auditTimeColumnParse(col, raw, parsed) {
	if (!col || !Array.isArray(raw) || !Array.isArray(parsed)) return;
	const sig = signatureOf(col, raw);
	if (audited.get(col.id) === sig) return;
	audited.set(col.id, sig);
	// Any newer parse supersedes a pending warning, including one with no format.
	clearTimeout(pending.get(col.id));
	pending.delete(col.id);
	// No format at all is reported where the format is set (the type-change sniff
	// and the column's Time Format field); numeric epoch ms need none. A node that
	// clears a stale text format from its epoch-ms output (Wide To Long on a session
	// saved before it did) lands here, and must cancel the warning its first read raised.
	if (!hasTimeFormat(col.timeFormat)) return;

	const counts = countUnparsedTimes(raw, parsed);
	if (!shouldWarnUnparsedTimes(counts)) return;

	const fmt = Array.isArray(col.timeFormat) ? col.timeFormat.join(' or ') : col.timeFormat;
	const timer = setTimeout(() => {
		pending.delete(col.id);
		// A newer parse (another format, new data) supersedes this one.
		if (audited.get(col.id) !== sig) return;
		addNotification(
			`${counts.failed} of ${counts.nonBlank} values in "${col.name}" could not be read as times with the format ${fmt} (for example "${counts.example}"). They are treated as missing. Check the column's type and Time Format.`,
			'warning',
			12000
		);
	}, TIME_PARSE_WARNING_DELAY_MS);
	pending.set(col.id, timer);
}

/** Test seam: forget every audited column and cancel pending warnings. */
export function resetTimeParseAudit() {
	for (const t of pending.values()) clearTimeout(t);
	pending.clear();
	audited.clear();
}
