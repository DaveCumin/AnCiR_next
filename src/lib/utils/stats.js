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

export function min(data) {
	let out = Infinity;
	for (let i = 0; i < data.length; i++) {
		const v = data[i];
		if (v != null && !isNaN(v) && v < out) out = v;
	}
	return out === Infinity ? null : out;
}

export function max(data) {
	let out = -Infinity;
	for (let i = 0; i < data.length; i++) {
		const v = data[i];
		if (v != null && !isNaN(v) && v > out) out = v;
	}
	return out === -Infinity ? null : out;
}

export function minMax(data) {
	let mn = Infinity;
	let mx = -Infinity;
	for (let i = 0; i < data.length; i++) {
		const v = data[i];
		if (v == null || isNaN(v)) continue;
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
