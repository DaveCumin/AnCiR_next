// Single source of truth for rendering user-visible date/time strings.
//
// All callers (tooltips, table previews, datetime-local inputs, axis labels)
// should go through these helpers so that switching `appState.displayTimezone`
// updates every label in the app at once. Default zone is UTC.

import dayjs from './dayjsSetup.js';
import { appState } from '$lib/core/core.svelte';

export function getDisplayZone() {
	return appState.displayTimezone ?? 'utc';
}

// Build a dayjs instance from a millisecond timestamp anchored to the
// configured display zone. Kept private so callers don't have to remember
// the utc-vs-tz dance themselves.
function dtAt(ms) {
	const zone = getDisplayZone();
	return zone === 'utc' ? dayjs.utc(ms) : dayjs(ms).tz(zone);
}

// Format a millisecond timestamp using the configured display zone.
// `fmt` is a moment-style format string (e.g. 'D MMM YYYY, HH:mm').
export function formatDateTime(ms, fmt = 'D MMM YYYY, HH:mm') {
	if (ms == null || Number.isNaN(Number(ms))) return '';
	const dt = dtAt(Number(ms));
	if (!dt.isValid()) return '';
	return dt.format(fmt);
}

// YYYY-MM-DDTHH:mm:ss in the display zone, suitable for the `value`
// of an <input type="datetime-local">.
export function formatDateTimeLocalInput(ms) {
	return formatDateTime(ms, 'YYYY-MM-DD[T]HH:mm:ss');
}

// Parse the string an <input type="datetime-local"> emits, treating it as
// wall-clock time in the display zone. Returns ms, or NaN if unparseable.
export function parseDateTimeLocalInput(str) {
	if (!str) return NaN;
	const zone = getDisplayZone();
	// `<input type="datetime-local">` produces "YYYY-MM-DDTHH:mm" or
	// "YYYY-MM-DDTHH:mm:ss" — dayjs parses both via its built-in ISO path.
	const dt = zone === 'utc' ? dayjs.utc(str) : dayjs.tz(str, zone);
	return dt.isValid() ? dt.valueOf() : NaN;
}
