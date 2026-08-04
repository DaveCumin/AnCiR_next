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

/**
 * The format offered wherever a user can override a date label: the actogram's row labels
 * and a scatterplot's x ticks. Lives here so the two cannot drift apart, and so a future
 * third caller inherits the same suggestion rather than inventing one.
 *
 * 'DD MMM' ⇒ "05 Aug".
 */
export const DEFAULT_DATE_FORMAT = 'DD MMM';

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

// Multi-resolution tick label for a time-based plot axis. Picks the most
// concise format that still distinguishes ticks at the displayed resolution,
// in the configured displayTimezone. Mirrors d3-scale's scaleUtc auto-formatter
// — we override d3's default purely to honour the user's chosen zone.
export function formatTimeAxisTick(ms) {
	const pattern = autoTickPattern(ms);
	return pattern ? dtAt(Number(ms)).format(pattern) : '';
}

/**
 * The format string `formatTimeAxisTick` would use for this tick, or null when there is no
 * usable instant.
 *
 * Split out so the UI can SHOW the format in use rather than the word "Automatic". A user
 * who wants to nudge the labels needs somewhere to start, and "D MMM" is a far better
 * starting point than a blank box. Because the formatter now runs off this same table, the
 * pattern shown and the pattern drawn cannot drift apart.
 */
export function autoTickPattern(ms) {
	const n = Number(ms);
	if (ms == null || Number.isNaN(n)) return null;
	const dt = dtAt(n);
	if (!dt.isValid()) return null;

	if (dt.millisecond() !== 0) return '[.]SSS';
	if (dt.second() !== 0) return '[:]ss';
	if (dt.minute() !== 0 || dt.hour() !== 0) return 'HH:mm';
	if (dt.date() !== 1) return 'D MMM';
	if (dt.month() !== 0) return 'MMM';
	return 'YYYY';
}

/**
 * The pattern most of an axis's ticks are using.
 *
 * The cascade is per-tick, so an axis genuinely can mix formats: midnight on the 1st of a
 * month reads "MMM" while its neighbours read "D MMM". There is therefore no single true
 * answer, and the most common one is the honest approximation — it is a starting point
 * offered to the user, not a claim about every label.
 *
 * @param {Iterable<number|Date>} values the tick values
 * @returns {string|null}
 */
export function dominantTickPattern(values) {
	const counts = new Map();
	for (const v of values ?? []) {
		const pattern = autoTickPattern(v instanceof Date ? v.getTime() : v);
		if (pattern) counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
	}
	let best = null;
	let bestN = 0;
	for (const [pattern, n] of counts) {
		// Ties go to the COARSER pattern. A half-daily axis splits exactly evenly between
		// 'HH:mm' (the noons) and 'D MMM' (the midnights), and "5 Aug" is what such an axis
		// reads as; resolving by insertion order instead picked whichever tick came first,
		// which is how the box once said HH:mm under an axis labelled 5 Aug … 8 Aug.
		const better =
			n > bestN || (n === bestN && PATTERN_COARSENESS.indexOf(pattern) > PATTERN_COARSENESS.indexOf(best));
		if (better) {
			best = pattern;
			bestN = n;
		}
	}
	return best;
}

/** The cascade's patterns, finest first. Used only to break a tie deterministically. */
const PATTERN_COARSENESS = ['[.]SSS', '[:]ss', 'HH:mm', 'D MMM', 'MMM', 'YYYY'];
