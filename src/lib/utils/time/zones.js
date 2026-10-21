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
const DAY_MS = 86400000;
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

// ─── Wall clock to instant (phase 3; plan section 3.10, decision 10) ──────────
//
// A zone-less text time is parsed as if it were UTC (TimeUtils.js parseTimeStrict, so every
// format rule stays), giving its WALL CLOCK as ms. These functions turn that wall clock into
// the instant it names in a zone. Written to be ported line for line to Python and R
// (plan phase 4); the contract:
//
// For one wall clock w (ms) in zone z:
//   before = offset of z at the instant w - 1 day      (minutes east of UTC)
//   after  = offset of z at the instant w + 1 day
//   if before == after:  instant = w - before            (no change near w)
//   else  tb = w - before, ta = w - after, and
//         okB = offset at tb == before, okA = offset at ta == after
//     both ok   REPEATED (the clock went back; w happened twice): earlier = min(tb, ta) (the
//               offset before the change), later = max(tb, ta)
//     one ok    that one
//     neither   SKIPPED (the clock went forward; w never happened): tb, the offset BEFORE the
//               change, which reads on the clock as w plus the gap (02:30 becomes 03:30)
// Assumes no zone changes its offset twice within two days (none does).
//
// For a column (values in row order), REPEATED values are grouped into runs: consecutive
// values (blank cells skipped) with the same two offsets, each within the length of the
// repeated window of the one before. In a run, the positions where the wall clock steps back
// or repeats (w <= the previous w) are counted:
//   exactly one   the times are in order through the repeated hour: values before it are the
//                 first pass (earlier instant), it and those after the second (later instant).
//                 Like pandas' tz_localize(ambiguous='infer').
//   none or more  not a clean two-pass record (one pass only, sorted by the text, shuffled):
//                 every value of the run takes the earlier instant.
// Counts returned: `repeated` (values in a repeated hour), `secondPass` (of those, read as the
// later instant), `unordered` (of those, in runs that were not a clean two-pass record, so all
// read as the earlier instant), `skipped` (values in a skipped hour, shifted forward).
//
// Offsets are looked up per 15-minute UTC bucket and cached per zone (ianaOffsetMinutes), and
// a column memoises the classification per 15-minute WALL bucket: offsets and changes fall on
// quarter hours, so every wall clock in a bucket is classified alike (checked: a zone whose
// offset is not a whole quarter hour, such as a historical local mean time, is not memoised).

const UNIQUE = 0;
const REPEATED = 1;
const SKIPPED = 2;
const QUARTER_MS = 15 * 60000;

/** The normalised zone, or a RangeError: a zone the resolver cannot read is refused. */
function resolverZone(zone) {
	const z = normalizeZone(zone);
	if (!z) throw new RangeError(`Unknown time zone: ${zone}`);
	return z;
}

/**
 * How an IANA zone reads one wall clock: `{ kind, early, late }`, the offsets (minutes) of
 * the earlier and later instant (equal unless REPEATED; for SKIPPED the offset before the
 * change). See the contract above.
 */
function classifyWall(z, w) {
	const before = ianaOffsetMinutes(z, w - DAY_MS);
	const after = ianaOffsetMinutes(z, w + DAY_MS);
	if (before === after) return { kind: UNIQUE, early: before, late: before };
	const okBefore = ianaOffsetMinutes(z, w - before * 60000) === before;
	const okAfter = ianaOffsetMinutes(z, w - after * 60000) === after;
	if (okBefore && okAfter) {
		// The larger offset gives the earlier instant.
		const hi = Math.max(before, after);
		const lo = Math.min(before, after);
		return { kind: REPEATED, early: hi, late: lo };
	}
	if (okBefore) return { kind: UNIQUE, early: before, late: before };
	if (okAfter) return { kind: UNIQUE, early: after, late: after };
	return { kind: SKIPPED, early: before, late: before };
}

