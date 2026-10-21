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
//   wall  true when the stored ms are the WALL CLOCK read as UTC: a text column whose format
//         reads no offset (and AWD, whose header has no zone). Shown in its own zone, such a
//         column displays exactly as written. false for text with offsets and for epoch ms,
//         which are true instants.
//
// Phase 1 changes no stored instant: a zone-less column given a zone keeps its ms and is
// still `wall`. Phase 3 (DST-aware parsing) re-parses such a column into true instants and
// flips `wall` to false; display code reads the frame and needs no change then.
//
// Plan: ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md, section 3.2.

import { core } from './core.svelte.js';
import { producerInputColId } from './producerRuntime.js';
import { formatHasOffset } from '$lib/utils/time/TimeUtils.js';
import {
	normalizeZone,
	UTC_ZONE,
	wallClockToInstant,
	zoneTransitions,
	dayjsInZone,
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

/** Whether a source column's stored ms are its wall clock read as UTC (see the header). */
export function storesWallClock(col) {
	if (!col || col.type !== 'time') return true;
	if (col.compression === 'awd') return true;
	const raw = core.rawData?.get?.(col.data);
	const first = Array.isArray(raw) ? raw.find((v) => v != null && v !== '') : undefined;
	// Epoch ms (a node's numeric time output kept as a source, epoch imports): instants.
	if (typeof first === 'number') return false;
	return !formatHasOffset(col.timeFormat);
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
 * STORED ms is taken in. A wall-clock column's ms are its wall clock read as UTC, so they are
 * read in 'utc'; a true-instant column is read in its zone. Ignores a legacy session; see
 * `columnClock`, which is what clock-time consumers call.
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
 *   zone    the zone the stored ms are read in (`dayjsInZone(ms, zone)` is the local clock)
 *   named   the zone the column's clock belongs to, to name in a label ("Hour of day
 *           (Pacific/Auckland)"). Differs from `zone` only for a wall-clock column, whose ms
 *           are read in 'utc' because they ARE its wall clock.
 *   wall    the stored ms are the wall clock read as UTC (zone-less text)
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
 * legacy zone for a legacy session, which are what the key held before phase 2.
 * @param {any} col
 */
export function clockCacheKey(col) {
	const c = columnClock(col);
	if (c.legacy) return c.zone;
	if (c.wall && c.named === UTC_ZONE) return UTC_ZONE;
	return c.wall ? `${c.named}/wall` : c.named;
}

/**
 * The daylight-saving changes of the column's clock zone inside a record whose stored ms run
 * from `minMs` to `maxMs`: `[{ at, before, after }]` (utils/time/zones.js zoneTransitions;
 * `at` is an instant). A wall-clock column's ms are first read as wall clock in its zone.
 * @param {{ named: string, wall: boolean }} clock from `columnClock`
 * @param {number} minMs
 * @param {number} maxMs
 */
export function clockDstChanges(clock, minMs, maxMs) {
	if (!clock || !Number.isFinite(minMs) || !Number.isFinite(maxMs)) return [];
	const lo = clock.wall ? wallClockToInstant(minMs, clock.named) : minMs;
	const hi = clock.wall ? wallClockToInstant(maxMs, clock.named) : maxMs;
	return zoneTransitions(clock.named, lo, hi);
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
	const dt = dayjsInZone(Number(ms), columnClock(col).zone);
	return dt.isValid() ? dt.format('YYYY-MM-DD[T]HH:mm:ss') : '';
}

/** The inverse of `formatClockInput`: the stored ms a typed clock field names, or NaN. */
export function parseClockInput(text, col) {
	return parseInZone(text, null, columnClock(col).zone);
}
