// @ts-nocheck
// src/lib/workers/workerTransfer.js
// Utilities for converting plain numeric arrays to/from Float64Array for zero-copy
// transfer across Worker message boundaries.
//
// THE CONTRACT: the encoding is LOSSLESS. restoreFromTransferable(structuredClone(
// prepareTransferable(v))) deep-equals v for any plain data (numbers, strings, booleans,
// null, arrays and plain objects of these). Which path a task takes (worker or main
// thread) is decided by input size alone (workerGate.js), so a lossy transport gives a
// user a different answer, or an error, only once their record is large enough.
//
// That is exactly what happened before this contract: any array whose FIRST element was
// not a string became one Float64Array, so an array of arrays (`ys: [y]`) or of result
// objects (`results: [{...}]`) turned into [NaN], booleans into 0/1, and null into NaN.
// A Cosinor on 580 rows then failed in the worker with "y is not iterable" while 145 rows
// fitted fine. See workerRoundTrip.test.js.

/** Only an array of nothing but finite-or-not numbers is packed; anything else is cloned. */
function isAllNumbers(arr) {
	for (let i = 0; i < arr.length; i++) {
		if (typeof arr[i] !== 'number') return false;
	}
	return true;
}

function isPlainObject(v) {
	if (v === null || typeof v !== 'object') return false;
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
}

/**
 * Walk `payload` recursively. A non-empty plain Array whose elements are ALL numbers
 * is converted to a Float64Array and its buffer pushed into `transfers`. Any other
 * array (strings, booleans, null/undefined holes, nested arrays, objects, a mix) is
 * walked element by element and otherwise left for the structured clone, so nothing
 * changes value on the way across.
 *
 * @param {any} payload
 * @param {ArrayBuffer[]} transfers - mutated in place
 * @returns {any} transformed payload (new object/array, does not mutate input)
 */
export function prepareTransferable(payload, transfers) {
	if (Array.isArray(payload)) {
		if (payload.length > 0 && isAllNumbers(payload)) {
			const f64 = Float64Array.from(payload);
			transfers.push(f64.buffer);
			return f64;
		}
		return payload.map((v) => prepareTransferable(v, transfers));
	}

	if (isPlainObject(payload)) {
		const out = {};
		for (const key of Object.keys(payload)) {
			out[key] = prepareTransferable(payload[key], transfers);
		}
		return out;
	}

	// Primitives, typed arrays and other objects pass through to the structured clone.
	return payload;
}

/**
 * Walk `value` recursively. Any Float64Array is converted back to a plain
 * number[]. Everything else is returned as-is (new wrapper arrays/objects are
 * created for plain arrays and objects; primitives pass through).
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

	if (isPlainObject(value)) {
		const out = {};
		for (const key of Object.keys(value)) {
			out[key] = restoreFromTransferable(value[key]);
		}
		return out;
	}

	return value;
}
