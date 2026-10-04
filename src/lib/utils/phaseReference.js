// Time origin and phase reference: the ONE place that decides what "hour 0" is.
//
// Every analysis works in hours. For a time column those hours come from
// `Column.hoursSinceStart`, which measures from the MINIMUM valid timestamp
// (not the first row: the first row can be missing after a Split or Filter, and
// a column need not be sorted). Two things therefore have to agree with that
// baseline, and both used to be re-derived by each node:
//
// 1. The origin used to turn hour offsets back into timestamps on an output
//    time axis (a fitted curve's x, a smoothed series' x). Nodes used
//    `getData()[0]`, which differs from the minimum whenever the first row is
//    missing or the column is unsorted, so the output curve was drawn shifted
//    by `t[0] - min(t)` (review STAT-19). `timeOriginMs` is that baseline.
//
// 2. The reference for PHASE outputs (acrophase, bathyphase, onsets, L5/M10
//    onsets, profile bin times). By default these are hours after the first
//    sample, which is what every saved session has always reported. A node can
//    instead report them as clock time of day: hours after local midnight in the
//    session's display timezone, wrapped to [0, period) (review FIT-9).
//    `phaseOffsetHours` + `applyPhaseReference` do that conversion, so every
//    node agrees on it.
//
// The phase reference only RELABELS a phase: it never changes a fit, a bin or
// any statistic. Pure: no Svelte, no app state (the caller passes the zone).

import dayjs from './time/dayjsSetup.js';
import { min, isInvalidValue } from './stats.js';
import { wrapToPeriod } from './cosinorAddons.js';

/** The default: hours after the first (earliest) sample. Saved sessions without the arg. */
export const PHASE_REFERENCE_START = 'start';
/** Hours after local midnight (display timezone), wrapped to [0, period). */
export const PHASE_REFERENCE_CLOCK = 'clock';

/** The options a node's "Phase reference" control offers, in display order. */
export const PHASE_REFERENCE_OPTIONS = [
	{ value: PHASE_REFERENCE_START, label: 'Since first sample' },
	{ value: PHASE_REFERENCE_CLOCK, label: 'Clock time of day' }
];

/**
 * The epoch-ms origin of a time column's hour axis: its minimum valid timestamp,
 * the same baseline `Column.hoursSinceStart` measures from. Null for a non-time
 * column, a missing column, or a column with no valid value.
 *
 * @param {{type?: string, getData?: () => any[]}|null|undefined} col
 * @returns {number|null}
 */
export function timeOriginMs(col) {
	if (!col || col.type !== 'time' || typeof col.getData !== 'function') return null;
	const m = min(col.getData() ?? []);
	if (m == null) return null;
	const n = Number(m);
	return Number.isFinite(n) ? n : null;
}

/**
 * The hour frame shared by a fit's input x and its optional output-x grid.
 *
 * The fit runs in the INPUT column's hours, so the output grid must be expressed
 * in that same frame and the output axis must be turned back into timestamps from
 * that same origin. Reading the output column's own `hoursSinceStart` (measured
 * from ITS minimum) evaluated the model on a shifted clock whenever the two
 * columns started at different instants.
 *
 * - input x is time: origin = its minimum; a time output grid is converted with
 *   that origin; a numeric output grid is taken as hours in that frame (as before).
 * - input x is numeric and the output grid is time: the output grid keeps its own
 *   hours and origin (there is no common frame to convert into; unchanged).
 * - neither is time: no origin, raw values.
 *
 * Invalid output-grid values are dropped (a null-padded Split segment used as the
 * grid must not plot a point at hour 0).
 *
 * @param {object} tCol  the input x column
 * @param {object|null} [outputXCol]  the optional output-x column
 * @returns {{originTime_ms: number|null, outputXData: number[]|null}}
 */
export function fitTimeFrame(tCol, outputXCol = null) {
	const inOrigin = timeOriginMs(tCol);
	let originTime_ms = inOrigin;
	let outputXData = null;
	if (outputXCol) {
		if (outputXCol.type === 'time') {
			if (inOrigin != null) {
				outputXData = (outputXCol.getData() ?? [])
					.filter((v) => !isInvalidValue(v))
					.map((v) => (Number(v) - inOrigin) / 3600000);
			} else {
				originTime_ms = timeOriginMs(outputXCol);
				outputXData = (outputXCol.hoursSinceStart ?? []).filter((v) => !isInvalidValue(v));
			}
		} else {
			outputXData = (outputXCol.getData() ?? []).filter((v) => !isInvalidValue(v));
		}
	}
	return { originTime_ms, outputXData };
}

