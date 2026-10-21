// @ts-nocheck
// A zone's offset at an instant, and the wall-clock resolver: a zone-less wall clock (read as
// UTC ms) to the instant it names in a zone, with the repeated and skipped hours of a
// daylight-saving change resolved (per-column time zone, phase 3; plan
// ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md, section 3.10).
//
// Pure: Intl and zoneNames.js only, no dayjs, so the MCP Worker (mcp/src/emit/timeColumns.js,
// bundled into the Cloudflare Worker and run by plain `node --test`) counts a draft column's
// daylight-saving anomalies with this exact code. Re-exported by zones.js, which every app
// module imports.

import { UTC_ZONE, fixedOffsetMinutes, normalizeZone } from './zoneNames.js';

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