/** classifyWall, memoised per 15-minute wall bucket for one column (see the header). */
function wallClassifier(z) {
	const memo = new Map();
	return (w) => {
		const bucket = Math.floor(w / QUARTER_MS);
		let c = memo.get(bucket);
		if (c === undefined) {
			c = classifyWall(z, bucket * QUARTER_MS);
			if (c.early % 15 !== 0 || c.late % 15 !== 0) return classifyWall(z, w);
			memo.set(bucket, c);
		}
		return c;
	};
}

const isWallValue = (w) => typeof w === 'number' && Number.isFinite(w);

/**
 * The instant a wall clock names in `zone` (the contract above, for one value): a repeated
 * hour gives the earlier instant, a skipped one is shifted forward by the gap. `wallMs` is the
 * wall clock read as UTC; a missing value (null, NaN) is returned as it is. Throws a
 * RangeError for a zone it does not know.
 * @param {number} wallMs
 * @param {string} zone 'utc', a fixed offset or an IANA name
 */
export function wallClockToInstant(wallMs, zone) {
	const z = resolverZone(zone);
	if (!isWallValue(wallMs)) return wallMs;
	if (z === UTC_ZONE) return wallMs;
	const fixed = fixedOffsetMinutes(z);
	if (fixed != null) return wallMs - fixed * 60000;
	return wallMs - classifyWall(z, wallMs).early * 60000;
}

/**
 * A column of wall clocks (ms read as UTC, in row order; null, NaN and other non-numbers kept
 * as they are) to the instants they name in `zone`, with the repeated hour inferred from the
 * order and the skipped hour shifted forward (the contract above). 'utc' returns the values
 * unchanged. Throws a RangeError for a zone it does not know.
 * @param {ArrayLike<unknown>} walls
 * @param {string} zone
 * @returns {{ instants: unknown[], repeated: number, secondPass: number, unordered: number,
 *   skipped: number }}
 */
export function resolveWallClocks(walls, zone) {
	const z = resolverZone(zone);
	const n = walls?.length ?? 0;
	const instants = new Array(n);
	const counts = { repeated: 0, secondPass: 0, unordered: 0, skipped: 0 };
	if (z === UTC_ZONE) {
		for (let i = 0; i < n; i++) instants[i] = walls[i];
		return { instants, ...counts };
	}
	const fixed = fixedOffsetMinutes(z);
	if (fixed != null) {
		const shift = fixed * 60000;
		for (let i = 0; i < n; i++) {
			const w = walls[i];
			instants[i] = isWallValue(w) ? w - shift : w;
		}
		return { instants, ...counts };
	}

	const classify = wallClassifier(z);
	// The current run of repeated values: their row indices and the two offsets.
	let run = null;
	const endRun = () => {
		if (!run) return;
		const idx = run.idx;
		counts.repeated += idx.length;
		let backStep = -1;
		let backSteps = 0;
		for (let p = 1; p < idx.length; p++) {
			if (walls[idx[p]] <= walls[idx[p - 1]]) {
				backSteps++;
				backStep = p;
			}
		}
		if (backSteps === 1) {
			const shift = run.late * 60000;
			for (let p = backStep; p < idx.length; p++) instants[idx[p]] = walls[idx[p]] - shift;
			counts.secondPass += idx.length - backStep;
		} else {
			counts.unordered += idx.length;
		}
		run = null;
	};

	for (let i = 0; i < n; i++) {
		const w = walls[i];
		if (!isWallValue(w)) {
			instants[i] = w;
			continue;
		}
		const c = classify(w);
		instants[i] = w - c.early * 60000;
		if (c.kind === REPEATED) {
			const windowMs = (c.early - c.late) * 60000;
			const last = run ? walls[run.idx[run.idx.length - 1]] : null;
			const sameRun =
				run && run.early === c.early && run.late === c.late && Math.abs(w - last) < windowMs;
			if (!sameRun) {
				endRun();
				run = { early: c.early, late: c.late, idx: [] };
			}
			run.idx.push(i);
		} else {
			endRun();
			if (c.kind === SKIPPED) counts.skipped++;
		}
	}
	endRun();
	return { instants, ...counts };
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
