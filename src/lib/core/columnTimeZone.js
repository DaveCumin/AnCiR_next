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
import { normalizeZone, UTC_ZONE } from '$lib/utils/time/zones.js';

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
 * PHASE 2 HOOK: the zone a clock-time reading (day start, hour of day, clock phase) of this
 * column's STORED ms should be taken in. A wall-clock column's ms are its wall clock read
 * as UTC, so they are read in 'utc'; a true-instant column is read in its zone. A legacy
 * session keeps its one zone (utils/time/displayTime.js getLegacyZone), which callers apply
 * before this. Not wired to any consumer in phase 1.
 * @param {any} col a Column
 */
export function clockZoneOf(col) {
	const frame = col?.timeFrame ?? resolveTimeFrame(col);
	return frame.wall ? UTC_ZONE : frame.zone;
}
