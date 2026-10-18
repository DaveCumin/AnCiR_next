// @ts-nocheck
// "Specify output x values" on the fitting nodes (Cosinor, Rectangular wave, Double logistic,
// Fit waveform model, Trend fit): WHERE the fitted curve is evaluated.
//
// Two ways to give the x values (`outputXMode`):
//   - 'column' (the default, and what every session saved before this arg existed means): the
//     values of the column `outputX` names, read by phaseReference.js fitTimeFrame.
//   - 'sequence': an evenly spaced sequence over the node's OWN x input, every `outputXStep`
//     x units (hours for a time x), so a smooth curve needs no Sequence Column node.
//
// The option is on when `outputX` is not -1 (the checkbox writes the x input's id there, as it
// always has); the mode only says how the values are made. So a saved session that never had
// `outputXMode` reads as 'column', unchanged, and switching back from 'sequence' finds the
// column it had.
//
// THE SEQUENCE. From the minimum to the maximum of the x input's valid values (blanks and
// text ignored), in the fit's own frame (hours since the earliest sample for a time x; the
// column's numbers otherwise): min, min + step, min + 2 step, ... up to the last value that is
// not past the maximum. The maximum itself is in the sequence when it lands on the grid (to
// 1e-9 of a step, interpolate.js gridPointCount); otherwise the sequence stops at the last
// step below it, so the curve is never evaluated outside the data. Each value is min + i step
// (no running sum, so no drift). A time x comes back as timestamps through the same
// originTime_ms as a time column does (writeXOutput), so outputs, residuals (always at the
// input x) and plots behave exactly as in column mode.
//
// THE DEFAULT STEP (`outputXStep` null, or not a positive number). span / 500 snapped to the
// nearest 1-2-5 number on a log scale (1, 2, 5, 10, 20, ...), so about 300 to 700 points
// whatever the record length: 2 days of hourly data (span 47 or 48 h) gives 0.1 h. It follows
// the x, like any automatic default, until a step is typed.
//
// THE LIMIT. A step that would give more than MAX_GRID_POINTS (2,000,000) values makes no
// sequence: the node warns with the shared grid-limit message and shows the fit at the input
// x, as if no output x values were specified.
//
// The Python and R ports (tools/ancir_runtime.py, .R) implement the same rules and are held
// to it by the parity fixtures.
import { isInvalidValue } from './stats.js';
import { gridPointCount, gridTooLargeWarning, makeGrid, MAX_GRID_POINTS } from './interpolate.js';
import { fitTimeFrame, timeOriginMs } from './phaseReference.js';

export const OUTPUT_X_MODE_COLUMN = 'column';
export const OUTPUT_X_MODE_SEQUENCE = 'sequence';

/** The modes, in the order the control offers them. */
export const OUTPUT_X_MODES = [OUTPUT_X_MODE_COLUMN, OUTPUT_X_MODE_SEQUENCE];

/** Points the default step aims for over the x span. */
export const OUTPUT_X_DEFAULT_POINTS = 500;

/** The units a step on a time x can be typed in (the same set the period inputs use). */
export const OUTPUT_X_HOUR_UNITS = Object.freeze({
	default: 'h',
	days: 24,
	h: 1,
	min: 1 / 60,
	s: 1 / (60 * 60)
});

/** The lead of the warning when the step would make too many values. */
export const OUTPUT_X_LIMIT_LEAD =
	'No output x sequence was made (the fit is shown at the input x)';

/** Whether "Specify output x values" is on (an output x is given in either mode). */
export function outputXSpecified(args) {
	return args?.outputX != null && args.outputX !== -1;
}

/** 'sequence' when the option is on and set to a sequence, else 'column'. */
export function outputXMode(args) {
	return args?.outputXMode === OUTPUT_X_MODE_SEQUENCE
		? OUTPUT_X_MODE_SEQUENCE
		: OUTPUT_X_MODE_COLUMN;
}

/** Whether the node evaluates its fit on a sequence over its x. */
export function outputXIsSequence(args) {
	return outputXSpecified(args) && outputXMode(args) === OUTPUT_X_MODE_SEQUENCE;
}

/** The column whose values are the output x: `outputX` in column mode, else -1 (none). */
export function outputXColumnId(args) {
	return outputXSpecified(args) && !outputXIsSequence(args) ? args.outputX : -1;
}

