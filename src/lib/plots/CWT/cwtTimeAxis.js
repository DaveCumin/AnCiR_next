// The CWT's time axis, in the data's own time.
//
// The transform runs on hours since the first sample (Column.hoursSinceStart: only the spacing
// matters to the wavelets, and every period parameter is in hours). The axis used to label
// those offsets directly, so every scalogram started at 0 whatever the record was: a numeric
// time column running 48 .. 120 h read 0 .. 72, and a time column read 0 .. N hours with no
// date at all. Here the offsets are put back on the column's own scale:
//   - a time column: clock ticks (zoneAlignedTicks / d3 UTC ticks), labelled as every other
//     time axis is (formatTimeAxisTick, in the zone the column is shown in);
//   - a numeric or bin column: the five evenly spaced ticks as before, plus the column's own
//     first value, so the labels are the column's values.
import { scaleUtc } from 'd3-scale';
import { formatTimeAxisTick, zoneAlignedTicks } from '$lib/utils/time/displayTime.js';

const MS_PER_HOUR = 3600000;
const FRACTIONS = [0, 0.25, 0.5, 0.75, 1];

/**
 * The column value at hours-since-start 0: the first sample's own value minus its offset.
 * null when the column has no paired finite value (nothing to anchor to).
 * @param {{getData?: () => any[], hoursSinceStart?: any[]}|null|undefined} xCol
 * @returns {number|null}
 */
export function columnOrigin(xCol) {
	const hss = xCol?.hoursSinceStart ?? [];
	let raw;
	try {
		raw = xCol?.getData?.() ?? [];
	} catch {
		return null;
	}
	const n = Math.min(hss.length, raw.length);
	for (let i = 0; i < n; i++) {
		const h = hss[i];
		const v = raw[i];
		if (h == null || v == null || v === '') continue;
		const hn = Number(h);
		const vn = Number(v);
		if (!Number.isFinite(hn) || !Number.isFinite(vn)) continue;
		return xCol.type === 'time' ? vn - hn * MS_PER_HOUR : vn - hn;
	}
	return null;
}

/**
 * @param {{t0: number, t1: number, width: number, xCol: any}} args  t0 / t1: the transform's
 *   first and last time in hours since the start; width: the plot area in px
 * @returns {{title: string, ticks: Array<{x: number, label: string}>}}
 */
export function cwtTimeAxis({ t0, t1, width, xCol }) {
	const origin = columnOrigin(xCol);
	if (xCol?.type === 'time' && origin != null) {
		const lo = origin + t0 * MS_PER_HOUR;
		const hi = origin + t1 * MS_PER_HOUR;
		const utcTicks = (domain, count) => scaleUtc().domain(domain).ticks(count);
		const dates = zoneAlignedTicks([lo, hi], 5, xCol, utcTicks) ?? utcTicks([lo, hi], 5);
		return {
			title: 'Time',
			ticks: dates.map((d) => {
				const ms = +d;
				return { x: ((ms - lo) / (hi - lo || 1)) * width, label: formatTimeAxisTick(ms, xCol) };
			})
		};
	}
	const off = origin ?? 0;
	return {
		title: 'Time (h)',
		ticks: FRACTIONS.map((f) => ({
			x: f * width,
			label: (off + t0 + f * (t1 - t0)).toFixed(0)
		}))
	};
}

/**
 * The CWT export's time for an hours-since-start offset, in the record's own time like the
 * axis: an ISO instant for a time column (as the Scatterplot exports times), the column's own
 * hours for a numeric one. The export used to write the bare offsets, starting at 0.
 * @param {any} xCol
 * @returns {(hours: number) => number|string}
 */
export function exportTimeOf(xCol) {
	const origin = columnOrigin(xCol);
	if (origin == null) return (h) => h;
	if (xCol?.type === 'time') {
		return (h) => new Date(origin + h * MS_PER_HOUR).toISOString();
	}
	return (h) => origin + h;
}
