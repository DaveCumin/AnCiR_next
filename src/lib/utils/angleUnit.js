// @ts-nocheck
// Which unit is a column of angles in?
//
// The Rayleigh test reads its input as radians, degrees or clock hours (`unit`). Read in the
// wrong unit the test still returns numbers, and they are wrong without looking wrong: clock
// hours 10.9 to 17 read as radians gave R 0.10, p 0.79 where the hours give R 0.89, p 1e-8.
// So a NEW node reads the unit from the data (inferAngleUnit), and any node says so when the
// unit it has cannot be right for the values it reads (angleUnitMismatch).
//
// THE RULE, in this order, on every finite value of every wired column:
//   1. radians  when they all lie within [-pi, 2 pi]            (one turn, signed or not)
//   2. hours    when they all lie within [0, period] or [-period/2, period/2]
//   3. degrees  when they all lie within [-180, 360]
//   4. radians  otherwise (unwrapped angles; nothing better can be said)
// It is a guess from the range alone. Clock hours that all fall before 06:17 pass rule 1 and
// read as radians, and degrees under 24 read as hours: the node shows which unit it read and
// the user can always choose another.
//
// Pure and dependency-free: the app, the headless engine and the MCP Worker all import it.

const PI = Math.PI;
// Slack on each bound, for values written to a few decimals (6.2832 for 2 pi).
const EPS = 1e-3;

const UNIT_LABEL = { radians: 'radians', degrees: 'degrees', hours: 'clock hours' };

const validPeriod = (period) => (Number.isFinite(period) && period > 0 ? period : 24);

/** The value ranges one turn can take in each unit: [[lo, hi], ...]. */
function turnRanges(unit, period) {
	const p = validPeriod(period);
	if (unit === 'degrees') return [[-180, 360]];
	if (unit === 'hours')
		return [
			[0, p],
			[-p / 2, p / 2]
		];
	return [[-PI, 2 * PI]];
}

const within = (range, [lo, hi]) => range.min >= lo - EPS && range.max <= hi + EPS;
const fits = (range, unit, period) => turnRanges(unit, period).some((r) => within(range, r));

/**
 * The smallest and largest finite value over one or more columns. Empty, blank and
 * non-numeric cells are skipped, as the test itself skips them (circular.js toRadiansColumn).
 * @param {any[][]} columns  one array of raw values per wired column
 * @returns {{min: number, max: number, n: number}|null} null when no value is finite
 */
export function angleRange(columns) {
	let min = Infinity;
	let max = -Infinity;
	let n = 0;
	for (const col of columns ?? []) {
		for (const v of col ?? []) {
			if (v == null || (typeof v === 'string' && v.trim() === '')) continue;
			const x = Number(v);
			if (!Number.isFinite(x)) continue;
			if (x < min) min = x;
			if (x > max) max = x;
			n++;
		}
	}
	return n ? { min, max, n } : null;
}

/**
 * The unit the values are most likely in (the rule at the top of this file).
 * @param {any[][]} columns  one array of raw values per wired column
 * @param {number} [period=24]  the cycle length in hours, for the clock-hours test
 * @returns {'radians'|'degrees'|'hours'|null} null when there is no finite value to judge
 */
export function inferAngleUnit(columns, period = 24) {
	const range = angleRange(columns);
	if (!range) return null;
	for (const unit of ['radians', 'hours', 'degrees']) if (fits(range, unit, period)) return unit;
	return 'radians';
}

const fmt = (v) => String(Number(v.toFixed(2)));

/**
 * Is the chosen unit contradicted by the data? It is when the values do not fit one turn in
 * that unit and do fit one turn in another. Values that fit no unit (unwrapped angles) are
 * not a contradiction, and neither are values that merely fit a second unit as well (0 to 6
 * could be radians, hours or degrees: only the user knows).
 * @param {any[][]} columns  one array of raw values per wired column
 * @param {'radians'|'degrees'|'hours'} unit  the unit the node reads them in
 * @param {number} [period=24]
 * @returns {{likely: string, min: number, max: number, message: string}|null}
 */
export function angleUnitMismatch(columns, unit, period = 24) {
	const range = angleRange(columns);
	if (!range || !UNIT_LABEL[unit] || fits(range, unit, period)) return null;
	const likely = ['radians', 'hours', 'degrees'].find((u) => u !== unit && fits(range, u, period));
	if (!likely) return null;
	return {
		likely,
		min: range.min,
		max: range.max,
		message: `The values run from ${fmt(range.min)} to ${fmt(range.max)}, more than one turn in ${UNIT_LABEL[unit]}, so they look like ${UNIT_LABEL[likely]} read as ${UNIT_LABEL[unit]}. If they are ${UNIT_LABEL[likely]}, set the unit to ${UNIT_LABEL[likely]}; the results are wrong until then.`
	};
}
