// @ts-nocheck
// Node-side glue for the shared phase reference (src/lib/utils/phaseReference.js): reads the
// x column's clock (core/columnTimeZone.js columnClock: its own zone, or a legacy session's
// one zone), which the pure util must not touch.
//
// The clock is read ONLY in clock mode. Node compute tests mock core.svelte with just `core`
// and `appConsts`; reading `appState` (the legacy zone) unconditionally would break every one
// of them for a mode they do not use.
import { columnClock, clockDstChanges } from '$lib/core/columnTimeZone.js';
import { clockPhaseDstWarning } from '$lib/utils/time/dstNotes.js';
import { zoneOffsetMinutes } from '$lib/utils/time/zones.js';
import { max } from '$lib/utils/stats.js';
import {
	PHASE_REFERENCE_CLOCK,
	resolvePhaseReference,
	timeOriginMs
} from '$lib/utils/phaseReference.js';

/** The latest valid timestamp of a time column, or null (the end of the record). */
function timeEndMs(col) {
	if (!col || col.type !== 'time' || typeof col.getData !== 'function') return null;
	const m = max(col.getData() ?? []);
	const n = Number(m);
	return m == null || !Number.isFinite(n) ? null : n;
}

/**
 * Resolve a node's `phaseReference` arg against its x column.
 *
 * Clock time is hours after local midnight in the x column's clock zone, with ONE offset
 * taken at the first sample (decision 6). When the record crosses a daylight-saving change
 * the result carries a warning that names it. `perWindow` (MovingAnalysis) words the warning
 * for windows that each use their own offset (`windowOffsetHours`).
 *
 * The result keeps the clock (`zone`, `perWindowZone`) so a rolling node can shift each
 * window by its own offset; a legacy session gets no per-window shift (it computes exactly
 * what it did before per-column zones), nor does a wall-clock column (zone-less 'utc' text:
 * its ms already ARE the local clock, and UTC has no daylight saving).
 *
 * @param {object} argsIN  the node args (`phaseReference` absent = since first sample)
 * @param {object|null} xCol  the x column phases are measured on
 * @param {{ perWindow?: boolean }} [opts]
 * @returns {{clock: boolean, offsetHours: number, warning: string|null, zone?: string,
 *   perWindowZone?: string|null, originMs?: number|null}}
 */
export function resolveNodePhaseReference(argsIN, xCol, { perWindow = false } = {}) {
	if (argsIN?.phaseReference !== PHASE_REFERENCE_CLOCK) return resolvePhaseReference(undefined);
	const clock = columnClock(xCol);
	const originMs = timeOriginMs(xCol);
	const ref = resolvePhaseReference(PHASE_REFERENCE_CLOCK, originMs, clock.zone);
	if (!ref.clock) return ref;
	const changes = clockDstChanges(clock, originMs, timeEndMs(xCol));
	const shifts = perWindow && !clock.legacy && !clock.wall && changes.length > 0;
	return {
		...ref,
		zone: clock.zone,
		originMs,
		perWindowZone: shifts ? clock.zone : null,
		warning: clockPhaseDstWarning(clock, changes, { perWindow: shifts })
	};
}

/**
 * Each window's clock offset (h) for a rolling node (decision 6): the first sample's offset
 * plus however far the zone's offset at the window's centre has moved from it, so a window
 * after a daylight-saving change reads the local clock in force then. Null when every window
 * keeps the one offset (no per-window zone, see resolveNodePhaseReference).
 *
 * @param {{clock: boolean, offsetHours: number, perWindowZone?: string|null, originMs?: number|null}} ref
 * @param {number[]} centresHrs  each window's centre, in hours since the first sample
 * @returns {number[]|null}
 */
export function windowClockOffsets(ref, centresHrs) {
	if (!ref?.clock || !ref.perWindowZone || !Number.isFinite(ref.originMs)) return null;
	const at0 = zoneOffsetMinutes(ref.perWindowZone, ref.originMs);
	return centresHrs.map(
		(c) =>
			ref.offsetHours +
			(zoneOffsetMinutes(ref.perWindowZone, ref.originMs + c * 3600000) - at0) / 60
	);
}
