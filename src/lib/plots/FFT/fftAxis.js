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
	return [invertFftValue(lims?.[1]), invertFftValue(lims?.[0])];
}

/**
 * A period as a frequency or the other way round: 1/v for a finite positive number, else null
 * (an unset or non-positive end has no reciprocal and means "auto").
 *
 * @param {unknown} v
 * @returns {number|null}
 */
export function invertFftValue(v) {
	return typeof v === 'number' && Number.isFinite(v) && v > 0 ? 1 / v : null;
}

/**
 * Switch an FFT between period and frequency mode, converting every field that is stored in
 * the units of the mode: the user x limits (convertFftLimits) and a manual x tick list.
 *
 * THE one place a switch happens. Every edit route reaches it through FFTclass.pairedEdits
 * (plots/pairedEdits.js): the Properties checkbox, the multi-select shared field, an AI edit,
 * the MCP render settings. It works on the live plot and on its toJSON snapshot alike, since
 * both carry `showPeriod`, `xlimsIN` and `xAxis.manualTicks`.
 *
 * It is deliberately NOT the `showPeriod` setter. Loading a session, undo (both through
 * fromJSON) and the facet panel mirror (setByPath, limits before mode in key order) apply a
 * state whose limits are already in its mode; a converting setter would flip them again.
 *
 * @param {{ showPeriod: boolean, xlimsIN: any[], xAxis?: { manualTicks?: number[]|null } }} target
 * @param {boolean} showPeriod
 * @returns {boolean} whether the mode changed (and so the limits were converted)
 */
export function setFftShowPeriod(target, showPeriod) {
	const next = !!showPeriod;
	if (next === !!target.showPeriod) {
		target.showPeriod = next;
		return false;
	}
	target.xlimsIN = convertFftLimits(target.xlimsIN);
	const ticks = target.xAxis?.manualTicks;
	if (Array.isArray(ticks)) {
		target.xAxis.manualTicks = ticks
			.map(invertFftValue)
			.filter((v) => v != null)
			.sort((a, b) => a - b);
	}
	target.showPeriod = next;
	return true;
}

/**
 * A facet panel's override entry after its generator switched mode: an x limit override is
 * converted like the generator's own limits. Whole-pair (`xlimsIN`) and leaf (`xlimsIN[0]`,
 * which the facet migration writes) forms are both handled; a leaf moves to the OTHER end,
 * because the reciprocal reverses the order (a period minimum is a frequency maximum). A leaf
 * with no reciprocal becomes null, i.e. "auto" on that panel.
 *
 * @param {Record<string, unknown>} entry one unit's override map
 * @returns {Record<string, unknown>|null} the converted entry, or null when it has no x limit
 */
export function convertFftLimitOverride(entry) {
	if (entry == null || typeof entry !== 'object') return null;
	const has = (p) => Object.prototype.hasOwnProperty.call(entry, p);
	if (!has('xlimsIN') && !has('xlimsIN[0]') && !has('xlimsIN[1]')) return null;
	const out = { ...entry };
	delete out['xlimsIN[0]'];
	delete out['xlimsIN[1]'];
	if (has('xlimsIN')) out.xlimsIN = convertFftLimits(entry.xlimsIN);
	if (has('xlimsIN[1]')) out['xlimsIN[0]'] = invertFftValue(entry['xlimsIN[1]']);
	if (has('xlimsIN[0]')) out['xlimsIN[1]'] = invertFftValue(entry['xlimsIN[0]']);
	return out;
}
