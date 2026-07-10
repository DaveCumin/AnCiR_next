// Plot-facing wrappers around circular.js. These translate a column's raw
// values (in radians/degrees/clock-hours) into the polar display space used by
// the Circular phase plot, and expose per-series Rayleigh stats plus the
// across-group Watson-Williams test. Pure; no Svelte, no @stdlib (the F p-value
// arrives as a callback so this stays dependency-light and testable).
import { rayleighTest, toRadiansColumn, watsonWilliams } from '$lib/utils/circular.js';

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
