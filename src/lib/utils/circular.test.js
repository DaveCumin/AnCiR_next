import { describe, it, expect } from 'vitest';
import {
	toRadians,
	circularMean,
	rayleighTest,
	kappaFromRbar,
	watsonWilliams
} from './circular.js';

const TWO_PI = 2 * Math.PI;

describe('toRadians', () => {
	it('passes radians through unchanged', () => {
		expect(toRadians(1.234, 'radians')).toBe(1.234);
	});
	it('converts degrees', () => {
		expect(toRadians(90, 'degrees')).toBeCloseTo(Math.PI / 2, 12);
		expect(toRadians(180, 'degrees')).toBeCloseTo(Math.PI, 12);
	});
	it('converts clock-hours on a period', () => {
		expect(toRadians(6, 'hours', 24)).toBeCloseTo(Math.PI / 2, 12);
		expect(toRadians(12, 'hours', 24)).toBeCloseTo(Math.PI, 12);
		expect(toRadians(6, 'hours', 12)).toBeCloseTo(Math.PI, 12);
	});
	it('returns NaN for non-finite input', () => {
		expect(toRadians(NaN, 'degrees')).toBeNaN();
	});
});

describe('circularMean', () => {
	it('is empty for no data', () => {
		const r = circularMean([]);
		expect(r.n).toBe(0);
		expect(r.R).toBeNaN();
		expect(r.meanAngle).toBeNaN();
	});
	it('identical angles → R=1 and meanAngle=that angle', () => {
		const r = circularMean([0.7, 0.7, 0.7, 0.7]);
		expect(r.R).toBeCloseTo(1, 12);
		expect(r.meanAngle).toBeCloseTo(0.7, 12);
		expect(r.n).toBe(4);
	});
	it('antipodal pair → R=0', () => {
		const r = circularMean([0, Math.PI]);
		expect(r.R).toBeCloseTo(0, 12);
	});
	it('4 evenly spaced directions → R=0', () => {
		const r = circularMean([0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]);
		expect(r.R).toBeCloseTo(0, 12);
	});
	it('mean of ±small angles is ~0 and wrapped to [0,2π)', () => {
		const r = circularMean([-0.2, 0.2]);
		expect(r.meanAngle).toBeCloseTo(0, 12);
		expect(r.meanAngle).toBeGreaterThanOrEqual(0);
	});
	it('wraps a negative mean direction into [0, 2π)', () => {
		// Cluster near angle -0.1 (≡ 2π-0.1)
		const r = circularMean([-0.1, -0.15, -0.05]);
		expect(r.meanAngle).toBeGreaterThan(TWO_PI - 0.5);
		expect(r.meanAngle).toBeLessThan(TWO_PI);
	});
	it('skips NaN / null entries', () => {
		const r = circularMean([0.5, NaN, 0.5, null, undefined]);
		expect(r.n).toBe(2);
		expect(r.R).toBeCloseTo(1, 12);
	});
});

describe('rayleighTest', () => {
	it('empty → NaN', () => {
		const r = rayleighTest([]);
		expect(r.n).toBe(0);
		expect(r.pValue).toBeNaN();
	});
	it('perfectly clustered → R≈1, z≈n, p≈0', () => {
		const angles = new Array(12).fill(1.0);
		const r = rayleighTest(angles);
		expect(r.R).toBeCloseTo(1, 12);
		expect(r.z).toBeCloseTo(12, 10);
		expect(r.pValue).toBeLessThan(1e-4);
	});
	it('uniform (36 evenly spaced) → R≈0, z≈0, p≈1', () => {
		const angles = Array.from({ length: 36 }, (_, k) => (k * TWO_PI) / 36);
		const r = rayleighTest(angles);
		expect(r.R).toBeCloseTo(0, 10);
		expect(r.z).toBeCloseTo(0, 8);
		expect(r.pValue).toBeGreaterThan(0.9);
	});
	it('p-value is always in [0,1]', () => {
		for (const angles of [
			[0.1, 0.2, 0.15, 0.05, 0.3],
			[0, Math.PI, 0.1, Math.PI + 0.1],
			new Array(5).fill(2.0)
		]) {
			const r = rayleighTest(angles);
			expect(r.pValue).toBeGreaterThanOrEqual(0);
			expect(r.pValue).toBeLessThanOrEqual(1);
		}
	});
	it('moderately concentrated sample is significant', () => {
		// 20 angles tightly around 1.0 rad
		const angles = Array.from({ length: 20 }, (_, i) => 1.0 + (i - 10) * 0.02);
		const r = rayleighTest(angles);
		expect(r.R).toBeGreaterThan(0.9);
		expect(r.pValue).toBeLessThan(0.001);
	});
});

