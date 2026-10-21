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
// Plan: ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md, sections 3.1 to 3.3 and
// 3.10. Since phase 3 a zone-less text column with a zone other than 'utc' stores the
// instants its wall clock names in that zone (`resolveWallClocks`, below); 'utc' keeps the
// wall clock read as UTC exactly as before.

import dayjs from './dayjsSetup.js';
// The zone NAMES (validation, fixed offsets, labels) live in a pure module with no imports, so
// the MCP Worker and its session normalizer check a zone exactly as the app does (zoneNames.js).
import {
	UTC_ZONE,
	isFixedOffset,
	fixedOffsetMinutes,
	formatFixedOffset,
	isIanaZone,
	normalizeZone,
	zoneLabel
} from './zoneNames.js';

export { UTC_ZONE, isFixedOffset, fixedOffsetMinutes, formatFixedOffset, normalizeZone, zoneLabel };

// Offsets and the wall-clock resolver live in a pure module (Intl only, no dayjs) for the same
// reason: the MCP Worker counts a draft column's daylight-saving anomalies with this code.
import {
	zoneOffsetMinutes,
	wallClockToInstant,
	resolveWallClocks,
	instantToWallClock
} from './zoneResolver.js';

export { zoneOffsetMinutes, wallClockToInstant, resolveWallClocks, instantToWallClock };

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

// ─── Offsets and the wall-clock resolver ─────────────────────────────────────
//
// zoneOffsetMinutes, wallClockToInstant, resolveWallClocks and instantToWallClock live in the
// pure zoneResolver.js (Intl only, no dayjs) so the MCP Worker counts a column's repeated and
// skipped hours with the app's own code; re-exported above.

// Offsets change only on a quarter hour of UTC, so a 15-minute bucket is exact.
const OFFSET_BUCKET_MS = 15 * 60 * 1000;
const DAY_MS = 86400000;

// ─── Clock readings that do not depend on the computer's zone (plan 5f) ─────
//
// dayjs keeps a zoned time on the MACHINE's local clock: `dayjs.utc(ms).utcOffset(h)` and
// `dayjs(ms).tz(zone)` read their fields through local Date getters and do `startOf`, `hour()`
// and `add` in local time, so near a daylight-saving change of the computer's own zone they are
// an hour off (a '+12:00' column read 01:00 for 02:00 on 29 Sep 2024 on a computer in
// Auckland; an Auckland actogram starting on 7 Apr 2024 began its rows at 01:00 on a computer
// anywhere else). Every clock reading goes through these instead: the wall clock is computed
// with our own offsets (`instantToWallClock`, Intl with an explicit zone) and kept as a UTC
// dayjs, whose fields never touch the local clock, and a local time is turned back into an
// instant with the resolver (`wallClockToInstant`).

const OFFSET_TOKENS = /\[([^\]]*)]|ZZ|Z/g;

/** `fmt` with its Z / ZZ tokens replaced by the offset as literal text. */
function withOffsetText(fmt, minutes) {
	const plain = formatFixedOffset(minutes);
	return fmt.replace(OFFSET_TOKENS, (tok, literal) => {
		if (literal !== undefined) return tok;
		return `[${tok === 'ZZ' ? plain.replace(':', '') : plain}]`;
	});
}

/**
 * A dayjs whose fields (`hour()`, `date()`, `format('HH:mm')`) are the wall clock `zone` shows
 * at the instant `ms`, the same on every computer. Read it and format it; do not do clock
 * arithmetic on it (`startOf`, `hour(h)`, `add`) or take its `valueOf()`: it is a UTC dayjs of
 * the WALL clock, not the instant. For those use `zoneStartOfDay`, or `instantToWallClock` and
 * `wallClockToInstant`. `format()` prints a Z or ZZ token as the zone's offset at `ms`.
 * @param {number} ms epoch ms
 * @param {string} zone 'utc', a fixed offset or an IANA name (an unknown zone reads as 'utc')
 */
