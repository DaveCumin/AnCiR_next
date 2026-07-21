import { describe, it, expect } from 'vitest';
import { crossCorrelation } from './crossCorrelation.js';

// A triangle wave and the same wave shifted right by 2 samples (y leads x by 2).
const X = [0, 1, 2, 1, 0, -1, -2, -1, 0, 1, 2, 1, 0, -1, -2, -1, 0, 1, 2, 1];
const Y = [2, 1, 0, 1, 2, 1, 0, -1, -2, -1, 0, 1, 2, 1, 0, -1, -2, -1, 0, 1];

describe('crossCorrelation', () => {
	it('reports symmetric lags from -maxLag to +maxLag', () => {
		const c = crossCorrelation(X, Y, { maxLag: 4 });
		expect(c.lags).toEqual([-4, -3, -2, -1, 0, 1, 2, 3, 4]);
		expect(c.r).toHaveLength(9);
	});

	it('matches numpy per-lag Pearson (r values)', () => {
		const c = crossCorrelation(X, Y, { maxLag: 4 });
		const expected = [-0.08754, -0.54797, -0.68421, -0.43798, 0.0411, 0.65199, 1.0, 0.65397, 0.0];
		c.r.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 4));
	});

	it('locates the lag of peak correlation', () => {
		const c = crossCorrelation(X, Y, { maxLag: 4 });
		expect(c.peakLag).toBe(2);
		expect(c.peakR).toBeCloseTo(1, 6);
	});

	it('is exactly 1 at lag 0 for a series against itself', () => {
		const c = crossCorrelation(X, X, { maxLag: 3 });
		const zero = c.lags.indexOf(0);
		expect(c.r[zero]).toBeCloseTo(1, 9);
		expect(c.peakLag).toBe(0);
	});

	it('defaults maxLag to a quarter of the shorter series', () => {
		const c = crossCorrelation(X, Y); // n=20 → cap 5
		expect(Math.max(...c.lags)).toBe(5);
		expect(Math.min(...c.lags)).toBe(-5);
	});

	it('supports the spearman method', () => {
		const c = crossCorrelation(X, Y, { maxLag: 2, method: 'spearman' });
		expect(c.r).toHaveLength(5);
		expect(Number.isFinite(c.peakR)).toBe(true);
	});
});
