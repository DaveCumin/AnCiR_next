// @ts-nocheck
// What the label beside each actogram row says, and how much room it needs.
//
// Pulled out of Actogram.svelte rather than left as two closures in the instance script.
// The arithmetic is the interesting part (period drift, display zone, an unusable format
// string), and none of it is testable while it lives inside a component that needs a wired
// plot and a browser to render. The component keeps the SVG; this keeps the decisions.
import dayjs from '$lib/utils/time/dayjsSetup.js';
import { DEFAULT_DATE_FORMAT } from '$lib/utils/time/displayTime.js';

export { DEFAULT_DATE_FORMAT };

/**
 * The three things the labels beside the rows can be.
 *
 * One field rather than a boolean plus a mode. The pair was the first shape, kept because it
 * let an old session load untouched, but it made two states mean the same thing (off-with-
 * period and off-with-date are both just off) and every reader had to check both fields to
 * know what was drawn. Migration handles the old sessions instead; see `migrateRowLabels`.
 */
export const ROW_LABEL_MODES = ['none', 'period', 'date'];

/**
 * The text for row `day` (0-based).
 *
 * PERIOD MODE is the ordinal, 1-based, because "period 1" is what a chronobiologist says
 * about the first row.
 *
 * DATE MODE takes `startTime` (already snapped to the start of a day in the display zone)
 * and adds n whole periods. `periodHrs` is part of the arithmetic rather than assumed to be
 * 24, and that matters: on a free-running record at tau = 23.7 the rows drift against the
 * calendar. The drift is the point. Each label states when that cycle actually began, not
 * which calendar day it approximately belongs to. Two adjacent rows can therefore carry the
 * same date, which is correct rather than a bug.
 *
 * Formatting uses the same display zone as the x axis, so a row cannot read as one date
 * while the axis beneath it reads as another.
 *
 * @param {number} day 0-based row index
 * @param {object} opts
 * @param {'period'|'date'} [opts.mode]
 * @param {number|null} [opts.startTime] unix ms of the first row
 * @param {number} [opts.periodHrs]
 * @param {string} [opts.dateFormat] a dayjs format string
 * @param {string} [opts.zone] IANA zone, or 'utc'
 * @returns {string}
 */
export function rowLabelText(day, { mode, startTime, periodHrs, dateFormat, zone } = {}) {
	const ordinal = String(day + 1);
	if (mode !== 'date') return ordinal;
	// No time base means no date to state. Falling back to the ordinal keeps the axis
	// labelled; blanking it would look like a rendering failure.
	if (startTime == null || !Number.isFinite(startTime)) return ordinal;

	const hrs = Number.isFinite(periodHrs) && periodHrs > 0 ? periodHrs : 24;
	const ms = startTime + day * hrs * 3600000;
	const dt = zone === 'utc' || !zone ? dayjs.utc(ms) : dayjs(ms).tz(zone);
	if (!dt.isValid()) return ordinal;

	// dayjs echoes tokens it does not know, so a nonsense format produces nonsense rather
	// than throwing. The one case worth catching is an EMPTY result, which would silently
	// unlabel every row.
	const text = dt.format(dateFormat || DEFAULT_DATE_FORMAT);
	return text && text.trim() ? text : dt.format(DEFAULT_DATE_FORMAT);
}

/**
 * Horizontal room the row labels need, ADDED to the user's left padding the same way the
 * light bands add to the top.
 *
 * Without it the labels draw at `padding.left - 10` and run off the left edge of the SVG:
 * even "12" was clipped at the default padding of 20, and "05 Aug" is three times wider.
 *
 * Estimated from the character count (about 6 px per character at font-size 10) rather than
 * measured. Measuring would mean a DOM read inside a `$derived`, which is both a render-order
 * hazard and unavailable during export; over-reserving a few pixels of margin is much the
 * cheaper mistake.
 *
 * The date sample replaces every letter with `M`, because `MMM` renders as a three-letter
 * month name and so is wider than its own token; measuring the token text would under-reserve.
 *
 * @returns {number} pixels, 0 when the labels are off
 */
export function rowLabelGutter({ mode, dateFormat, nRows } = {}) {
	if (mode !== 'period' && mode !== 'date') return 0;
	const sample =
		mode === 'date'
			? (dateFormat || DEFAULT_DATE_FORMAT).replace(/[A-Za-z]/g, 'M')
			: String(Math.max(1, Math.floor(nRows ?? 1)));
	return Math.ceil(sample.length * 6) + 4;
}

/**
 * The row-label mode for a loaded session, from whichever fields it carries.
 *
 * Sessions exist in three vintages:
 *   • before row labels were configurable: `showDayNumbers` true/false only
 *   • v72.11's intermediate shape: `showDayNumbers` plus `rowLabelMode`
 *   • now: `rowLabels`
 *
 * The boolean stays authoritative for OFF in both legacy shapes, because that is what it
 * meant; a session that had labels switched off must not come back with them on.
 *
 * @returns {'none'|'period'|'date'}
 */
export function migrateRowLabels(json) {
	if (ROW_LABEL_MODES.includes(json?.rowLabels)) return json.rowLabels;
	// Legacy. `showDayNumbers` absent entirely ⇒ a session older than the feature ⇒ off.
	if (!json?.showDayNumbers) return 'none';
	return json?.rowLabelMode === 'date' ? 'date' : 'period';
}
