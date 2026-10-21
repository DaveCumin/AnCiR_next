// @ts-nocheck
// Time zones as the app names them (per-column time zone, STAT-18).
//
// A zone is one of three things, stored as a string:
//
//   'utc'        the default. For a column whose text carries no offset it reads
//                "As written": the wall clock is kept exactly as the file wrote it.
//   '+13:00'     a FIXED offset (±HH:MM), for a logger whose clock never changes
//                for daylight saving. Never `Etc/GMT-13`: the Etc sign is inverted,
//                which people get wrong.
//   IANA name    'Pacific/Auckland', which follows that zone's daylight saving.
//
// There is no 'local' value on purpose: the machine's zone would make a session read
// differently on another computer. "Use my computer's zone" stores the IANA name.
//
// Plan: ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md, sections 3.1 to 3.3.
// Phase 1 uses this module for display and import detection only; no stored instant is
// computed through it. `wallClockToInstant` is the simple two-pass lookup; phase 3
// replaces it with the resolver that applies the repeated/missing hour rules (3.10).

import dayjs from './dayjsSetup.js';

export const UTC_ZONE = 'utc';

const FIXED_RE = /^([+-])(\d{2}):?(\d{2})$/;

/**
 * Real-world fixed offsets, west to east. +00:00 is not listed: it is `'utc'`.
 * Includes the half- and quarter-hour offsets (India +05:30, Nepal +05:45, Chatham +12:45).
 */
