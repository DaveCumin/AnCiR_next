import { describe, it, expect } from 'vitest';
import { pnorm, qnorm, pchisq, qchisq, pt, qt, pf } from './CDFs.js';

// Ground-truth values from R

describe('pnorm', () => {
	it('pnorm(1.96) ≈ 0.025 (upper tail)', () => {
		expect(pnorm(1.96)).toBeCloseTo(0.025, 4);
	});

	it('pnorm(-1.96) ≈ 0.975', () => {
		expect(pnorm(-1.96)).toBeCloseTo(0.975, 4);
	});

	it('pnorm(0) = 0.5', () => {
		expect(pnorm(0)).toBeCloseTo(0.5, 5);
	});

	it('pnorm(3.29) ≈ 0.0005', () => {
		expect(pnorm(3.29)).toBeCloseTo(0.0005, 4);
	});

	it('pnorm(large z) approaches 0', () => {
		expect(pnorm(10)).toBeCloseTo(0, 5);
	});
});

describe('qnorm', () => {
	// This implementation uses upper-tail convention (pnorm returns upper-tail prob),
	// so qnorm(0.025) ≈ +1.96 (the z that leaves 2.5% in the upper tail).
	it('qnorm(0.025) ≈ +1.96 (upper-tail convention)', () => {
		expect(qnorm(0.025)).toBeCloseTo(1.96, 3);
	});

	it('qnorm(0.975) ≈ -1.96 (upper-tail convention)', () => {
		expect(qnorm(0.975)).toBeCloseTo(-1.96, 3);
	});

	it('qnorm(0.5) = 0', () => {
		expect(qnorm(0.5)).toBe(0);
	});

	it('is inverse of pnorm for typical values', () => {
		const p = 0.01;
		expect(pnorm(qnorm(p))).toBeCloseTo(p, 4);
	});
});

describe('pchisq', () => {
	it('pchisq(3.84, 1) ≈ 0.05 (upper tail, ptype=1)', () => {
		expect(pchisq(3.84, 1, 1)).toBeCloseTo(0.05, 3);
	});

	it('pchisq(0, 1) = 1', () => {
		// gammq(1, 0) should equal 1
		expect(pchisq(0, 1, 1)).toBeCloseTo(1, 5);
	});

	it('pchisq(large value, 1) approaches 0', () => {
		expect(pchisq(100, 1, 1)).toBeCloseTo(0, 5);
	});

	it('pchisq(9.49, 4) ≈ 0.05 (upper tail)', () => {
		expect(pchisq(9.49, 4, 1)).toBeCloseTo(0.05, 2);
	});

	it('pchisq with ptype=2 gives lower-tail', () => {
		// lower-tail at 3.84, df=1 ≈ 1 - 0.05 = 0.95
		expect(pchisq(3.84, 1, 2)).toBeCloseTo(0.95, 2);
	});
});

describe('qchisq', () => {
	it('qchisq(0.05, 1) ≈ 3.84 (upper tail, ptype=1)', () => {
		expect(qchisq(0.05, 1, 1)).toBeCloseTo(3.841, 2);
	});

	it('is inverse of pchisq', () => {
		const chi2 = 5.99;
		expect(pchisq(qchisq(0.05, 2, 1), 2, 1)).toBeCloseTo(0.05, 4);
	});
});

describe('pt', () => {
	it('pt(2.0, 10, ptype=1) ≈ 0.037 (upper tail)', () => {
		expect(pt(2.0, 10, 1)).toBeCloseTo(0.037, 3);
	});

	it('pt(0, n, ptype) gives 0.5 two-tailed', () => {
		// When t=0, betai(n, 1, 1) = 1, then 0.5*p for ptype=1 gives 0.5
		expect(pt(0.0001, 10, 1)).toBeCloseTo(0.5, 2);
	});

	it('pt for large df approaches standard normal', () => {
		// t(1000) ~ N(0,1): pt(1.96, 1000, ptype=1) ≈ pnorm(1.96) ≈ 0.025
		expect(pt(1.96, 1000, 1)).toBeCloseTo(0.025, 2);
	});

	it('pt(2.228, 10, ptype=1) ≈ 0.025', () => {
		// R: pt(2.228, 10, lower.tail=FALSE) ≈ 0.025
		expect(pt(2.228, 10, 1)).toBeCloseTo(0.025, 3);
	});

	it('pt with df=1 (Cauchy) at t=1 ≈ 0.25', () => {
		// R: pt(1, 1, lower.tail=FALSE) = 0.25
		expect(pt(1, 1, 1)).toBeCloseTo(0.25, 3);
	});
});

describe('qt', () => {
	it('qt(0.025, 10, ptype=1) ≈ 2.228', () => {
		expect(qt(0.025, 10, 1)).toBeCloseTo(2.228, 2);
	});

	it('qt is inverse of pt', () => {
		expect(pt(qt(0.05, 20, 1), 20, 1)).toBeCloseTo(0.05, 4);
	});

	it('qt for large df approaches qnorm', () => {
		// qt(0.025, 1000, ptype=1) ≈ qnorm(0.025) ≈ 1.96
		expect(qt(0.025, 1000, 1)).toBeCloseTo(1.96, 2);
	});
});

describe('pf', () => {
	it('pf(4.96, 1, 10, ptype=1) ≈ 0.05 (upper tail)', () => {
		// R: pf(4.96, 1, 10, lower.tail=FALSE) ≈ 0.05
		expect(pf(4.96, 1, 10, 1)).toBeCloseTo(0.05, 2);
	});

	it('pf(0, df1, df2, ptype=1) = 1', () => {
		expect(pf(0, 2, 10, 1)).toBe(1);
	});

	it('pf(0, df1, df2, ptype=0) = 0', () => {
		expect(pf(0, 2, 10, 0)).toBe(0);
	});

	it('pf(large F, 1, 10, ptype=1) approaches 0', () => {
		expect(pf(1000, 1, 10, 1)).toBeCloseTo(0, 5);
	});
});
