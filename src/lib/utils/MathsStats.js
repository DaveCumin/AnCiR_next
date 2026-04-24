// @ts-nocheck
// Legacy-semantics wrappers around the canonical helpers in stats.js.
// These return NaN (not null) for empty / all-invalid input, which is what
// the numerical-fit code (cosinor, trendfit, rectwave, doublelogistic) assumes.

import { min as _min, max as _max, mean as _mean, standardDeviation } from './stats.js';

export function calculateStandardDeviation(arr) {
	return standardDeviation(arr);
}

export function createSequenceArray(start, end, step = 1) {
	const out = [];
	for (let i = start; i <= end; i += step) out.push(i);
	return out;
}

export function mean(data) {
	return _mean(data);
}

export function max(data) {
	const v = _max(data);
	return v == null ? NaN : v;
}

export function min(data) {
	const v = _min(data);
	return v == null ? NaN : v;
}
