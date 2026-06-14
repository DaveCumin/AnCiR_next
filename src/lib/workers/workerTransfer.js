// @ts-nocheck
// src/lib/workers/workerTransfer.js
// Utilities for converting plain numeric arrays to/from Float64Array for zero-copy
// transfer across Worker message boundaries.

/**
 * Walk `payload` recursively. Any plain JS Array whose first element is a
 * number, null, or undefined is converted to a Float64Array and its .buffer
 * is pushed into `transfers`. String arrays and empty arrays are left alone.
 *
 * @param {any} payload
 * @param {ArrayBuffer[]} transfers - mutated in place
 * @returns {any} transformed payload (new object/array, does not mutate input)
 */
export function prepareTransferable(payload, transfers) {
	if (Array.isArray(payload)) {
		// Empty arrays: leave alone
		if (payload.length === 0) return payload;

		const first = payload[0];
		// String arrays: leave alone
		if (typeof first === 'string') return payload;

		// Numeric (or null/undefined first element): convert to Float64Array.
		// Float64Array's internal ToNumber treats null as 0, so handle null/undefined explicitly.
		const f64 = new Float64Array(payload.length);
		for (let i = 0; i < payload.length; i++) {
			const v = payload[i];
			f64[i] = v == null ? NaN : Number(v);
		}
		transfers.push(f64.buffer);
		return f64;
	}

	if (payload !== null && typeof payload === 'object' && !(payload instanceof Float64Array)) {
		const out = {};
		for (const key of Object.keys(payload)) {
			out[key] = prepareTransferable(payload[key], transfers);
		}
		return out;
	}

	// Primitives and Float64Array pass through unchanged
	return payload;
}

/**
 * Walk `value` recursively. Any Float64Array is converted back to a plain
 * number[]. Everything else is returned as-is (new wrapper objects are
 * created for plain objects; primitives pass through).
 *
 * @param {any} value
 * @returns {any}
 */
export function restoreFromTransferable(value) {
	if (value instanceof Float64Array) {
		return Array.from(value);
	}

	if (Array.isArray(value)) {
		return value.map(restoreFromTransferable);
	}

	if (value !== null && typeof value === 'object') {
		const out = {};
		for (const key of Object.keys(value)) {
			out[key] = restoreFromTransferable(value[key]);
		}
		return out;
	}

	return value;
}