describe('kappaFromRbar', () => {
	it('is 0 at rBar=0', () => {
		expect(kappaFromRbar(0)).toBe(0);
	});
	it('is Infinity at rBar=1', () => {
		expect(kappaFromRbar(1)).toBe(Infinity);
	});
	it('increases monotonically with rBar', () => {
		let prev = -1;
		for (const rb of [0.1, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]) {
			const k = kappaFromRbar(rb);
			expect(k).toBeGreaterThan(prev);
			prev = k;
		}
	});
	it('matches the A1inv branch value at rBar=√2/2', () => {
		// -0.4 + 1.39*rBar + 0.43/(1-rBar)
		const rb = Math.SQRT1_2;
		const expected = -0.4 + 1.39 * rb + 0.43 / (1 - rb);
		expect(kappaFromRbar(rb)).toBeCloseTo(expected, 12);
	});
});

describe('watsonWilliams', () => {
	// Simple F CDF upper tail via a series is overkill for the test; use a stub
	// that just records df so we can assert F/df without a stats dependency.
	const captureP = (F, df1, df2) => 0.5; // sentinel

	it('needs at least 2 non-empty groups', () => {
		expect(watsonWilliams([]).valid).toBe(false);
		expect(watsonWilliams([[0.1, 0.2]]).valid).toBe(false);
		expect(watsonWilliams([[0.1, 0.2], []]).valid).toBe(false);
	});

	it('identical groups → Rsum≈r → F≈0', () => {
		const g = [0.1, 0.2, 0.3, 0.25];
		const res = watsonWilliams([g.slice(), g.slice()], captureP);
		expect(res.valid).toBe(true);
		expect(res.F).toBeCloseTo(0, 8);
		expect(res.df1).toBe(1);
		expect(res.df2).toBe(2 * g.length - 2);
	});

	it('hand-computed F for two orthogonal-spread groups', () => {
		// A = [0, π/2] → C=1,S=1,r=√2 ; B = [π, 3π/2] → C=-1,S=-1,r=√2
		// N=4, k=2, Rsum=2√2, pooled r=0, r̄w=√2/2,
		// κ = A1inv(√2/2), β = 1+3/(8κ),
		// F = β·(N−k)(Rsum−r)/[(k−1)(N−Rsum)] ≈ 5.711
		const res = watsonWilliams(
			[
				[0, Math.PI / 2],
				[Math.PI, (3 * Math.PI) / 2]
			],
			captureP
		);
		expect(res.k).toBe(2);
		expect(res.N).toBe(4);
		expect(res.Rsum).toBeCloseTo(2 * Math.SQRT2, 10);
		expect(res.r).toBeCloseTo(0, 10);
		expect(res.kappa).toBeCloseTo(2.050988, 4);
		expect(res.beta).toBeCloseTo(1.182842, 4);
		expect(res.F).toBeCloseTo(5.7113, 2);
		expect(res.df1).toBe(1);
		expect(res.df2).toBe(2);
		expect(res.pValue).toBe(0.5); // came from the stub
	});

	it('perfectly concentrated groups with different means → F=∞, p=0', () => {
		// r_A=n, r_B=m, Rsum=N → denom (N−Rsum)=0, Rsum−r>0 → F=∞
		const res = watsonWilliams([
			[0, 0, 0],
			[Math.PI, Math.PI, Math.PI]
		]);
		expect(res.F).toBe(Infinity);
		expect(res.pValue).toBe(0);
	});

	it('three well-separated concentrated groups give a large F', () => {
		const jitter = (c) => [c - 0.05, c, c + 0.05];
		const res = watsonWilliams(
			[jitter(0), jitter(2), jitter(4)],
			() => 0 // p stub
		);
		expect(res.k).toBe(3);
		expect(res.df1).toBe(2);
		expect(res.df2).toBe(6);
		expect(res.F).toBeGreaterThan(50);
	});
});
