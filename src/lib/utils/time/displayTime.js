// Single source of truth for rendering user-visible date/time strings.
//
// All callers (tooltips, table previews, datetime-local inputs, axis labels) go through these
// helpers. Since the per-column time zone (STAT-18, plan
// ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md) a time is shown according to:
//
//   1. a LEGACY session (saved before per-column zones with a non-UTC "Timezone" setting):
//      every time in that one zone, exactly as before. The zone lives in
//      `appState.displayTimezone`, which is 'utc' for every other session.
//   2. "Show times in" (`appState.showTimesIn`): 'column' (the default) shows each time in
//      its own column's zone; a zone there is a DISPLAY override that relabels every time.
//   3. the column's time frame (core/columnTimeZone.js): its zone, and whether its stored ms
//      are the wall clock read as UTC (`wall`, a zone-less text column: shown "As written")
//      or true instants (text with offsets, epoch ms).
//
// Helpers take an optional `zoneOf`: the Column the time belongs to (its `timeFrame` is
// read), a frame `{ zone, wall }`, or a zone name (a true instant in that zone). Omitted,
// the time is treated as a zone-less UTC column, which is how every time was shown before.
//
// Clock-time ANALYSIS (actogram day starts, clock phase, hour-of-day colour, light bands,
// the Bin Data start field) does not follow "Show times in" (decision 2). Each reads its
// column's clock (core/columnTimeZone.js `columnClock`): a legacy session's one zone, else
// the column's own zone (a zone-less column as written). `getClockZone()` is that clock for
// a time with no column.

import { appState } from '$lib/core/core.svelte';
import {
	UTC_ZONE,
	normalizeZone,
	dayjsInZone,
	parseInZone,
	wallClockToInstant,
	instantToWallClock,
	zoneLabel
} from './zones.js';

/** The "Show times in" value meaning "each column's own zone". */
export const COLUMN_ZONE = 'column';

/** How 'utc' reads for a zone-less text column: its times are kept exactly as the file wrote them. */
export const AS_WRITTEN_LABEL = 'As written (no zone, UTC)';

/** The frame of a time with no column: a zone-less, "as written" UTC column. */
export const DEFAULT_TIME_FRAME = Object.freeze({ zone: UTC_ZONE, wall: true });

/**
 * The zone a legacy session relabels every time in, or null for every other session.
 * A session saved before per-column zones with a non-UTC "Timezone" setting keeps that
 * meaning (display AND clock-time analysis) until it is converted in Settings.
 */
export function getLegacyZone() {
	const z = appState?.displayTimezone;
	if (typeof z !== 'string' || z === '' || z.toLowerCase() === UTC_ZONE) return null;
	return z;
}

/**
 * The clock zone of a time that belongs to no column (a date input with no column, an AI
 * edit's light band on a plot with no time series): the legacy zone, else 'utc', what those
 * read before per-column zones. A time of a column reads `columnClock(col)` instead
 * (core/columnTimeZone.js), which applies the legacy zone first.
 */
export function getClockZone() {
	return getLegacyZone() ?? UTC_ZONE;
}

/** "Show times in": COLUMN_ZONE, or the zone every time is relabelled in. */
export function getShowTimesIn() {
	const v = appState?.showTimesIn;
	if (v == null || v === COLUMN_ZONE) return COLUMN_ZONE;
	return normalizeZone(v) ?? COLUMN_ZONE;
}

/**
 * Read a `zoneOf` argument as a time frame `{ zone, wall }`.
 * @param {unknown} zoneOf a Column (anything with `timeFrame`), a frame, a zone name, or null
 */
export function toTimeFrame(zoneOf) {
	if (zoneOf == null) return DEFAULT_TIME_FRAME;
	if (typeof zoneOf === 'string') return { zone: normalizeZone(zoneOf) ?? UTC_ZONE, wall: false };
	if (typeof zoneOf === 'object') {
		const f = 'timeFrame' in zoneOf ? zoneOf.timeFrame : zoneOf;
		if (f && typeof f.zone === 'string') {
			return { zone: normalizeZone(f.zone) ?? UTC_ZONE, wall: f.wall !== false };
		}
	}
	return DEFAULT_TIME_FRAME;
}

