import { describe, it, expect } from 'vitest';
import { validPairs, validValues } from './validPairs.js';

describe('validPairs', () => {
	it('keeps only rows where BOTH values are usable', () => {
		const t = [0, 1, 2, 3, 4];
		const y = [10, 20, 30, 40, 50];
		expect(validPairs(t, y)).toEqual({ indices: [0, 1, 2, 3, 4], tt: t, yy: y });
	});

	it('drops null rows — the bug this module exists to prevent', () => {
		// This is exactly what Split emits: full length, null outside the window.
		const t = [0, 1, 2, 3];
		const y = [null, null, 30, 40];
		const { tt, yy, indices } = validPairs(t, y);
		expect(indices).toEqual([2, 3]);
		expect(tt).toEqual([2, 3]);
		expect(yy).toEqual([30, 40]);
		// The whole point: nulls must not arrive at the fit as zeros.
		expect(yy).not.toContain(0);
		expect(yy).not.toContain(null);
	});

	it('drops NaN and undefined too', () => {
		const t = [0, 1, 2, 3];
		const y = [NaN, undefined, 30, 40];
		expect(validPairs(t, y).indices).toEqual([2, 3]);
	});

	it('drops a row when the X is unusable, not just the Y', () => {
		const t = [null, NaN, 2, 3];
		const y = [10, 20, 30, 40];
		expect(validPairs(t, y).indices).toEqual([2, 3]);
	});

	it('keeps a legitimate ZERO — 0 is data, null is absence', () => {
		// The failure mode being prevented is nulls BECOMING zeros; a real zero must survive.
		const { yy } = validPairs([0, 1], [0, 5]);
		expect(yy).toEqual([0, 5]);
	});

	it('handles ragged inputs to the shorter length, without reading past the end', () => {
		const { indices, tt, yy } = validPairs([0, 1, 2], [10, 20]);
		expect(indices).toEqual([0, 1]);
		expect(tt).toEqual([0, 1]);
		expect(yy).toEqual([10, 20]);
	});

	it('returns empty structures for empty / missing input rather than throwing', () => {
		expect(validPairs([], [])).toEqual({ indices: [], tt: [], yy: [] });
		expect(validPairs(null, null)).toEqual({ indices: [], tt: [], yy: [] });
		expect(validPairs(undefined, [1, 2])).toEqual({ indices: [], tt: [], yy: [] });
	});

	it('returns empty when every row is null (so callers can report "no fit")', () => {
		expect(validPairs([0, 1, 2], [null, null, null]).indices).toEqual([]);
	});

	it('indices map results back onto the ORIGINAL rows', () => {
		const t = [0, 1, 2, 3, 4];
		const y = [10, null, 30, null, 50];
		const { indices } = validPairs(t, y);
		expect(indices).toEqual([0, 2, 4]);
		expect(indices.map((i) => t[i])).toEqual([0, 2, 4]);
	});
});

describe('validValues', () => {
	it('drops null/NaN/undefined but keeps zero', () => {
		expect(validValues([0, null, 1, NaN, 2, undefined])).toEqual([0, 1, 2]);
	});

	it('is empty-safe', () => {
		expect(validValues([])).toEqual([]);
		expect(validValues(null)).toEqual([]);
	});
});
