import { describe, it, expect } from 'vitest';
import { describeStats } from './describeStats.js';

describe('describeStats', () => {
	it('computes the basics on a simple set', () => {
		const s = describeStats([1, 2, 3, 4, 5]);
		expect(s.n).toBe(5);
		expect(s.mean).toBeCloseTo(3, 9);
		expect(s.median).toBeCloseTo(3, 9);
		expect(s.min).toBe(1);
		expect(s.max).toBe(5);
		expect(s.range).toBe(4);
		expect(s.sd).toBeCloseTo(Math.sqrt(2.5), 9); // sample sd
	});

	it('quartiles + IQR (type-7)', () => {
		const s = describeStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		expect(s.q1).toBeCloseTo(3.25, 9);
		expect(s.q3).toBeCloseTo(7.75, 9);
		expect(s.iqr).toBeCloseTo(4.5, 9);
	});

	it('a symmetric set has ~0 skew', () => {
		const s = describeStats([1, 2, 3, 4, 5, 6, 7, 8, 9]);
		expect(Math.abs(s.skewness)).toBeLessThan(1e-9);
	});

	it('a right-skewed set has positive skew', () => {
		const s = describeStats([1, 1, 1, 1, 2, 2, 3, 10]);
		expect(s.skewness).toBeGreaterThan(0);
	});

	it('drops null/NaN (pairwise-complete)', () => {
		const s = describeStats([1, null, 2, NaN, 3]);
		expect(s.n).toBe(3);
		expect(s.mean).toBeCloseTo(2, 9);
	});

	it('skew/kurtosis are NaN when n is too small, but basics still compute', () => {
		const s = describeStats([5, 7]);
		expect(s.n).toBe(2);
		expect(s.mean).toBeCloseTo(6, 9);
		expect(s.skewness).toBeNaN(); // needs n>=3
		expect(s.kurtosis).toBeNaN(); // needs n>=4
	});

	it('a constant column: sd 0, skew/kurtosis NaN, not a throw', () => {
		const s = describeStats([4, 4, 4, 4, 4]);
		expect(s.sd).toBe(0);
		expect(s.skewness).toBeNaN();
	});

	it('is empty-safe (all NaN, n 0)', () => {
		const s = describeStats([]);
		expect(s.n).toBe(0);
		expect(s.mean).toBeNaN();
		expect(describeStats(null).n).toBe(0);
	});
});
