// ROB-9: an actogram series keeps the same bins object while the values are unchanged.
import { describe, it, expect } from 'vitest';
import { sameBins, keepSameBins, cachedRowBins } from './stableBins.js';

const mk = (ys) => ys.map((y, i) => ({ start: i, end: i + 1, y }));

describe('sameBins', () => {
	it('is true for equal values in different arrays', () => {
		expect(sameBins(mk([1, 2, 3]), mk([1, 2, 3]))).toBe(true);
	});
	it('is false when one value, one edge or the length differs', () => {
		expect(sameBins(mk([1, 2, 3]), mk([1, 2, 4]))).toBe(false);
		const shifted = mk([1, 2, 3]);
		shifted[1] = { ...shifted[1], end: 2.5 };
		expect(sameBins(mk([1, 2, 3]), shifted)).toBe(false);
		expect(sameBins(mk([1, 2, 3]), mk([1, 2]))).toBe(false);
		expect(sameBins(null, mk([1]))).toBe(false);
	});
	it('treats 0 and -0 as different and NaN as equal to itself (Object.is)', () => {
		expect(sameBins(mk([0]), mk([-0]))).toBe(false);
		expect(sameBins(mk([NaN]), mk([NaN]))).toBe(true);
	});
});

describe('keepSameBins', () => {
	it('returns the previous array when the values match', () => {
		const prev = mk([5, 6]);
		expect(keepSameBins(prev, mk([5, 6]))).toBe(prev);
	});
	it('returns the new array when anything changed, or there was no previous', () => {
		const next = mk([5, 7]);
		expect(keepSameBins(mk([5, 6]), next)).toBe(next);
		const first = mk([1]);
		expect(keepSameBins(null, first)).toBe(first);
	});
	it('still sees an in-place edit: the comparison is against the previous OUTPUT', () => {
		const raw = [1, 2, 3];
		const build = () => raw.map((y, i) => ({ start: i, end: i + 1, y }));
		const prev = build();
		raw[1] = 99; // same raw array object, new value
		const next = build();
		expect(keepSameBins(prev, next)).toBe(next);
	});
});

describe('cachedRowBins', () => {
	const build = (b, from, to, hrs) => ({ from, to, hrs, n: Object.keys(b).length });
	it('returns the same row object for the same bins object and row parameters', () => {
		const byPeriod = { 0: [], 1: [] };
		const a = cachedRowBins(byPeriod, 0, 2, 24, build);
		expect(cachedRowBins(byPeriod, 0, 2, 24, build)).toBe(a);
	});
	it('builds afresh for a different row, period, or bins object', () => {
		const byPeriod = { 0: [], 1: [] };
		const a = cachedRowBins(byPeriod, 0, 2, 24, build);
		expect(cachedRowBins(byPeriod, 1, 3, 24, build)).not.toBe(a);
		expect(cachedRowBins(byPeriod, 0, 2, 25, build)).not.toBe(a);
		expect(cachedRowBins({ 0: [], 1: [] }, 0, 2, 24, build)).not.toBe(a);
	});
});
