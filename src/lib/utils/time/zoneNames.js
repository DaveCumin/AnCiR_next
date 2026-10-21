// @ts-nocheck
// Time zone NAMES as the app stores them (per-column time zone, STAT-18): which strings are
// zones, their canonical form and how a person reads them. Pure, with no imports, so the MCP
// Worker (mcp/worker) and its session normalizer (mcp/src/emit/normalizer.js) refuse and store
// a zone exactly as the app does. Re-exported by zones.js, which every app module imports.
//
// A zone is one of three things, stored as a string:
//
//   'utc'        the default ("As written" for text with no offset)
//   '+13:00'     a FIXED offset (±HH:MM), for a logger whose clock never changes for
//                daylight saving. Never `Etc/GMT-13`: the Etc sign is inverted.
//   IANA name    'Pacific/Auckland', which follows that zone's daylight saving.
//
// Plan: ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md, sections 3.1 and 3.9.

export const UTC_ZONE = 'utc';

const FIXED_RE = /^([+-])(\d{2}):?(\d{2})$/;

/** Whether `z` is written as a fixed offset (±HH:MM or ±HHMM). Not validated for range. */
export function isFixedOffset(z) {
	return typeof z === 'string' && FIXED_RE.test(z.trim());
}

/** Minutes east of UTC for a fixed offset text ('+05:30' → 330, '-0400' → -240), else null. */
export function fixedOffsetMinutes(z) {
	const m = typeof z === 'string' ? FIXED_RE.exec(z.trim()) : null;
	if (!m) return null;
	const hours = Number(m[2]);
	const mins = Number(m[3]);
	if (hours > 14 || mins > 59) return null;
	const total = hours * 60 + mins;
	return m[1] === '-' ? -total : total;
}

/** '+05:30' for 330, '-04:00' for -240. 0 gives '+00:00' (callers map it to 'utc'). */
export function formatFixedOffset(minutes) {
	const sign = minutes < 0 ? '-' : '+';
	const abs = Math.abs(Math.round(minutes));
	const hh = String(Math.floor(abs / 60)).padStart(2, '0');
	const mm = String(abs % 60).padStart(2, '0');
	return `${sign}${hh}:${mm}`;
}

const ianaValid = new Map();
/** Whether Intl knows `name` as an IANA zone (cached). */
export function isIanaZone(name) {
	if (ianaValid.has(name)) return ianaValid.get(name);
	let ok = false;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: name });
		ok = true;
	} catch {
		ok = false;
	}
	ianaValid.set(name, ok);
	return ok;
}

/**
 * The canonical form of a zone, or null when it is not one.
 *
 * 'UTC', 'utc', 'Z', 'GMT', '+00:00' → 'utc'; '+0530' → '+05:30'; an IANA name is kept as
 * written when Intl accepts it. Empty, unknown or out-of-range values → null.
 * @param {unknown} z
 * @returns {string|null}
 */
export function normalizeZone(z) {
	if (typeof z !== 'string') return null;
	const s = z.trim();
	if (!s) return null;
	const lower = s.toLowerCase();
	if (lower === 'utc' || lower === 'z' || lower === 'gmt' || lower === 'etc/utc') return UTC_ZONE;
	if (isFixedOffset(s)) {
		const mins = fixedOffsetMinutes(s);
		if (mins == null) return null;
		return mins === 0 ? UTC_ZONE : formatFixedOffset(mins);
	}
	return isIanaZone(s) ? s : null;
}

/**
 * A zone as a person reads it: 'UTC', 'UTC+13:00 (fixed)', 'Pacific/Auckland'. `bare` drops
 * the "(fixed)", for a label that already sits in parentheses.
 * @param {string} zone
 * @param {{ bare?: boolean }} [opts]
 */
export function zoneLabel(zone, { bare = false } = {}) {
	const z = normalizeZone(zone) ?? UTC_ZONE;
	if (z === UTC_ZONE) return 'UTC';
	if (isFixedOffset(z)) return bare ? `UTC${z}` : `UTC${z} (fixed)`;
	return z;
}
