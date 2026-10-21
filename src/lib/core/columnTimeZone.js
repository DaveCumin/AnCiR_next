// src/lib/core/columnTimeZone.js
// @ts-nocheck
//
// A time column's ZONE and how its stored ms relate to it (its "time frame").
//
// Only a SOURCE column (imported or entered: it owns its data) carries its own
// `timeZone`. Every derived column inherits, so no node has to remember to stamp it and a
// change at the source reaches every output at once:
//
//   refId          a referencing column (plot series wrappers, taps): its target's frame.
//   producerNodeId a free process output: the frame of the input column its port names.
//   args.out       an analysis node output (Bin Data, Cosinor, Join Data…): the frame of the
//                  node's FIRST time input, in argument order. Join Data declares aTimeIN
//                  before bTimeIN, so its output takes A's zone (plan decision 8).
//
// A frame is `{ zone, wall }`:
//   zone  'utc', a fixed offset ('+13:00') or an IANA name (utils/time/zones.js).
//   wall  true when the stored ms are the WALL CLOCK read as UTC: zone-less text (a format
//         that reads no offset, or AWD, whose header has no zone) in the default 'utc' zone,
//         "As written". false for every other column, whose ms are true instants: text with
//         offsets, epoch ms, and (since phase 3) zone-less text given a zone, whose wall clock
//         is resolved in that zone when the column is read (Column.getData through
//         `parseZoneOf` and utils/time/zones.js resolveWallClocks). Shown in its own zone
//         either way, a zone-less column displays exactly as written.
//
// Phases 1 and 2 kept a zoned zone-less column's ms as its wall clock (`wall` true, clock
// readings in 'utc'); sessions saved then are read with phase 3's meaning (plan section 5c).
//
// Plan: ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md, sections 3.2 and 5c.

import { core } from './core.svelte.js';
import { producerInputColId } from './producerRuntime.js';
import { formatHasOffset } from '$lib/utils/time/TimeUtils.js';
import {
	normalizeZone,
	UTC_ZONE,
	zoneTransitions,
	zoneOffsetMinutes,
	zoneLabel,
	wallClockDayjs,
	parseInZone
} from '$lib/utils/time/zones.js';
import { getLegacyZone } from '$lib/utils/time/displayTime.js';

const MAX_DEPTH = 64;

const DEFAULT_FRAME = Object.freeze({ zone: UTC_ZONE, wall: true });

function findColumn(id) {
	if (id == null) return null;
	return (core.data ?? []).find((c) => c.id === id) ?? null;
}

function isColumnId(v) {
	return Number.isInteger(v) && v >= 0;
}

function outIdOf(v) {
	if (typeof v === 'number') return isColumnId(v) ? v : null;
	if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
	return null;
}

/** The analysis node that writes this column as one of its outputs, or null. */
function owningTableProcess(columnId) {
	for (const tp of core.tableProcesses ?? []) {
		const out = tp?.args?.out;
		if (!out || typeof out !== 'object') continue;
		for (const v of Object.values(out)) if (outIdOf(v) === columnId) return tp;
	}
	return null;
}

/** The node's input columns in argument order (`…IN` args, scalar or array). */
function tpInputColumns(tp) {
	const cols = [];
	for (const [key, value] of Object.entries(tp?.args ?? {})) {
		if (!key.endsWith('IN')) continue;
		for (const v of Array.isArray(value) ? value : [value]) {
			if (!isColumnId(v)) continue;
			const c = findColumn(v);
			if (c) cols.push(c);
		}
	}
	return cols;
}

/**
 * Whether a source column's times are written with no zone: text whose format reads no offset,
 * or AWD (its header has no zone). Such a column's own `timeZone` says where its wall clock
 * was; epoch ms and text with offsets already name their instants.
 */
export function readsWallClockText(col) {
	if (!col || col.type !== 'time') return true;
	if (col.compression === 'awd') return true;
	const raw = core.rawData?.get?.(col.data);
	const first = Array.isArray(raw) ? raw.find((v) => v != null && v !== '') : undefined;
	// Epoch ms (a node's numeric time output kept as a source, epoch imports): instants.
	if (typeof first === 'number') return false;
	return !formatHasOffset(col.timeFormat);
}

/**
 * The zone a source column's zone-less wall clock is resolved in when it is read, or null
 * when its stored ms are its text read as UTC, exactly as before per-column zones: no zone,
 * 'utc', a zone this browser does not know (warned on the column, core/columnWarnings.js),
 * text with offsets, epoch ms, or a column that is not a source.
 * @param {any} col a Column
 * @returns {string|null}
 */
export function parseZoneOf(col) {
	if (!col || col.type !== 'time' || col.refId != null) return null;
	const z = normalizeZone(col.timeZone);
	if (!z || z === UTC_ZONE) return null;
	return readsWallClockText(col) ? z : null;
}

