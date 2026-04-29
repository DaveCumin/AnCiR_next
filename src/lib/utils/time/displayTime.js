// Single source of truth for rendering user-visible date/time strings.
//
// All callers (tooltips, table previews, datetime-local inputs, axis labels)
// should go through these helpers so that switching `appState.displayTimezone`
// updates every label in the app at once. Default zone is UTC.

import { DateTime } from 'luxon';
import { appState } from '$lib/core/core.svelte';

export function getDisplayZone() {
	return appState.displayTimezone ?? 'utc';
}

// Format a millisecond timestamp using the configured display zone.
// `fmt` is either a Luxon preset object (e.g. DateTime.DATETIME_MED) or a
// Luxon format string (e.g. "d LLL, HH:mm").
export function formatDateTime(ms, fmt = DateTime.DATETIME_MED) {
	if (ms == null || Number.isNaN(Number(ms))) return '';
	const dt = DateTime.fromMillis(Number(ms), { zone: getDisplayZone() });
	if (!dt.isValid) return '';
	return typeof fmt === 'string' ? dt.toFormat(fmt) : dt.toLocaleString(fmt);
}

// YYYY-MM-DDTHH:mm:ss in the display zone, suitable for the `value`
// of an <input type="datetime-local">.
export function formatDateTimeLocalInput(ms) {
	return formatDateTime(ms, "yyyy-LL-dd'T'HH:mm:ss");
}

// Parse the string an <input type="datetime-local"> emits, treating it as
// wall-clock time in the display zone. Returns ms, or NaN if unparseable.
export function parseDateTimeLocalInput(str) {
	if (!str) return NaN;
	const dt = DateTime.fromISO(str, { zone: getDisplayZone() });
	return dt.isValid ? dt.toMillis() : NaN;
}