export const COMMON_FIXED_OFFSETS = [
	'-12:00',
	'-11:00',
	'-10:00',
	'-09:30',
	'-09:00',
	'-08:00',
	'-07:00',
	'-06:00',
	'-05:00',
	'-04:00',
	'-03:30',
	'-03:00',
	'-02:00',
	'-01:00',
	'+01:00',
	'+02:00',
	'+03:00',
	'+03:30',
	'+04:00',
	'+04:30',
	'+05:00',
	'+05:30',
	'+05:45',
	'+06:00',
	'+06:30',
	'+07:00',
	'+08:00',
	'+08:45',
	'+09:00',
	'+09:30',
	'+10:00',
	'+10:30',
	'+11:00',
	'+12:00',
	'+12:45',
	'+13:00',
	'+13:45',
	'+14:00'
];

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
function isIanaZone(name) {
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

/** The computer's own IANA zone ('Pacific/Auckland'), or 'utc' when it cannot be read. */
export function localZone() {
	try {
		return normalizeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? UTC_ZONE;
	} catch {
		return UTC_ZONE;
	}
}

// Browsers list some zones under their pre-rename IANA names (CLDR keeps them as canonical
// ids), so a person in India finds "Asia/Calcutta" but not "Asia/Kolkata". The picker shows
// the current name; Intl accepts both, and both mean the same rules.
const CURRENT_NAMES = {
	'Asia/Calcutta': 'Asia/Kolkata',
	'Asia/Katmandu': 'Asia/Kathmandu',
	'Asia/Saigon': 'Asia/Ho_Chi_Minh',
	'Asia/Rangoon': 'Asia/Yangon',
	'Europe/Kiev': 'Europe/Kyiv',
	'America/Godthab': 'America/Nuuk',
	'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
	'America/Indianapolis': 'America/Indiana/Indianapolis',
	'America/Louisville': 'America/Kentucky/Louisville',
	'Atlantic/Faeroe': 'Atlantic/Faroe',
	'Pacific/Ponape': 'Pacific/Pohnpei',
	'Pacific/Truk': 'Pacific/Chuuk',
	'Pacific/Enderbury': 'Pacific/Kanton'
};

let zoneList = null;

/** Every IANA zone this browser knows (the list the pickers offer), current names, sorted. */
export function allIanaZones() {
	if (zoneList) return zoneList;
	let raw = [];
	if (typeof Intl?.supportedValuesOf === 'function') {
		try {
			raw = Intl.supportedValuesOf('timeZone');
		} catch {
			raw = [];
		}
	}
	if (raw.length === 0) raw = [localZone()].filter((z) => z !== UTC_ZONE);
	const names = raw.map((z) => {
		const current = CURRENT_NAMES[z];
		return current && isIanaZone(current) ? current : z;
	});
	zoneList = [...new Set(names)].filter((z) => z !== 'UTC').sort();
	return zoneList;
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

// ─── Offsets ───────────────────────────────────────────────────────────────

const dtfCache = new Map();
function partsFormatter(zone) {
	let f = dtfCache.get(zone);
	if (!f) {
		f = new Intl.DateTimeFormat('en-US', {
			timeZone: zone,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
		dtfCache.set(zone, f);
	}
	return f;
}

// Offsets change only on a quarter hour of UTC, so a 15-minute bucket is exact. Capped so a
// long session cannot grow it without bound.
const OFFSET_BUCKET_MS = 15 * 60 * 1000;
const offsetCache = new Map();
const OFFSET_CACHE_MAX = 50_000;

function ianaOffsetMinutes(zone, ms) {
	const bucket = Math.floor(ms / OFFSET_BUCKET_MS);
	const key = `${zone}|${bucket}`;
	const hit = offsetCache.get(key);
	if (hit !== undefined) return hit;
	const at = bucket * OFFSET_BUCKET_MS;
	const p = {};
	for (const { type, value } of partsFormatter(zone).formatToParts(new Date(at))) p[type] = value;
	const wall = Date.UTC(
		Number(p.year),
		Number(p.month) - 1,
		Number(p.day),
		Number(p.hour) % 24,
		Number(p.minute),
		Number(p.second)
	);
	const minutes = Math.round((wall - at) / 60000);
	if (offsetCache.size >= OFFSET_CACHE_MAX) offsetCache.clear();
	offsetCache.set(key, minutes);
	return minutes;
}

/**
 * Minutes east of UTC that `zone` is at the instant `ms`.
 * @param {string} zone a normalised zone
 * @param {number} ms epoch ms
 */
export function zoneOffsetMinutes(zone, ms) {
	const z = normalizeZone(zone) ?? UTC_ZONE;
	if (z === UTC_ZONE) return 0;
	const fixed = fixedOffsetMinutes(z);
	if (fixed != null) return fixed;
	if (!Number.isFinite(ms)) return 0;
	return ianaOffsetMinutes(z, ms);
}

/**
 * The instant a wall clock names in `zone`. The wall clock is given as ms read as if it
 * were UTC (which is how a zone-less text column is stored today).
 *
 * Two-pass lookup: the offset at the wall clock taken as an instant, then the offset at the
 * corrected instant. In a repeated hour this lands on one of the two instants and in a
 * missing hour on a nearby one; phase 3 replaces it with the plan's explicit rules
 * (section 3.10) before any stored instant is computed this way. Phase 1 only DISPLAYS
 * through it (a zone-less column shown in another zone).
 */
export function wallClockToInstant(wallMs, zone) {
	if (!Number.isFinite(wallMs)) return wallMs;
	const z = normalizeZone(zone) ?? UTC_ZONE;
	if (z === UTC_ZONE) return wallMs;
	const first = zoneOffsetMinutes(z, wallMs);
	const guess = wallMs - first * 60000;
	const second = zoneOffsetMinutes(z, guess);
	return wallMs - second * 60000;
}

/** The wall clock (as ms read as UTC) that `zone` shows at the instant `ms`. */
export function instantToWallClock(ms, zone) {
	if (!Number.isFinite(ms)) return ms;
	return ms + zoneOffsetMinutes(zone, ms) * 60000;
}

/**
 * A dayjs instance showing the instant `ms` in `zone`, ready to `.format()`.
 * IANA zones go through dayjs's own tz(), as every display did before per-column zones, so
 * a legacy session renders through exactly the same code.
 */
export function dayjsInZone(ms, zone) {
	const z = normalizeZone(zone) ?? UTC_ZONE;
	if (z === UTC_ZONE) return dayjs.utc(ms);
	const fixed = fixedOffsetMinutes(z);
	if (fixed != null) {
		// utcOffset() reads -16..16 as HOURS, so whole-hour offsets are passed as hours.
		return dayjs.utc(ms).utcOffset(fixed % 60 === 0 ? fixed / 60 : fixed);
	}
	return dayjs(ms).tz(z);
}

/**
 * Parse a wall-clock text in `zone` to an instant (ms), or NaN. `fmt` is optional; without
 * one, dayjs's ISO reading is used (what <input type="datetime-local"> emits).
 */
export function parseInZone(text, fmt, zone) {
	if (text == null || text === '') return NaN;
	const z = normalizeZone(zone) ?? UTC_ZONE;
	const asUtc = fmt ? dayjs.utc(text, fmt, true) : dayjs.utc(text);
	if (!asUtc.isValid()) return NaN;
	if (z === UTC_ZONE) return asUtc.valueOf();
	const fixed = fixedOffsetMinutes(z);
	if (fixed != null) return asUtc.valueOf() - fixed * 60000;
	const dt = fmt ? dayjs.tz(text, fmt, z) : dayjs.tz(text, z);
	return dt.isValid() ? dt.valueOf() : NaN;
}

// ─── Import detection (plan 3.3) ───────────────────────────────────────────

/**
 * Suggest a column zone from the offsets its text carries.
 *
 * Every value with the same offset: that fixed offset, or 'utc' for Z / +00:00. Offsets
 * that change within the column (+13:00 then +12:00 in April): an IANA zone whose offset
 * matches every value, preferring `preferZone` (the computer's zone); if none fits, the
 * first value's fixed offset with a note. Values with no offset are ignored; no offsets at
 * all → null (the caller keeps 'utc', "As written": never guess silently).
 *
 * @param {{ instant: number, offset: number }[]} samples offset in minutes east of UTC
 * @param {{ preferZone?: string, zones?: string[] }} [opts]
 * @returns {{ zone: string, note: string|null, offsets: string[] } | null}
 */
export function suggestZoneFromOffsets(samples, { preferZone, zones } = {}) {
	const valid = (samples ?? []).filter(
		(s) => s && Number.isFinite(s.instant) && Number.isFinite(s.offset)
	);
	if (valid.length === 0) return null;
	const distinct = [...new Set(valid.map((s) => s.offset))];
	const offsets = distinct.map((m) => (m === 0 ? 'Z' : formatFixedOffset(m)));
	if (distinct.length === 1) {
		const zone = distinct[0] === 0 ? UTC_ZONE : formatFixedOffset(distinct[0]);
		return { zone, note: null, offsets };
	}
	// Only where the offset changes (plus the ends) needs checking against a candidate.
	const sorted = [...valid].sort((a, b) => a.instant - b.instant);
	const checks = [sorted[0]];
	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i].offset !== sorted[i - 1].offset) checks.push(sorted[i - 1], sorted[i]);
	}
	checks.push(sorted[sorted.length - 1]);
	const fits = (zone) => checks.every((s) => zoneOffsetMinutes(zone, s.instant) === s.offset);
	const prefer = normalizeZone(preferZone);
	// Where people live before research stations and Etc/ aliases: offsets that change like
	// Auckland's should read "Pacific/Auckland", not "Antarctica/McMurdo", which sorts first.
	const remote = (z) => /^(Antarctica|Etc)\//.test(z);
	const list = zones ?? allIanaZones();
	const candidates = [
		...(prefer && !isFixedOffset(prefer) && prefer !== UTC_ZONE ? [prefer] : []),
		...list.filter((z) => !remote(z)),
		...list.filter(remote)
	];
	for (const z of candidates) {
		if (normalizeZone(z) && fits(z)) {
			return {
				zone: z,
				note: `The offsets change within the column (${offsets.join(', ')}), as daylight saving does in ${z}.`,
				offsets
			};
		}
	}
	const first = sorted[0].offset;
	return {
		zone: first === 0 ? UTC_ZONE : formatFixedOffset(first),
		note: `The offsets change within the column (${offsets.join(', ')}) and no time zone matches them all; the first value's offset is suggested.`,
		offsets
	};
}
