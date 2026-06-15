import { describe, it, expect } from 'vitest';
import { fitTrend, fitTrendSync, evaluateTrendAtPoints } from './trendfit.js';

describe('fitTrendSync — linear', () => {
	it('recovers slope and intercept of a perfect line', () => {
		const x = [0, 1, 2, 3, 4];
		const y = x.map((xi) => 2 * xi + 1);
		const r = fitTrendSync(x, y, 'linear');
		expect(r.parameters.slope).toBeCloseTo(2, 10);
		expect(r.parameters.intercept).toBeCloseTo(1, 10);
		expect(r.rSquared).toBeCloseTo(1, 10);
		expect(r.rmse).toBeCloseTo(0, 10);
	});

	it('recovers a negative slope', () => {
		const x = [0, 1, 2, 3, 4];
		const y = x.map((xi) => -3 * xi + 7);
		const r = fitTrendSync(x, y, 'linear');
		expect(r.parameters.slope).toBeCloseTo(-3, 10);
		expect(r.parameters.intercept).toBeCloseTo(7, 10);
	});

	it('fitted values reproduce the model at the data points', () => {
		const x = [0, 1, 2, 3, 4];
		const y = x.map((xi) => 2 * xi + 1);
		const r = fitTrendSync(x, y, 'linear');
		for (let i = 0; i < x.length; i++) expect(r.fitted[i]).toBeCloseTo(y[i], 10);
	});
});

describe('fitTrendSync — exponential', () => {
	it('recovers a and b for y = a·e^(b·x)', () => {
		const a = 2;
		const b = 0.5;
		const x = [0, 1, 2, 3, 4, 5];
		const y = x.map((xi) => a * Math.exp(b * xi));
		const r = fitTrendSync(x, y, 'exponential');
		expect(r.parameters.a).toBeCloseTo(a, 6);
		expect(r.parameters.b).toBeCloseTo(b, 6);
		expect(r.rSquared).toBeGreaterThan(0.999);
	});
});

describe('fitTrendSync — logarithmic', () => {
	it('recovers a and b for y = a + b·ln(x)', () => {
		const a = 3;
		const b = 2;
		const x = [1, 2, 3, 4, 5, 6, 7, 8];
		const y = x.map((xi) => a + b * Math.log(xi));
		const r = fitTrendSync(x, y, 'logarithmic');
		expect(r.parameters.a).toBeCloseTo(a, 6);
		expect(r.parameters.b).toBeCloseTo(b, 6);
		expect(r.rSquared).toBeGreaterThan(0.999);
	});
});

describe('fitTrendSync — polynomial', () => {
	it('recovers a quadratic exactly', () => {
		// y = 1 + 2x + 3x²  → coeffs [1, 2, 3]
		const x = [-3, -2, -1, 0, 1, 2, 3];
		const y = x.map((xi) => 1 + 2 * xi + 3 * xi * xi);
		const r = fitTrendSync(x, y, 'polynomial', 2);
		expect(r.parameters.coeffs[0]).toBeCloseTo(1, 6);
		expect(r.parameters.coeffs[1]).toBeCloseTo(2, 6);
		expect(r.parameters.coeffs[2]).toBeCloseTo(3, 6);
		expect(r.rSquared).toBeGreaterThan(0.9999);
	});

	it('a degree-3 fit reproduces a cubic', () => {
		const x = [-2, -1, 0, 1, 2, 3, 4];
		const y = x.map((xi) => 2 - xi + 0.5 * xi * xi - 0.25 * xi ** 3);
		const r = fitTrendSync(x, y, 'polynomial', 3);
		for (let i = 0; i < x.length; i++) expect(r.fitted[i]).toBeCloseTo(y[i], 4);
	});

	it('returns rSquared = 0 when total variance is zero (all-equal y)', () => {
		const x = [0, 1, 2, 3];
		const y = [5, 5, 5, 5];
		const r = fitTrendSync(x, y, 'polynomial', 1);
		expect(r.rSquared).toBe(0);
	});
});

describe('evaluateTrendAtPoints', () => {
	it('evaluates a linear model at new points', () => {
		const params = { slope: 2, intercept: 1 };
		expect(evaluateTrendAtPoints(params, 'linear', [10, 20])).toEqual([21, 41]);
	});

	it('evaluates an exponential model', () => {
		const params = { a: 2, b: 1 };
		const out = evaluateTrendAtPoints(params, 'exponential', [0, 1]);
		expect(out[0]).toBeCloseTo(2, 10);
		expect(out[1]).toBeCloseTo(2 * Math.E, 10);
	});

	it('evaluates a polynomial model', () => {
		const params = { coeffs: [1, 0, 1] }; // 1 + x²
		expect(evaluateTrendAtPoints(params, 'polynomial', [0, 2, 3])).toEqual([1, 5, 10]);
	});

	it('returns NaN for an unknown model', () => {
		const out = evaluateTrendAtPoints({}, 'nope', [1, 2, 3]);
		expect(out.every((v) => Number.isNaN(v))).toBe(true);
	});
});

describe('fitTrend — async with permutation test', () => {
	it('returns a synchronous-shaped result when permuteTest is false', async () => {
		const x = [0, 1, 2, 3, 4];
		const y = x.map((xi) => 2 * xi + 1);
		const r = await fitTrend(x, y, 'linear');
		expect(r.parameters.slope).toBeCloseTo(2, 10);
		expect(r.pValue).toBeUndefined();
	});

	it('treats a numeric 3rd arg as polyDegree', async () => {
		const x = [-2, -1, 0, 1, 2];
		const y = x.map((xi) => 3 * xi * xi);
		const r = await fitTrend(x, y, 'polynomial', 2);
		expect(r.parameters.coeffs[2]).toBeCloseTo(3, 6);
	});

	it('attaches a reproducible permutation p-value for a strong linear trend', async () => {
		const x = Array.from({ length: 12 }, (_, i) => i);
		const y = x.map((xi) => 2 * xi + 1);
		const r1 = await fitTrend(x, y, 'linear', { permuteTest: true, nPermutations: 99, seed: 7 });
		const r2 = await fitTrend(x, y, 'linear', { permuteTest: true, nPermutations: 99, seed: 7 });
		// Perfect linear trend → very significant.
		expect(r1.pValue).toBeLessThan(0.05);
		expect(r1.significant).toBe(true);
		// Same seed → identical p-value.
		expect(r2.pValue).toBe(r1.pValue);
		expect(r1.permutationSeed).toBe(7);
		expect(r1.permutationNPermutations).toBe(99);
	});
});