/**
 * Hours after local midnight of an instant, in `zone` ('utc' or an IANA name),
 * in [0, 24). NaN for a non-finite instant.
 *
 * @param {number} ms  epoch milliseconds
 * @param {string} [zone='utc']
 * @returns {number}
 */
export function clockHourOfDay(ms, zone = 'utc') {
	const n = Number(ms);
	if (ms == null || !Number.isFinite(n)) return NaN;
	const dt = !zone || zone === 'utc' ? dayjs.utc(n) : dayjs(n).tz(zone);
	if (!dt.isValid()) return NaN;
	return dt.hour() + dt.minute() / 60 + dt.second() / 3600 + dt.millisecond() / 3600000;
}

/**
 * Resolve a node's phase reference into the offset (h) to add to a phase measured
 * from the record's first sample.
 *
 * Clock time needs a real time axis. Asked for on a numeric x, it falls back to
 * "since first sample" and says why in `warning`, rather than silently reporting
 * the wrong frame.
 *
 * @param {string|undefined} reference  'start' (default) | 'clock'
 * @param {number|null} originMs  the x column's `timeOriginMs`
 * @param {string} [zone='utc']  the session's display timezone
 * @returns {{clock: boolean, offsetHours: number, warning: string|null}}
 */
export function resolvePhaseReference(reference, originMs, zone = 'utc') {
	if (reference !== PHASE_REFERENCE_CLOCK) return { clock: false, offsetHours: 0, warning: null };
	const offset = originMs == null ? NaN : clockHourOfDay(originMs, zone);
	if (!Number.isFinite(offset)) {
		return {
			clock: false,
			offsetHours: 0,
			warning:
				'Phase reference "Clock time of day" needs a time column as x; phases are reported as hours since the first sample instead.'
		};
	}
	return { clock: true, offsetHours: offset, warning: null };
}

/**
 * Express a phase (hours since the first sample) in the resolved reference.
 *
 * Since-first-sample returns the value UNTOUCHED (not even re-wrapped), so a
 * session without the arg is byte-identical to before. Clock time adds the
 * origin's clock hour and wraps to [0, period).
 *
 * @param {number} hrs  phase in hours since the first sample
 * @param {{clock: boolean, offsetHours: number}|null|undefined} ref  from resolvePhaseReference
 * @param {number} period  wrap period (h)
 * @returns {number}
 */
export function applyPhaseReference(hrs, ref, period) {
	if (!ref?.clock) return hrs;
	if (!Number.isFinite(hrs)) return NaN;
	return wrapToPeriod(hrs + ref.offsetHours, period);
}

/**
 * Relabel a folded profile's bin times into the resolved reference, keeping the
 * bins (and so every statistic) exactly as computed. Since-first-sample returns
 * the inputs unchanged. Clock time shifts each bin time by the origin's clock
 * hour, wraps it to [0, period) and reorders the bins (and every parallel array
 * in `series`) so the times ascend, which is what a line plot of the profile needs.
 *
 * @param {number[]} binTimes
 * @param {any[][]} series  arrays parallel to binTimes (profiles, SEMs, counts)
 * @param {{clock: boolean, offsetHours: number}|null|undefined} ref
 * @param {number} period
 * @returns {{binTimes: number[], series: any[][]}}
 */
export function relabelFoldedProfile(binTimes, series, ref, period) {
	if (!ref?.clock || !Array.isArray(binTimes)) return { binTimes, series };
	const shifted = binTimes.map((c) => applyPhaseReference(c, ref, period));
	const order = shifted.map((_, i) => i).sort((a, b) => shifted[a] - shifted[b]);
	return {
		binTimes: order.map((i) => shifted[i]),
		series: series.map((arr) => (Array.isArray(arr) ? order.map((i) => arr[i]) : arr))
	};
}

/**
 * The phase instant of a periodic component nearest `centre`: `phase` (any
 * representative, e.g. a peak time wrapped into [0, period)) moved by whole
 * periods to within half a period of `centre`. Used by rolling analyses so a
 * window's phase is read where the window's data are, not extrapolated across the
 * whole record with that window's (slightly wrong) period.
 *
 * @param {number} phase
 * @param {number} period
 * @param {number} centre
 * @returns {number}
 */
export function nearestPhaseInstant(phase, period, centre) {
	if (!Number.isFinite(phase) || !(period > 0) || !Number.isFinite(centre)) return NaN;
	return phase + period * Math.round((centre - phase) / period);
}
