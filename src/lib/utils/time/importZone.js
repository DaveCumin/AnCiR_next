// @ts-nocheck
// The time zone the import dialog proposes for a time column (plan 3.3, STAT-18).
//
// Only offsets the TEXT carries count ("2024-03-10T08:00:00+13:00", "…Z"): they are facts
// about the data. A column with none is proposed as 'utc', shown "As written", and the user
// picks a zone if they know one. Nothing is guessed silently: whatever is proposed is shown
// in the zone picker with the offsets that led to it.

import { normalizeTimeFormat, parseTimeStrict, valueOffsetMinutes } from './TimeUtils.js';
import { suggestZoneFromOffsets, localZone } from './zones.js';

// Enough to see a daylight-saving change in a long file without reading all of it.
const MAX_SAMPLES = 2000;

/**
 * @param {unknown[]} values the column's text values (a sample is fine)
 * @param {string|string[]} fmt the column's time format
 * @param {{ preferZone?: string, zones?: string[] }} [opts] preferZone defaults to the
 *   computer's zone (tried first when the offsets change within the column)
 * @returns {{ zone: string, note: string|null, offsets: string[] } | null} null when no value
 *   carries an offset
 */
export function suggestImportZone(values, fmt, opts = {}) {
	if (!Array.isArray(values) || fmt == null || fmt === '' || fmt === -1) return null;
	const formats = (Array.isArray(fmt) ? fmt : [fmt]).filter((f) => typeof f === 'string' && f);
	if (formats.length === 0) return null;
	const samples = [];
	for (const v of values) {
		if (typeof v !== 'string' || v.trim() === '') continue;
		const offset = valueOffsetMinutes(v, formats);
		if (offset == null) continue;
		const norm = formats.map(normalizeTimeFormat);
		const instant = parseTimeStrict(v.trim(), norm.length === 1 ? norm[0] : norm).valueOf();
		if (!Number.isFinite(instant)) continue;
		samples.push({ instant, offset });
		if (samples.length >= MAX_SAMPLES) break;
	}
	if (samples.length === 0) return null;
	return suggestZoneFromOffsets(samples, {
		preferZone: opts.preferZone ?? localZone(),
		zones: opts.zones
	});
}
