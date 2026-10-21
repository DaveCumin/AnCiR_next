// @ts-nocheck
// The sentences that say a daylight-saving change falls inside a record (per-column time
// zone, phase 2; plan ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md, decisions 5
// and 6). Pure: callers pass the column's clock (core/columnTimeZone.js `columnClock`) and the
// changes (`clockDstChanges`).
//
// Only a column whose clock has a daylight-saving change gets a note: a true-instant column
// in a DST zone (text with offsets, epoch ms, and since phase 3 zone-less text given a zone)
// or a legacy session. Elapsed time is right, and the local clock moves against it: actogram
// rows (24 h of elapsed time) start an hour off local midnight after it, and a clock phase
// keeps the first sample's offset, so later phases are an hour off the local clock. A
// wall-clock column (zone-less text, 'utc', "as written") is read in UTC, which has none.

import { dayjsInZone, zoneLabel, formatFixedOffset } from './zones.js';

const offsetText = (minutes) => (minutes === 0 ? 'UTC' : `UTC${formatFixedOffset(minutes)}`);

function hoursText(minutes) {
	const h = Math.abs(minutes) / 60;
	return `${+h.toFixed(2)} h`;
}

/** "ended on 7 Apr 2024" / "began on 29 Sep 2024", in the zone's own calendar. */
function changeText(change, named) {
	const date = dayjsInZone(change.at, named).format('D MMM YYYY');
	return `${change.after < change.before ? 'ended' : 'began'} on ${date}`;
}

function changesText(changes, named) {
	const parts = changes.slice(0, 2).map((c) => changeText(c, named));
	const more = changes.length > 2 ? ` (and ${changes.length - 2} more changes)` : '';
	return parts.join(' and ') + more;
}

/**
 * The warning on a node whose phases are in clock time when its record crosses a
 * daylight-saving change, or null when it does not.
 * @param {{ named: string }} clock
 * @param {{ at: number, before: number, after: number }[]} changes
 * @param {{ perWindow?: boolean }} [opts] perWindow: each window uses its own offset
 *   (MovingAnalysis, decision 6)
 */
export function clockPhaseDstWarning(clock, changes, { perWindow = false } = {}) {
	if (!clock || !changes?.length) return null;
	const zone = zoneLabel(clock.named);
	const what = changesText(changes, clock.named);
	if (perWindow) {
		return (
			`Daylight saving ${what} in ${zone}; each window's clock time uses the offset in ` +
			`force at its centre.`
		);
	}
	const first = changes[0];
	const diff = first.before - first.after;
	return (
		`Clock time uses the first sample's offset (${offsetText(first.before)}, ${zone}) for the ` +
		`whole record. Daylight saving ${what}, so phases after it read ` +
		`${hoursText(diff)} ${diff > 0 ? 'later' : 'earlier'} than the local clock.`
	);
}

/**
 * The actogram's note when a daylight-saving change falls inside the record (decision 5: no
 * 23 or 25 h calendar rows in v1), or null.
 * @param {{ zone: string, named: string }} clock
 * @param {{ at: number, before: number, after: number }[]} changes
 * @param {{ startTime: number, periodHrs: number }} rows the first row's start and the period
 */
export function actogramDstNote(clock, changes, { startTime, periodHrs }) {
	if (!clock || !changes?.length) return null;
	const zone = zoneLabel(clock.named);
	const what = changesText(changes, clock.named);
	const period = Number.isFinite(periodHrs) && periodHrs > 0 ? periodHrs : 24;
	const first = changes[0];
	// The first row that starts after the change, and the local time it starts at.
	const k = Math.max(0, Math.ceil((first.at - startTime) / (period * 3600000)));
	const rowStart = startTime + k * period * 3600000;
	const local = dayjsInZone(rowStart, clock.zone).format('HH:mm');
	return (
		`Daylight saving ${what} in ${zone}. Rows are ${+period.toFixed(4)} h of elapsed time, so ` +
		`rows after it start at ${local} local time.`
	);
}

/**
 * Bin Data's note when a daylight-saving change falls inside the record and moves the bin
 * edges against the local clock (plan 3.5: bins stay elapsed time in v1), or null. Bins whose
 * step divides the change (hourly bins and a 1 h change) keep their clock times, so they get
 * no note; daily bins (and 12 h, or hourly bins and a 30-minute change) do.
 * @param {{ zone: string, named: string }} clock
 * @param {{ at: number, before: number, after: number }[]} changes
 * @param {{ firstEdge: number, stepHrs: number, binHrs: number }} bins the first bin's start
 *   (ms), the step between bin starts and the bin size (hours)
 */
export function binDstNote(clock, changes, { firstEdge, stepHrs, binHrs }) {
	if (!clock || !changes?.length) return null;
	if (!Number.isFinite(firstEdge) || !(stepHrs > 0)) return null;
	const stepMs = stepHrs * 3600000;
	const moving = changes.find((c) => {
		const shiftMs = Math.abs(c.after - c.before) * 60000;
		const rem = shiftMs % stepMs;
		return rem > 1e-6 && stepMs - rem > 1e-6;
	});
	if (!moving) return null;
	const k = Math.max(0, Math.ceil((moving.at - firstEdge) / stepMs));
	const local = dayjsInZone(firstEdge + k * stepMs, clock.zone).format('HH:mm');
	const size = Number.isFinite(binHrs) && binHrs > 0 ? binHrs : stepHrs;
	return (
		`Daylight saving ${changesText([moving], clock.named)} in ${zoneLabel(clock.named)}. ` +
		`Bins are ${+size.toFixed(4)} h of elapsed time, so bins after it start at ${local} local time.`
	);
}