/** Whether a source column's stored ms are its wall clock read as UTC (see the header). */
export function storesWallClock(col) {
	return readsWallClockText(col) && parseZoneOf(col) == null;
}

// ─── Repeated and skipped hours (phase 3) ───────────────────────────────────
// Column.getData resolves a zoned zone-less column with resolveWallClocks and records the
// counts against the array it returns, so the column's warnings (core/columnWarnings.js) read
// them without parsing again. Keyed by the array: a new read of new data is a new array.
const wallClockCounts = new WeakMap();

/** Record how a column's read resolved its repeated and skipped hours. */
export function noteWallClockCounts(data, counts) {
	if (data && typeof data === 'object') wallClockCounts.set(data, counts);
}

/**
 * The `{ zone, repeated, secondPass, unordered, skipped }` recorded for a column's data array, or null
 * when its read resolved no wall clock.
 */
export function wallClockCountsOf(data) {
	return data && typeof data === 'object' ? (wallClockCounts.get(data) ?? null) : null;
}

/**
 * The column whose own `timeZone` decides this column's frame: itself for a source column,
 * else the source it derives its time from. Null when the chain is broken or cyclic.
 */
export function timeZoneSource(col) {
	const seen = new Set();
	let cur = col;
	for (let depth = 0; cur && depth < MAX_DEPTH; depth++) {
		if (seen.has(cur.id)) return null;
		seen.add(cur.id);
		if (cur.refId != null) {
			if (cur.refId === -1) return null;
			cur = findColumn(cur.refId);
			continue;
		}
		if (cur.producerNodeId != null) {
			cur = findColumn(producerInputColId(cur.producerNodeId, cur.producerPort || 'output'));
			continue;
		}
		const tp = owningTableProcess(cur.id);
		if (tp) {
			const inputs = tpInputColumns(tp);
			cur = inputs.find((c) => c.type === 'time') ?? null;
			continue;
		}
		return cur;
	}
	return null;
}

/**
 * Whether this column carries its own zone (a source time column) rather than inheriting
 * one. The Properties row is editable only then.
 */
export function ownsTimeZone(col) {
	if (!col || col.type !== 'time') return false;
	if (col.refId != null || col.producerNodeId != null) return false;
	return owningTableProcess(col.id) == null;
}

/**
 * The column's time frame `{ zone, wall }`. Inherited through references, process outputs
 * and analysis outputs; 'utc' and wall-clock when nothing names a zone.
 * @param {any} col a Column
 */
export function resolveTimeFrame(col) {
	const src = timeZoneSource(col);
	if (!src) return DEFAULT_FRAME;
	return {
		zone: normalizeZone(src.timeZone) ?? UTC_ZONE,
		wall: storesWallClock(src)
	};
}

/**
 * The zone a clock-time reading (day start, hour of day, clock phase) of this column's
 * STORED ms is taken in. A wall-clock column ('utc', as written) is read in 'utc'; a
 * true-instant column in its zone. Ignores a legacy session; see `columnClock`, which is what
 * clock-time consumers call.
 * @param {any} col a Column
 */
export function clockZoneOf(col) {
	const frame = col?.timeFrame ?? resolveTimeFrame(col);
	return frame.wall ? UTC_ZONE : frame.zone;
}

/**
 * How clock-time ANALYSIS reads a column (per-column time zone, phase 2; plan sections 3.4
 * to 3.7). Every clock-time consumer (actogram day start and labels, clock phase, the
 * hour-of-day colour, light bands, the Bin Data start field) asks this, never "Show times
 * in", so changing how times are shown can never change a result (decision 2).
 *
 *   zone    the zone the stored ms are read in (`wallClockDayjs(ms, zone)` is the local clock)
 *   named   the zone the column's clock belongs to, to name in a label ("Hour of day
 *           (Pacific/Auckland)"). Since phase 3 the same as `zone`: only a 'utc' column is a
 *           wall-clock column (its ms are its wall clock, read in 'utc').
 *   wall    the stored ms are the wall clock read as UTC (zone-less text, 'utc')
 *   legacy  a legacy session: its one zone, read exactly as before per-column zones
 *
 * A legacy session (a non-UTC "Timezone" saved before per-column zones) keeps that one zone
 * for every column, so it computes exactly what it did. Reads `appState` (through
 * getLegacyZone): node compute tests that mock core without it call this only in clock mode.
 * @param {any} col a Column, or null (a time with no column: as written, UTC)
 * @returns {{ zone: string, named: string, wall: boolean, legacy: boolean }}
 */
export function columnClock(col) {
	const legacy = getLegacyZone();
	if (legacy) return { zone: legacy, named: legacy, wall: false, legacy: true };
	const frame = col ? (col.timeFrame ?? resolveTimeFrame(col)) : DEFAULT_FRAME;
	const named = normalizeZone(frame?.zone) ?? UTC_ZONE;
	const wall = frame?.wall !== false;
	return { zone: wall ? UTC_ZONE : named, named, wall, legacy: false };
}

