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

	// STAT-36: the standard error of the mean, sd / sqrt(n), and the 95% CI of the mean from
	// Student's t on n - 1 df. Reference values from scipy.stats.sem and
	// scipy.stats.t.interval(0.95, n - 1, loc=mean, scale=sem); R t.test(1:10)$conf.int agrees.
	it('SEM and the t-based 95% CI of the mean match scipy', () => {
		const a = describeStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		expect(a.sem).toBeCloseTo(0.9574271077563381, 12);
		expect(a.ciLow).toBeCloseTo(3.334149410331831, 10);
		expect(a.ciHigh).toBeCloseTo(7.665850589668169, 10);
		const b = describeStats([12, 7, 3, 9, 15, 4, 8, 11, 6, 10, 5, 14, 2, 13, 9, 7, 6, 8]);
		expect(b.sem).toBeCloseTo(0.8774798865749007, 12);
		expect(b.ciLow).toBeCloseTo(6.426457043846642, 10);
		expect(b.ciHigh).toBeCloseTo(10.129098511708914, 10);
		// n = 2: t on 1 df (12.706), so the interval is wide but defined.
		const c = describeStats([5, 7]);
		expect(c.sem).toBeCloseTo(1, 12);
		expect(c.ciLow).toBeCloseTo(-6.706204736174694, 10);
		expect(c.ciHigh).toBeCloseTo(18.706204736174694, 10);
	});

	it('SEM and CI are NaN below two values, and a constant column has a zero-width CI', () => {
		const one = describeStats([3]);
		expect(one.sem).toBeNaN();
		expect(one.ciLow).toBeNaN();
		expect(one.ciHigh).toBeNaN();
		expect(describeStats([]).sem).toBeNaN();
		const k = describeStats([4, 4, 4, 4]);
		expect(k.sem).toBe(0);
		expect(k.ciLow).toBe(4);
		expect(k.ciHigh).toBe(4);
	});
});
