// @ts-nocheck
// The unit of a free-period fit's period, phases and period range.
//
// The fits (Cosinor, Rectangular wave, Double logistic, Fit waveform model) work in the units
// of their x: hours since the first sample for a time column, the column's own numbers for a
// plain number column. Columns carry no unit field, so a number column's unit is unknown and
// is named for what it is, "x units", never guessed from the column name ("Time (days)").
//
// The period RANGE a new node starts with follows the same split: 1 to 48 h for a time x (the
// long-standing default), and for a number x the span the sampling can resolve, from the
// Nyquist period (twice the median sampling interval) to the record span. Only a node that
// carries `periodRangeAuto: true` follows its x like this; see
// tableProcesses/periodRangeAuto.svelte.js for why saved sessions never do.
import { FREE_PERIOD_DEFAULTS, resolvePeriodRange } from './cosinor.js';

export const PERIOD_UNIT_HOURS = 'h';
export const PERIOD_UNIT_X = 'x units';

/**
 * 'h' for a time column (and when the column is unknown, the long-standing label), else
 * 'x units'.
 * @param {{type?: string} | null | undefined} col
 */
export function periodUnitForColumn(col) {
	return col && col.type !== 'time' ? PERIOD_UNIT_X : PERIOD_UNIT_HOURS;
}

/** `v` rounded UP to 3 significant figures, so a rounded bound never cuts into the range. */
function ceil3(v) {
	if (!(v > 0) || !Number.isFinite(v)) return v;
	const step = 10 ** (Math.floor(Math.log10(v)) - 2);
	return Number((Math.ceil(v / step - 1e-9) * step).toPrecision(3));
}

/**
 * The period range a node that follows its x starts from, or null when x cannot give one.
 * Time x: FREE_PERIOD_DEFAULTS (1 to 48 h). Number x: the Nyquist period to the record span,
 * each rounded up to 3 significant figures.
 * @param {{type?: string, getData?: () => any[]} | null} col
 * @returns {{minPeriod: number, maxPeriod: number} | null}
 */
export function autoPeriodRange(col) {
	if (!col) return null;
	if (col.type === 'time') return { ...FREE_PERIOD_DEFAULTS };
	const data = col.getData?.() ?? [];
	const nums = [];
	for (const v of data) {
		if (v == null || v === '') continue;
		const n = Number(v);
		if (Number.isFinite(n)) nums.push(n);
	}
	const r = resolvePeriodRange(nums, null, null);
	if (!r) return null;
	const minPeriod = ceil3(r.nyquist);
	const maxPeriod = ceil3(r.span);
	return maxPeriod > minPeriod ? { minPeriod, maxPeriod } : null;
}

/**
 * `step` and `min` for a period-range input (NumberWithUnits). That input SHOWS its value
 * rounded to the decimals of `step` and CLAMPS it to `min` when it mounts, so the old step 1 /
 * min 0.1 showed an auto range of 0.0417 as "0" and would have rewritten it to 0.1 (changing
 * the result) the next time the panel opened. The step here has just enough decimals to show
 * the value to 4 significant figures, so a whole number keeps step 1 as before. The minimum is
 * 0 for every x: opening a panel must never change a stored range (and the x column, which
 * decides the unit, may not be resolved yet when the panel mounts). A range of 0 or less gets
 * periodRangeWarnings' "empty range" message instead.
 * @param {number} value  the current period value
 * @returns {{step: number, min: number}}
 */
export function periodInputProps(value) {
	const min = 0;
	const v = Math.abs(Number(value));
	if (!(v > 0) || !Number.isFinite(v)) return { step: 1, min };
	const shown = String(Number(v.toPrecision(4)));
	if (shown.includes('e'))
		return { step: Number((10 ** (Math.floor(Math.log10(v)) - 3)).toPrecision(1)), min };
	const dp = shown.includes('.') ? shown.split('.')[1].length : 0;
	return { step: dp === 0 ? 1 : Number((10 ** -dp).toFixed(dp)), min };
}