/**
 * The part of a node's compute cache key that a clock-time result depends on: changes when
 * the column's zone (or the legacy zone) does. 'utc' for an as-written UTC column and the
 * legacy zone for a legacy session, which are what the key held before phase 2. (A zoned
 * column's data hash changes with its zone too, since its instants do.)
 * @param {any} col
 */
export function clockCacheKey(col) {
	const c = columnClock(col);
	return c.legacy ? c.zone : c.named;
}

/**
 * The daylight-saving changes of the column's clock zone inside a record whose stored ms run
 * from `minMs` to `maxMs`: `[{ at, before, after }]` (utils/time/zones.js zoneTransitions;
 * `at` is an instant). A wall-clock column is 'utc', which has none.
 * @param {{ zone: string }} clock from `columnClock`
 * @param {number} minMs
 * @param {number} maxMs
 */
export function clockDstChanges(clock, minMs, maxMs) {
	if (!clock || !Number.isFinite(minMs) || !Number.isFinite(maxMs)) return [];
	return zoneTransitions(clock.zone, minMs, maxMs);
}

/**
 * A stored time as the `<input type="datetime-local">` value of a CLOCK field of this column
 * (Bin Data's "Bin start"): its wall clock in the column's clock zone, "YYYY-MM-DDTHH:mm:ss".
 * A legacy session reads its one zone, exactly as before.
 * @param {number} ms
 * @param {any} col
 */
export function formatClockInput(ms, col) {
	if (ms == null || !Number.isFinite(Number(ms))) return '';
	const dt = wallClockDayjs(Number(ms), columnClock(col).zone);
	return dt.isValid() ? dt.format('YYYY-MM-DD[T]HH:mm:ss') : '';
}

/** The inverse of `formatClockInput`: the stored ms a typed clock field names, or NaN. */
export function parseClockInput(text, col) {
	return parseInZone(text, null, columnClock(col).zone);
}

/** "12", "5.5", "12.75": hours from minutes, at most two decimals. */
function hoursOf(minutes) {
	return String(+(Math.abs(minutes) / 60).toFixed(2));
}

/**
 * What a zone on a zone-less source column does, said beside its zone picker (plan 3.2): the
 * written times stay; read in the zone they name instants that many hours earlier (east of
 * UTC) or later (west) than the same text in a UTC column. A zone with daylight saving gives
 * the range its offsets take over the column's times. Null when there is nothing to say: no
 * zone, 'utc', text with offsets, epoch ms, a derived column.
 * @param {any} col a Column
 * @returns {string|null}
 */
export function zoneShiftNote(col) {
	const zone = parseZoneOf(col);
	if (!zone) return null;
	let lo = Infinity;
	let hi = -Infinity;
	for (const v of col.getData?.() ?? []) {
		if (typeof v !== 'number' || !Number.isFinite(v)) continue;
		if (v < lo) lo = v;
		if (v > hi) hi = v;
	}
	const offsets = new Set();
	if (Number.isFinite(lo)) {
		offsets.add(zoneOffsetMinutes(zone, lo));
		for (const c of zoneTransitions(zone, lo, hi)) offsets.add(c.after);
	} else {
		offsets.add(zoneOffsetMinutes(zone, Date.now()));
	}
	const min = Math.min(...offsets);
	const max = Math.max(...offsets);
	let move;
	if (min === max) {
		move = `${hoursOf(min)} h ${min > 0 ? 'earlier' : 'later'}`;
	} else if (min >= 0) {
		move = `${hoursOf(min)} to ${hoursOf(max)} h earlier`;
	} else if (max <= 0) {
		move = `${hoursOf(max)} to ${hoursOf(min)} h later`;
	} else {
		move = `between ${hoursOf(min)} h later and ${hoursOf(max)} h earlier`;
	}
	if (min === 0 && max === 0) return null;
	const dst = min !== max ? ' Elapsed time across its daylight-saving changes is exact.' : '';
	// A logger that follows daylight saving writes the repeated hour twice, in order: read as
	// it should be, so said here (information), not as a warning (core/columnWarnings.js).
	const counts = wallClockCountsOf(col.getData?.());
	const inOrder =
		counts?.secondPass > 0
			? ` The hour repeated when daylight saving ended is read in order: its first pass as daylight-saving time, its second (${counts.secondPass.toLocaleString()} ${counts.secondPass === 1 ? 'time' : 'times'}) as standard time.`
			: '';
	return `Times stay as written. Read as ${zoneLabel(zone, { bare: true })} time, they are ${move} than the same times in a UTC column.${dst}${inOrder}`;
}