/**
 * Where a stored time is shown: the instant to format and the zone to format it in.
 * @returns {{ ms: number, zone: string }}
 */
function shownAt(ms, zoneOf) {
	const legacy = getLegacyZone();
	if (legacy) return { ms, zone: legacy };
	const frame = toTimeFrame(zoneOf);
	const show = getShowTimesIn();
	if (show === COLUMN_ZONE) {
		// A zone-less column's ms ARE its wall clock (read as UTC): shown as written.
		return frame.wall ? { ms, zone: UTC_ZONE } : { ms, zone: frame.zone };
	}
	const instant = frame.wall && frame.zone !== UTC_ZONE ? wallClockToInstant(ms, frame.zone) : ms;
	return { ms: instant, zone: show };
}

/**
 * The zone a time of this column is shown in, for a label beside a time ("Times in
 * Pacific/Auckland"). A zone-less UTC column reads 'UTC'.
 */
export function shownZoneLabel(zoneOf, opts = {}) {
	const legacy = getLegacyZone();
	if (legacy) return zoneLabel(legacy, opts);
	const show = getShowTimesIn();
	if (show !== COLUMN_ZONE) return zoneLabel(show, opts);
	return zoneLabel(toTimeFrame(zoneOf).zone, opts);
}

/** A dayjs instance for the stored time `ms`, in the zone it is shown in. */
export function zonedDayjs(ms, zoneOf = null) {
	const at = shownAt(Number(ms), zoneOf);
	return dayjsInZone(at.ms, at.zone);
}

/**
 * Parse a time typed as it is shown (the inverse of `formatDateTime` with the same
 * `zoneOf`) back to the stored ms, or NaN. `fmt` omitted reads ISO text, as
 * <input type="datetime-local"> emits.
 */
export function parseShownTime(text, fmt = null, zoneOf = null) {
	if (!text) return NaN;
	const legacy = getLegacyZone();
	if (legacy) return parseInZone(text, fmt, legacy);
	const frame = toTimeFrame(zoneOf);
	const show = getShowTimesIn();
	if (show === COLUMN_ZONE) return parseInZone(text, fmt, frame.wall ? UTC_ZONE : frame.zone);
	const instant = parseInZone(text, fmt, show);
	return frame.wall && frame.zone !== UTC_ZONE ? instantToWallClock(instant, frame.zone) : instant;
}

/**
 * The format offered wherever a user can override a date label: the actogram's row labels
 * and a scatterplot's x ticks. Lives here so the two cannot drift apart, and so a future
 * third caller inherits the same suggestion rather than inventing one.
 *
 * 'DD MMM' ⇒ "05 Aug".
 */
export const DEFAULT_DATE_FORMAT = 'DD MMM';

// Format a stored time as it is shown (see the header). `fmt` is a moment-style format
// string (e.g. 'D MMM YYYY, HH:mm'); `zoneOf` the column the time belongs to.
export function formatDateTime(ms, fmt = 'D MMM YYYY, HH:mm', zoneOf = null) {
	if (ms == null || Number.isNaN(Number(ms))) return '';
	const dt = zonedDayjs(Number(ms), zoneOf);
	if (!dt.isValid()) return '';
	return dt.format(fmt);
}

// YYYY-MM-DDTHH:mm:ss as the time is shown, suitable for the `value`
// of an <input type="datetime-local">.
export function formatDateTimeLocalInput(ms, zoneOf = null) {
	return formatDateTime(ms, 'YYYY-MM-DD[T]HH:mm:ss', zoneOf);
}

// Parse the string an <input type="datetime-local"> emits as a time shown with the same
// `zoneOf` (the inverse of formatDateTimeLocalInput). Returns ms, or NaN if unparseable.
// `<input type="datetime-local">` produces "YYYY-MM-DDTHH:mm" or "YYYY-MM-DDTHH:mm:ss";
// dayjs parses both via its built-in ISO path.
export function parseDateTimeLocalInput(str, zoneOf = null) {
	return parseShownTime(str, null, zoneOf);
}

