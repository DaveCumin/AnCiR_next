// @ts-nocheck
// The sentences that say two time columns are in different zones (per-column time zone; plan
// ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md, sections 3.4, 3.8 and decisions 7
// and 8). Pure: callers pass each column's clock (core/columnTimeZone.js `columnClock`, or the
// MCP's reading of a session file, mcp/src/emit/timeColumns.js), so the app's panels and the
// MCP's check_draft say exactly the same thing.

import { zoneLabel } from './zoneNames.js';

/**
 * What the summary and the warnings say about the two time columns' zones (per-column time
 * zone; plan section 3.8 and decision 8). The joined time column takes A's zone.
 *
 * - `summary`: "Joined times are in A's zone (Pacific/Auckland)." Empty for a legacy session
 *   (one zone for every column), for two UTC columns, and (the caller) for number times.
 * - `warning`, when A and B are in different zones. Every time column holds true instants
 *   (phase 3), so the two already line up:
 *     a non-zero shift is probably a double correction (a session that compensated by hand
 *     before the zones were set);
 *     with no shift, a side whose times are written with no zone and left as UTC ("as
 *     written") is named, in case its clock was really in another zone.
 *
 * @param {{ named: string, wall: boolean, legacy: boolean }|null} a  A's clock (columnClock)
 * @param {{ named: string, wall: boolean, legacy: boolean }|null} b  B's clock
 * @param {number} shiftB  hours
 * @returns {{ summary: string, warning: string|null }}
 */
export function joinZoneNotes(a, b, shiftB = 0) {
	if (!a || !b || a.legacy) return { summary: '', warning: null };
	// Two UTC columns (the default, "as written"): nothing to say.
	if (a.named === 'utc' && b.named === 'utc') return { summary: '', warning: null };
	const summary = `Joined times are in A's zone (${zoneLabel(a.named)}).`;
	if (a.named === b.named) return { summary, warning: null };
	const zones = `A's times are in ${zoneLabel(a.named)} and B's in ${zoneLabel(b.named)}`;
	const shift = Number(shiftB) || 0;
	if (shift !== 0) {
		return {
			summary,
			warning: `${zones}; each is read in its own zone, so they already line up and the zones account for the difference: check the ${shift} h shift.`
		};
	}
	const asWritten = b.wall ? 'B' : a.wall ? 'A' : null;
	if (!asWritten) return { summary, warning: null };
	const other = asWritten === 'B' ? a.named : b.named;
	return {
		summary,
		warning: `${asWritten}'s times have no zone, so they are read as UTC. If they were recorded in ${zoneLabel(other)} time, set ${asWritten}'s zone (in its column's Properties) and the two line up.`
	};
}

/**
 * The actogram's note when its series' times are in different zones: the rows follow the
 * first series' zone (decision 7).
 * @param {string} zone the first series' zone
 */
export function actogramMixedZonesNote(zone) {
	return `The series' times are in different zones; the rows follow ${zoneLabel(zone)}, the first series' zone.`;
}

/**
 * A time axis's note when its series' times are in different zones: the axis shows the first
 * series' zone (decision 7). `shown` is that zone as the axis names it (a label, since "Show
 * times in" may override it in the app).
 * @param {string} shown
 */
export function axisMixedZonesNote(shown) {
	return `The series' times are in different zones; the x axis shows ${shown}, the first series' zone.`;
}
