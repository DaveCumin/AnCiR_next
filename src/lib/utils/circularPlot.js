// Plot-facing wrappers around circular.js. These translate a column's raw
// values (in radians/degrees/clock-hours) into the polar display space used by
// the Circular phase plot, and expose per-series Rayleigh stats plus the
// across-group Watson-Williams test. Pure; no Svelte, no @stdlib (the F p-value
// arrives as a callback so this stays dependency-light and testable).
import {
	rayleighTest,
	toRadiansColumn,
	watsonWilliams,
	weightedRayleigh
} from '$lib/utils/circular.js';

const TAU = Math.PI * 2;

/**
 * Full-turn length expressed in the data's own unit.
 * @param {'radians'|'degrees'|'hours'} unit
 * @param {number} period - user period when unit === 'hours'
 * @returns {number}
 */
export function displayPeriodFor(unit, period) {
	if (unit === 'degrees') return 360;
	if (unit === 'hours') return Number.isFinite(period) && period > 0 ? period : 24;
	return TAU;
}

const ANGLE_UNITS = new Set(['radians', 'degrees', 'hours']);

/**
 * An angular width (a bin) re-expressed in another unit, keeping its angular size: 1 h of a
 * 24 h period is 15 degrees is 0.2618 rad. Hours use `period`.
 *
 * A width in radians is stored at full precision (it is almost never a round number). One in
 * degrees or hours is cleaned of floating-point noise at 12 significant digits, so a whole
 * number of degrees stays whole (15, not 14.999999999999998) and a round trip (hours to
 * degrees to radians and back) returns the width it started from. A part in 10^12 is far
 * below anything a bin can resolve, and this is not rounding for display.
 *
 * An unset width, or a unit this does not know, is returned unchanged.
 *
 * @param {unknown} width
 * @param {string} fromUnit
 * @param {string} toUnit
 * @param {number} [period] the cycle length in hours, for 'hours'
 */
export function convertAngularWidth(width, fromUnit, toUnit, period) {
	if (typeof width !== 'number' || !Number.isFinite(width)) return width;
	if (!ANGLE_UNITS.has(fromUnit) || !ANGLE_UNITS.has(toUnit) || fromUnit === toUnit) return width;
	const turns = width / displayPeriodFor(fromUnit, period);
	const out = turns * displayPeriodFor(toUnit, period);
	return toUnit === 'radians' ? out : Number(out.toPrecision(12));
}

/** Is any series of a Circular phase plot (live, or its toJSON snapshot) wired to a time? */
function hasTimedSeries(target) {
	return (target?.data ?? []).some((d) => Number(d?.x?.refId) >= 0);
}

/**
 * Change a Circular phase plot's `unit` (the unit its phase values are recorded in),
 * converting the fields stored in that unit, `binWidth` and `wedgeBinWidth`, so the bins keep
 * their angular size.
 *
 * THE one place a unit change happens. Every edit route reaches it through
 * CircularPhaseClass.pairedEdits (plots/pairedEdits.js): the Properties select, the
 * multi-select panel, an AI edit, the MCP render settings. It works on the live plot and on
 * its toJSON snapshot alike.
 *
 * It is deliberately NOT a `unit` setter: loading a session and undo (fromJSON) apply a state
 * whose widths are already in its unit, and a converting setter would convert them again.
 *
 * With a timed series wired the angle is always clock hours (displayPeriod ignores `unit`), so
 * the widths are hours too and only the unit is stored.
 *
 * @param {{ unit: string, period: number, binWidth: number, wedgeBinWidth: number, data?: any[] }} target
 * @param {string} unit
 * @returns {boolean} whether any width was converted
 */
export function setCircularUnit(target, unit) {
	const from = target.unit;
	target.unit = unit;
	if (from === unit || hasTimedSeries(target)) return false;
	if (!ANGLE_UNITS.has(from) || !ANGLE_UNITS.has(unit)) return false;
	target.binWidth = convertAngularWidth(target.binWidth, from, unit, target.period);
	target.wedgeBinWidth = convertAngularWidth(target.wedgeBinWidth, from, unit, target.period);
	return true;
}

