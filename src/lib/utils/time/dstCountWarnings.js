// @ts-nocheck
// What a zoned zone-less time column says about its daylight-saving anomalies (per-column time
// zone, phase 3; plan ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md, sections 3.10
// and 5f): times in the hour a change skipped, and times in the hour it repeated that do not
// step back through it in order. The counts come from the resolver (zoneResolver.js
// resolveWallClocks).
//
// Pure (zoneNames.js only), so the MCP Worker's check_draft (mcp/src/emit/timeColumns.js) words
// them exactly as the app's column warnings do (core/columnWarnings.js re-exports this). The
// Python and R ports (tools/ancir_runtime.py and .R dst_count_warnings) print the same text.

import { zoneLabel } from './zoneNames.js';

const FIXED_OFFSET_ADVICE = 'This logger may not follow daylight saving: try a fixed offset.';

/**
 * The daylight-saving warnings for a zoned zone-less column's read (`counts` from
 * resolveWallClocks, with its zone), in the order skipped, repeated out of order. Empty when
 * none. Every phrase that depends on the count agrees with it ("1 time falls", "2 times fall").
 * @param {{ zone: string, unordered: number, skipped: number }|null} counts
 * @returns {string[]}
 */
export function dstCountWarnings(counts) {
	if (!counts) return [];
	const zone = zoneLabel(counts.zone, { bare: true });
	const out = [];
	if (counts.skipped > 0) {
		const one = counts.skipped === 1;
		out.push(
			`${one ? '1 time falls' : `${counts.skipped.toLocaleString()} times fall`} in the hour ` +
				`skipped when daylight saving began in ${zone}, so ${one ? 'it does' : 'they do'} not ` +
				`exist there; ${one ? 'it is' : 'they are'} moved forward by the change (02:30 reads ` +
				`03:30 after a 1 h change). ${FIXED_OFFSET_ADVICE}`
		);
	}
	// Read in order (a logger that follows daylight saving) is what should happen: said beside
	// the zone picker (core/columnTimeZone.js zoneShiftNote), not warned. Only the runs that
	// could not be read in order are.
	if (counts.unordered > 0) {
		const one = counts.unordered === 1;
		out.push(
			`${one ? '1 time falls' : `${counts.unordered.toLocaleString()} times fall`} in the hour ` +
				`repeated when daylight saving ended in ${zone}, and ${one ? 'does' : 'do'} not step ` +
				`back through it in order, so ${one ? 'it' : 'each'} is read as the earlier ` +
				`(daylight-saving) time. ${FIXED_OFFSET_ADVICE}`
		);
	}
	return out;
}
