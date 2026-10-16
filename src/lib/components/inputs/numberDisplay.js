// How a numeric input shows a stored number: faithfully, whatever its step.
//
// 12 significant digits keeps every digit a person enters or reads (a value of 1e-7 stays
// 1e-7, 0.0001 stays 0.0001) and is well short of the ~16 digits where binary float noise
// lives, so 0.1 + 0.2 shows as 0.3 and a unit round trip (1 h shown in minutes) shows 60.
// Display only: the stored value is never rounded.

const SIGNIFICANT_DIGITS = 12;

/** The number a field should show for `value` (non-finite values pass through). */
export function displayNumber(value) {
	const n = Number(value);
	if (!Number.isFinite(n)) return n;
	return Number(n.toPrecision(SIGNIFICANT_DIGITS));
}