/**
 * Rayleigh stats for one column, with the mean direction re-expressed in the
 * data unit (meanValue) so the plot can place the vector without re-deriving.
 * @param {any[]} values
 * @param {'radians'|'degrees'|'hours'} unit
 * @param {number} period
 * @returns {{ n:number, R:number, z:number, pValue:number, meanAngle:number, meanValue:number }}
 */
export function seriesStats(values, unit, period) {
	const rad = toRadiansColumn(values, unit, period);
	const r = rayleighTest(rad); // { n, R, meanAngle, z, pValue }
	const dp = displayPeriodFor(unit, period);
	const meanValue = Number.isFinite(r.meanAngle) ? (r.meanAngle / TAU) * dp : NaN;
	return { n: r.n, R: r.R, z: r.z, pValue: r.pValue, meanAngle: r.meanAngle, meanValue };
}

/**
 * Watson-Williams equal-mean-direction test across columns (each a group).
 * @param {any[][]} valueArrays
 * @param {'radians'|'degrees'|'hours'} unit
 * @param {number} period
 * @param {(F:number,df1:number,df2:number)=>number} pFromF
 * @returns {object} the watsonWilliams(...) result
 */
export function groupsWatsonWilliams(valueArrays, unit, period, pFromF) {
	const groups = (valueArrays ?? []).map((v) => toRadiansColumn(v, unit, period));
	return watsonWilliams(groups, pFromF);
}

/**
 * Clean a raw data column to numbers for polar plotting: finite numbers (and
 * numeric strings) are kept; null/undefined/blank/non-numeric cells become NaN
 * (which every consumer drops), so a gap never becomes a spurious 0 observation.
 * @param {any[]} data
 * @returns {number[]}
 */
export function cleanNumericColumn(data) {
	return (data ?? []).map((v) => {
		if (v == null || (typeof v === 'string' && v.trim() === '')) return NaN;
		const n = Number(v);
		return Number.isFinite(n) ? n : NaN;
	});
}

const TAU_P = Math.PI * 2;

/**
 * Convert a column to phase hours for polar plotting. A `time`-type column's
 * getData() returns epoch-ms → absolute hours (÷3.6e6); a numeric column's
 * values are raw hours. Gaps/blank/non-numeric → NaN.
 * @param {any[]} data
 * @param {string} columnType
 * @returns {number[]}
 */
export function columnToPhaseHours(data, columnType) {
	return (data ?? []).map((v) => {
		if (v == null || (typeof v === 'string' && v.trim() === '')) return NaN;
		const n = Number(v);
		if (!Number.isFinite(n)) return NaN;
		return columnType === 'time' ? n / 3_600_000 : n;
	});
}

/**
 * Fold hours modulo the period and map to radians (0 at phase 0).
 * @param {number} hours @param {number} period @returns {number}
 */
export function timeToAngleRad(hours, period) {
	if (!Number.isFinite(hours)) return NaN;
	const p = period > 0 ? period : 24;
	return ((((hours % p) + p) % p) / p) * TAU_P;
}

/**
 * Amplitude-weighted circular stats for a (time, value) series. Angle from
 * time (folded by period), weight from value. meanValue is the acrophase in
 * the period's hours.
 *
 * No Rayleigh z or p here (both NaN). The Rayleigh null is uniformly scattered
 * EVENTS; these weights are a series' values, so adding a constant baseline (no
 * rhythm at all) changes nEff and R and therefore the p-value. A p that moves
 * with an arbitrary offset tests nothing. R and the weighted acrophase stay:
 * they describe the series. For a rhythm test on (time, value) data use the
 * fixed-period cosinor (Cornelissen 2014, zero-amplitude F test).
 * @returns {{n,nEff,R,meanAngle,z,pValue,W,meanValue:number}}
 */
export function weightedSeriesStats(timeData, timeType, valueData, period) {
	const angles = columnToPhaseHours(timeData, timeType).map((h) => timeToAngleRad(h, period));
	const weights = cleanNumericColumn(valueData);
	const r = weightedRayleigh(angles, weights);
	const dp = displayPeriodFor('hours', period);
	const meanValue = Number.isFinite(r.meanAngle) ? (r.meanAngle / TAU_P) * dp : NaN;
	return { ...r, z: NaN, pValue: NaN, meanValue };
}