export function wallClockDayjs(ms, zone) {
	const z = normalizeZone(zone) ?? UTC_ZONE;
	const n = Number(ms);
	if (ms == null || !Number.isFinite(n)) return dayjs.utc(NaN);
	const minutes = zoneOffsetMinutes(z, n);
	const d = dayjs.utc(n + minutes * 60000);
	// A UTC dayjs already prints +00:00 (and its default format, ISO with "Z").
	if (minutes === 0) return d;
	// Only `format` is overridden, on this instance: a clone (which arithmetic makes) is plain.
	const base = d.format.bind(d);
	d.format = (fmt) => base(withOffsetText(fmt ?? 'YYYY-MM-DDTHH:mm:ssZ', minutes));
	return d;
}

/**
 * The instant local midnight starts the day that `zone` is in at the instant `ms` (the
 * actogram's automatic first row). A day whose midnight is repeated starts at the first one;
 * one whose midnight is skipped (America/Santiago, 8 Sep 2024) at its first instant, 01:00
 * local (the resolver's rule: the offset before the change). NaN for a non-finite `ms`.
 * @param {number} ms
 * @param {string} zone an unknown zone reads as 'utc'
 */
export function zoneStartOfDay(ms, zone) {
	const z = normalizeZone(zone) ?? UTC_ZONE;
	const n = Number(ms);
	if (ms == null || !Number.isFinite(n)) return NaN;
	const wall = instantToWallClock(n, z);
	return wallClockToInstant(Math.floor(wall / DAY_MS) * DAY_MS, z);
}

/**
 * Parse a wall-clock text in `zone` to an instant (ms), or NaN. `fmt` is optional; without
 * one, dayjs's ISO reading is used (what <input type="datetime-local"> emits). The text is
 * read as UTC and resolved with `wallClockToInstant`, so a typed time in a repeated hour is
 * the earlier instant and one in a skipped hour moves forward, as a column's times do.
 */
export function parseInZone(text, fmt, zone) {
	if (text == null || text === '') return NaN;
	const z = normalizeZone(zone) ?? UTC_ZONE;
	const asUtc = fmt ? dayjs.utc(text, fmt, true) : dayjs.utc(text);
	if (!asUtc.isValid()) return NaN;
	return wallClockToInstant(asUtc.valueOf(), z);
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

// ─── Daylight-saving changes (phase 2: clock-time consumers) ───────────────

/**
 * The offset changes of `zone` between the instants `fromMs` and `toMs` (inclusive), in time
 * order: `[{ at, before, after }]`, `at` the first instant of the new offset (epoch ms) and
 * `before` / `after` the offsets in minutes east of UTC. 'utc' and fixed offsets have none.
 *
 * Sampled once a day and narrowed to the 15-minute bucket the change happens in (offsets only
 * change on a quarter hour of UTC), so a ten-year record costs about 3,650 lookups. Two
 * changes less than a day apart (which no zone has) would be seen as one, or none.
 * @param {string} zone
 * @param {number} fromMs
 * @param {number} toMs
 * @returns {{ at: number, before: number, after: number }[]}
 */
export function zoneTransitions(zone, fromMs, toMs) {
	const z = normalizeZone(zone);
	if (!z || z === UTC_ZONE || isFixedOffset(z)) return [];
	if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return [];
	const out = [];
	let t0 = fromMs;
	let o0 = zoneOffsetMinutes(z, t0);
	while (t0 < toMs) {
		const t1 = Math.min(t0 + DAY_MS, toMs);
		const o1 = zoneOffsetMinutes(z, t1);
		if (o1 !== o0) {
			// Narrow (lo, hi] to one bucket: lo still has the old offset, hi the new one.
			let lo = t0;
			let hi = t1;
			while (hi - lo > OFFSET_BUCKET_MS) {
				const mid = lo + Math.floor((hi - lo) / 2);
				if (zoneOffsetMinutes(z, mid) === o0) lo = mid;
				else hi = mid;
			}
			// An offset is looked up per bucket, so the change is at the start of hi's bucket
			// (lo, with the old offset, is in an earlier one).
			out.push({ at: Math.floor(hi / OFFSET_BUCKET_MS) * OFFSET_BUCKET_MS, before: o0, after: o1 });
		}
		t0 = t1;
		o0 = o1;
	}
	return out;
}
