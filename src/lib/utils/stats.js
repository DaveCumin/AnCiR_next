// @ts-nocheck
// Canonical min/max/mean implementations for the whole app.
// All helpers iterate in a single pass (no Math.min(...arr) spread — safe for
// large arrays that would otherwise blow the call-stack).
//
// Semantics:
//   - `min`, `max`, `minMax`, `mean` ignore null, undefined, and NaN entries.
//   - They return `null` (or `{min:null,max:null}`) for empty / all-invalid input.
//   - `min`, `max` treat strings as invalid — pass numbers.
//
// `MathsStats.js` re-exports wrapper versions that translate null → NaN for
// the handful of callers (cosinor, trendfit, rectwave) that expect NaN.

import { KahanSum, kahanMean } from './numerics.js';

/**
 * Is a cell unusable as a number? True for null, undefined, NaN, and blank strings
 * ('' or whitespace-only).
 *
 * Reach for this instead of a bare `isNaN(v)`: `isNaN(null)` is FALSE and `Number(null)` is 0,
 * so an isNaN-only filter keeps null rows and then fits/averages them as ZEROS. That is not
 * hypothetical — Split and Filter emit full-length segments padded with null outside the
 * window, and Cosinor's isNaN-only pair filter halved their mesor/amplitude and dragged a
 * free-period fit to ~220 h (Cosinor.nulls.test.js). The predicate is the same one min/max/mean
 * apply; several nodes had hand-rolled their own copy.
 *
 * The blank-string clause exists because `isNaN('') === false` too (`Number('') === 0`): a
 * blank CSV cell — the standard representation of a MISSING value — otherwise passed this
 * filter and the downstream `Number()` coercion fabricated a literal 0 into means, fits and
 * statistics. A real zero is data; '' (and ' ') is absence. Numeric STRINGS like '0' and
 * '1.5' remain valid — pastes and hand-entered tables legitimately deliver them (v72.20).
 * kahanMean (numerics.js) inlines the same predicate; keep the two in step.
 */
export const isInvalidValue = (v) =>
	v == null || (typeof v === 'string' && v.trim() === '') || isNaN(v);

export function min(data) {
	let out = Infinity;
	for (let i = 0; i < data.length; i++) {
		const v = data[i];
		if (!isInvalidValue(v) && v < out) out = v;
	}
	return out === Infinity ? null : out;
}

export function max(data) {
	let out = -Infinity;
	for (let i = 0; i < data.length; i++) {
		const v = data[i];
		if (!isInvalidValue(v) && v > out) out = v;
	}
	return out === -Infinity ? null : out;
}

export function minMax(data) {
	let mn = Infinity;
	let mx = -Infinity;
	for (let i = 0; i < data.length; i++) {
		const v = data[i];
		if (isInvalidValue(v)) continue;
		if (v < mn) mn = v;
		if (v > mx) mx = v;
	}
	return { min: mn === Infinity ? null : mn, max: mx === -Infinity ? null : mx };
}

export function mean(data) {
	return kahanMean(data);
}

export function standardDeviation(arr) {
	const validArr = arr.filter((v) => v !== undefined && v !== null && !isNaN(v));
	if (validArr.length === 0) return NaN;
	const m = kahanMean(validArr);
	const k = new KahanSum();
	for (const v of validArr) k.add((v - m) ** 2);
	return Math.sqrt(k.value / validArr.length);
}

// Reduce an iterable of arrays to a single {min,max} in one pass —
// avoids intermediate copies and `Math.min(...spread)`.
export function minMaxAcross(arrays) {
	let mn = Infinity;
	let mx = -Infinity;
	for (const arr of arrays) {
		if (!arr) continue;
		for (let i = 0; i < arr.length; i++) {
			const v = arr[i];
			if (v == null || isNaN(v)) continue;
			if (v < mn) mn = v;
			if (v > mx) mx = v;
		}
	}
	return { min: mn === Infinity ? null : mn, max: mx === -Infinity ? null : mx };
}