// Multi-resolution tick label for a time-based plot axis. Picks the most
// concise format that still distinguishes ticks at the displayed resolution,
// in the zone the axis's column is shown in. Mirrors d3-scale's scaleUtc
// auto-formatter; we override d3's default purely to honour that zone.
export function formatTimeAxisTick(ms, zoneOf = null) {
	const pattern = autoTickPattern(ms, zoneOf);
	return pattern ? zonedDayjs(Number(ms), zoneOf).format(pattern) : '';
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
export function autoTickPattern(ms, zoneOf = null) {
	const n = Number(ms);
	if (ms == null || Number.isNaN(n)) return null;
	const dt = zonedDayjs(n, zoneOf);
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
 * @param {unknown} [zoneOf] the axis's column (see the header)
 * @returns {string|null}
 */
export function dominantTickPattern(values, zoneOf = null) {
	const counts = new Map();
	for (const v of values ?? []) {
		const pattern = autoTickPattern(v instanceof Date ? v.getTime() : v, zoneOf);
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
			n > bestN ||
			(n === bestN && PATTERN_COARSENESS.indexOf(pattern) > PATTERN_COARSENESS.indexOf(best));
		if (better) {
			best = pattern;
			bestN = n;
		}
	}
	return best;
}

/** The cascade's patterns, finest first. Used only to break a tie deterministically. */
const PATTERN_COARSENESS = ['[.]SSS', '[:]ss', 'HH:mm', 'D MMM', 'MMM', 'YYYY'];

/**
 * Tick positions for a time axis, placed on round times of the zone the axis is SHOWN in, or
 * null when d3's own UTC ticks already are (a zone-less column shown as written, a UTC
 * column, a legacy session; all exactly as before).
 *
 * d3's scaleUtc puts ticks on UTC midnights and hours. Shown in +13:00 those read "13:00,
 * 01:00, 13:00" with no date at all. Here the domain is mapped to the wall clock it is shown
 * as, d3 picks round ticks THERE, and each is mapped back to a stored ms, so the axis reads
 * "5 Apr, 12:00, 6 Apr" in the zone. Phase 2 (actogram rows in a column zone) can reuse it.
 *
 * @param {[number|Date, number|Date]} domain the axis domain (stored ms)
 * @param {number|undefined} count d3's tick count hint
 * @param {unknown} zoneOf the axis's column (see the header)
 * @param {(domain: [number, number], count: number|undefined) => Date[]} utcTicks d3's
 *   scaleUtc tick picker over a domain (passed in so this module needs no d3)
 * @returns {Date[]|null}
 */
export function zoneAlignedTicks(domain, count, zoneOf, utcTicks) {
	if (getLegacyZone()) return null;
	const frame = toTimeFrame(zoneOf);
	const show = getShowTimesIn();
	const shownZone = show === COLUMN_ZONE ? (frame.wall ? UTC_ZONE : frame.zone) : show;
	// Stored ms -> the instant shown, and back.
	const convertsWall = show !== COLUMN_ZONE && frame.wall && frame.zone !== UTC_ZONE;
	if (shownZone === UTC_ZONE && !convertsWall) return null;
	const toInstant = (ms) => (convertsWall ? wallClockToInstant(ms, frame.zone) : ms);
	const fromInstant = (ms) => (convertsWall ? instantToWallClock(ms, frame.zone) : ms);
	const [d0, d1] = domain.map(Number);
	if (!Number.isFinite(d0) || !Number.isFinite(d1)) return null;
	const w0 = instantToWallClock(toInstant(d0), shownZone);
	const w1 = instantToWallClock(toInstant(d1), shownZone);
	const lo = Math.min(d0, d1);
	const hi = Math.max(d0, d1);
	const out = [];
	for (const t of utcTicks([w0, w1], count)) {
		const ms = fromInstant(wallClockToInstant(+t, shownZone));
		if (ms >= lo && ms <= hi) out.push(new Date(ms));
	}
	return out;
}