/**
 * `v` snapped to the nearest 1-2-5 number on a log scale (the cut points are sqrt(2),
 * sqrt(10) and sqrt(50) times a power of ten). Null for a value that is not positive and finite.
 * @param {number} v
 * @returns {number|null}
 */
export function niceStep(v) {
	if (!(v > 0) || !Number.isFinite(v)) return null;
	const e = Math.floor(Math.log10(v));
	const scale = (c, k) => (k >= 0 ? c * 10 ** k : c / 10 ** -k);
	const m = v / scale(1, e);
	let c;
	if (m < Math.SQRT2) c = 1;
	else if (m < Math.sqrt(10)) c = 2;
	else if (m < Math.sqrt(50)) c = 5;
	else c = 10;
	return c === 10 ? scale(1, e + 1) : scale(c, e);
}

/** The finite numbers among `values` (blanks, text and NaN dropped). */
function finiteValues(values) {
	const out = [];
	for (const v of values ?? []) {
		if (isInvalidValue(v)) continue;
		const n = Number(v);
		if (Number.isFinite(n)) out.push(n);
	}
	return out;
}

/** Min and max of the finite numbers among `values`, or null when there are fewer than 2 distinct. */
function valueRange(values) {
	let lo = Infinity;
	let hi = -Infinity;
	for (const n of finiteValues(values)) {
		if (n < lo) lo = n;
		if (n > hi) hi = n;
	}
	return hi > lo ? { lo, hi } : null;
}

/**
 * The default step for x values `values` (in the fit's frame): span / 500, 1-2-5 snapped.
 * Null when the values have no span.
 * @param {any[]} values
 * @returns {number|null}
 */
export function defaultOutputXStep(values) {
	const r = valueRange(values);
	return r ? niceStep((r.hi - r.lo) / OUTPUT_X_DEFAULT_POINTS) : null;
}

/** The step a node uses: the stored one when it is a positive number, else the default. */
function effectiveStep(values, step) {
	const s = step == null || step === '' ? NaN : Number(step);
	return s > 0 && Number.isFinite(s) ? s : defaultOutputXStep(values);
}

/**
 * The output x sequence over `values` (the fit's x, in its own frame).
 * @param {any[]} values  the x input's values (hours since start for a time x)
 * @param {number|null} step  x units; null (or not a positive number) for the default
 * @param {string} [unit]  ' h' for a time x, for the warning
 * @returns {{values: number[]|null, step: number|null, warning: string|null}}
 *   `values` null when there is no sequence (no span, or over the limit, which `warning` says).
 */
export function outputXSequence(values, step, unit = '') {
	const r = valueRange(values);
	if (!r) return { values: null, step: null, warning: null };
	const s = effectiveStep(values, step);
	if (!(s > 0)) return { values: null, step: null, warning: null };
	if (gridPointCount(r.lo, r.hi, s) > MAX_GRID_POINTS) {
		return {
			values: null,
			step: s,
			warning: gridTooLargeWarning(r.lo, r.hi, s, unit, MAX_GRID_POINTS, {
				lead: OUTPUT_X_LIMIT_LEAD,
				hint: ''
			})
		};
	}
	return { values: makeGrid(r.lo, r.hi, s), step: s, warning: null };
}

/**
 * Where a fitting node evaluates its curve: the output x values in the fit's frame, the origin
 * that turns hours back into timestamps, and a warning (or null). Column mode is exactly
 * fitTimeFrame; sequence mode builds the sequence over the x input and uses the x input's
 * origin, the same origin a time output column on a time x gets.
 *
 * @param {object} tCol  the x input column
 * @param {object} args  the node's args (outputX, outputXMode, outputXStep)
 * @param {(id: number) => object|null} getColumn  column lookup (getColumnById)
 * @returns {{outputXData: number[]|null, originTime_ms: number|null, warning: string|null}}
 */
export function resolveOutputX(tCol, args, getColumn) {
	if (!outputXIsSequence(args)) {
		const outCol = outputXSpecified(args) ? getColumn(args.outputX) : null;
		return { ...fitTimeFrame(tCol, outCol), warning: null };
	}
	const isTime = tCol?.type === 'time';
	const xs = isTime ? tCol.hoursSinceStart : tCol?.getData?.();
	const seq = outputXSequence(xs, args.outputXStep, isTime ? ' h' : '');
	return {
		outputXData: seq.values,
		originTime_ms: timeOriginMs(tCol),
		warning: seq.warning
	};
}
