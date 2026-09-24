// @ts-nocheck
// The FFT plot's x axis can show either frequency or period, and its label has to say which.
//
// Before this module the label was a plain stored string, set once and never touched again.
// Sessions saved before AxisClass existed carried no axis object at all, and fromJSON gave
// them the label 'Frequency' whatever the mode, so a plot drawing PERIODS (peaks at 12.4 and
// 24 h) went out to papers labelled "Frequency". Toggling the mode had the same effect in
// the other direction.
//
// The rule now: a label that is one of the labels this plot has ever generated for itself is
// "automatic" and follows the mode. Anything else is the user's own wording and is kept.

export const FFT_PERIOD_LABEL = 'Period (hours)';
export const FFT_FREQUENCY_LABEL = 'Frequency (cycles/h)';

/**
 * Labels this plot has written itself at one time or another, so none of them is a user
 * decision. 'Frequency' is the legacy fallback; the others are the current pair and the
 * spellings used in the CSV export and control panel. An EMPTY label is not here: clearing
 * the box is a deliberate "no label", and the mode switch must not refill it.
 */
const AUTO_LABELS = new Set([
	'Frequency',
	'Period',
	'Period (h)',
	FFT_PERIOD_LABEL,
	FFT_FREQUENCY_LABEL,
	'Frequency (cycles/hr)'
]);

/** @param {string|null|undefined} label */
export function isAutoFftLabel(label) {
	return AUTO_LABELS.has(String(label ?? '').trim());
}

/**
 * The x-axis label to draw.
 *
 * @param {string|null|undefined} current the stored label
 * @param {boolean} showPeriod whether the axis is in period mode
 * @returns {string}
 */
export function fftXAxisLabel(current, showPeriod) {
	if (!isAutoFftLabel(current)) return current;
	return showPeriod ? FFT_PERIOD_LABEL : FFT_FREQUENCY_LABEL;
}

/**
 * Convert user x limits across a period/frequency switch.
 *
 * Period and frequency are reciprocals, so the conversion also SWAPS the ends: periods
 * [5, 30] are frequencies [1/30, 1/5]. An unset (null) or non-positive end stays unset,
 * meaning "auto", rather than becoming Infinity.
 *
 * @param {[number|null, number|null]} lims
 * @returns {[number|null, number|null]}
 */
export function convertFftLimits(lims) {
	const inv = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? 1 / v : null);
	return [inv(lims?.[1]), inv(lims?.[0])];
}
