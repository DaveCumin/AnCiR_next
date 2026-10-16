// How a numeric input shows a stored number. Display only: the stored value is never rounded.
//
// Two forms, picked by whether the box is being edited:
//
// - displayNumber (focused, editing): 12 significant digits. That keeps every digit a person
//   enters or reads (1e-7 stays 1e-7, 0.0001 stays 0.0001) and is well short of the ~16
//   digits where binary float noise lives, so 0.1 + 0.2 shows as 0.3 and a unit round trip
//   (1 h shown in minutes) shows 60. Whoever is editing sees exactly what is stored.
//
// - readableNumber (not focused, reading): tidy. A computed value such as an automatic axis
//   limit (-1.66034981338) shows as -1.66035. The rule, per value:
//     decimals = max(decimals of the step, decimals for 6 significant digits)
//   so 1/3 shows 0.333333, 1e-7 shows 1e-7 (a small value always keeps its leading
//   significant digits, whatever the step), and integers stay integers. Whole-number digits
//   are never rounded away: 1234567.89 with step 1 shows 1234568, not 1234570 or 1.23457e+6,
//   because a number box that shows a different whole number from the one stored reads as a
//   wrong value, and an exponent is hard to read in a small box. When the step is finer than
//   6 significant digits allow (1234567.89 with step 0.01) the step wins and every stepped
//   digit shows, so the spinner arrows visibly change the number.

const EDIT_DIGITS = 12;
const READ_DIGITS = 6;

/** The number a field should show for `value` while it is being edited (non-finite values pass through). */
export function displayNumber(value) {
	const n = Number(value);
	if (!Number.isFinite(n)) return n;
	return Number(n.toPrecision(EDIT_DIGITS));
}

/** Decimal places a step implies: 0.01 -> 2, 1e-7 -> 7, 2.5e-3 -> 4, 1 -> 0. */
export function stepDecimals(step) {
	const s = Number(step);
	if (!Number.isFinite(s) || s <= 0) return 0;
	const [mantissa, exponent = '0'] = String(s).toLowerCase().split('e');
	const fraction = mantissa.split('.')[1]?.length ?? 0;
	return Math.max(0, fraction - Number(exponent));
}

/** The number a field should show for `value` while it is only being read (non-finite values pass through). */
export function readableNumber(value, step = 1) {
	const n = Number(value);
	if (!Number.isFinite(n)) return n;
	if (Number.isInteger(n)) return n;
	const significantDecimals = READ_DIGITS - 1 - Math.floor(Math.log10(Math.abs(n)));
	const decimals = Math.max(0, stepDecimals(step), significantDecimals);
	// toFixed takes at most 100 places; anything that small is shown by significant digits.
	const rounded =
		decimals <= 100 ? Number(n.toFixed(decimals)) : Number(n.toPrecision(READ_DIGITS));
	// Never more than the editing form shows, so no float noise survives a fine step.
	return displayNumber(rounded);
}
