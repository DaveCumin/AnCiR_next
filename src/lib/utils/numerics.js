// @ts-nocheck
// Numerical utility primitives for compensated arithmetic and stable sequences.

/**
 * Kahan (compensated) summation accumulator.
 * Reduces floating-point drift from O(n * eps) to O(eps).
 */
export class KahanSum {
	constructor(initial = 0) {
		this.sum = initial;
		this.c = 0; // running compensation
	}
	add(value) {
		const y = value - this.c;
		const t = this.sum + y;
		this.c = t - this.sum - y;
		this.sum = t;
		return this;
	}
	get value() {
		return this.sum;
	}
}

/**
 * Compute the mean of an array, skipping null/undefined/NaN and blank strings,
 * using Kahan summation.
 *
 * The skip predicate is the same one as `isInvalidValue` in stats.js — inlined here
 * because stats.js imports this module (importing it back would be circular). It used
 * to be `!== undefined && !isNaN(v)`, which let null AND '' through: `isNaN(null)` and
 * `isNaN('')` are both FALSE, so missing cells were summed as ZEROS and counted in the
 * denominator, silently dragging the mean. Keep this in step with stats.js.
 */
export function kahanMean(data) {
	const k = new KahanSum();
	let count = 0;
	for (let i = 0; i < data.length; i++) {
		const v = data[i];
		if (v == null || (typeof v === 'string' && v.trim() === '') || isNaN(v)) continue;
		k.add(v);
		count++;
	}
	return count > 0 ? k.value / count : 0;
}

/**
 * Generate a sequence from `from` to `to` with the given step,
 * using start + i * step to avoid accumulated drift.
 */
export function makeSeqArray(from, to, step) {
	const n = Math.floor((to - from) / step);
	const out = [];
	for (let i = 0; i <= n; i++) {
		out.push(from + i * step);
	}
	return out;
}
