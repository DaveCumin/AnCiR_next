// @ts-nocheck
// Row selection for analyses that fit y against x.
//
// This exists because the obvious hand-rolled version is WRONG in a way that does not
// announce itself:
//
//     t.map((v, i) => (isNaN(v) || isNaN(y[i]) ? -1 : i)).filter((i) => i !== -1)
//
// `isNaN(null)` is FALSE and `Number(null)` is 0, so every null row survives that filter and
// is then fitted as a ZERO. Split and Filter emit full-length segments padded with null
// outside their window, so fitting any segment hit it. Measured on a clean 24 h cosine
// (mesor 10, amplitude 5) split at day 4: mesor → 5.000, amplitude → 2.500 (exactly halved,
// half the rows were zeros) and a free-period fit → ~234 h instead of 24 h. Acrophase
// survived untouched, which is why it stayed hidden for so long: the fit looks plausible and
// only the period is nonsense.
//
// Every fitting node duplicated that filter inline (FitFunction had two verbatim copies of
// it in one file). One implementation, one test, and `noBareIsNaNFilter.test.js` fails the
// build if anyone reintroduces the bare form.
import { isInvalidValue } from './stats.js';

/**
 * The (x, y) rows usable for a fit: both values present and numeric.
 *
 * @param {Array<number|null|undefined>} t
 * @param {Array<number|null|undefined>} y
 * @returns {{tt:number[], yy:number[], indices:number[]}} parallel arrays plus the source
 *          indices, so a caller can map results back onto the original rows.
 */
export function validPairs(t, y) {
	const tArr = t ?? [];
	const yArr = y ?? [];
	const indices = [];
	// Iterate the SHORTER of the two: a ragged pair must not read undefined off the end and
	// silently treat it as a row.
	const n = Math.min(tArr.length, yArr.length);
	for (let i = 0; i < n; i++) {
		if (!isInvalidValue(tArr[i]) && !isInvalidValue(yArr[i])) indices.push(i);
	}
	return {
		indices,
		tt: indices.map((i) => tArr[i]),
		yy: indices.map((i) => yArr[i])
	};
}

/**
 * The usable values of a single series — for an output x GRID, where there is no paired y.
 *
 * Same trap: a null here survived `!isNaN(v)` and the fitted curve was then evaluated at
 * `Number(null) === 0`, drawing a spurious point back at the time origin.
 *
 * @param {Array<number|null|undefined>} arr
 * @returns {number[]}
 */
export function validValues(arr) {
	return (arr ?? []).filter((v) => !isInvalidValue(v));
}
