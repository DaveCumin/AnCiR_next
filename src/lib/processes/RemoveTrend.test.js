import { describe, it, expect, vi } from 'vitest';

// fitTrend imports getColumnById at module level but never calls it.
// Mock the whole Column.svelte to avoid Svelte reactive state initialisation.
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: vi.fn() }));

import { fitTrend } from './RemoveTrend.svelte';

// ─── linear ──────────────────────────────────────────────────────────────────

describe('fitTrend — linear', () => {
	it('recovers slope and intercept for perfect line', () => {
		const x = [0, 1, 2, 3, 4, 5];
		const y = x.map((xi) => 2 * xi + 3);
		const result = fitTrend(x, y, 'linear');
		expect(result.parameters.slope).toBeCloseTo(2, 6);
		expect(result.parameters.intercept).toBeCloseTo(3, 6);
	});

	it('returns R² ≈ 1 for perfect linear data', () => {
		const x = [1, 2, 3, 4, 5];
		const y = x.map((xi) => -xi + 10);
		expect(fitTrend(x, y, 'linear').rSquared).toBeCloseTo(1, 6);
	});

	it('fitted values have same length as input', () => {
		const x = [0, 1, 2, 3];
		const y = [1, 2, 3, 4];
		expect(fitTrend(x, y, 'linear').fitted).toHaveLength(4);
	});

	it('computes finite RMSE', () => {
		const x = [0, 1, 2, 3];
		const y = [1, 2, 4, 3]; // not perfect
		const result = fitTrend(x, y, 'linear');
		expect(isFinite(result.rmse)).toBe(true);
		expect(result.rmse).toBeGreaterThan(0);
	});
});

// ─── exponential ─────────────────────────────────────────────────────────────

describe('fitTrend — exponential', () => {
	it('recovers a and b for y = a·e^(b·x)', () => {
		const a = 2;
		const b = 0.3;
		const x = [0, 1, 2, 3, 4, 5];
		const y = x.map((xi) => a * Math.exp(b * xi));
		const result = fitTrend(x, y, 'exponential');
		expect(result.parameters.a).toBeCloseTo(a, 3);
		expect(result.parameters.b).toBeCloseTo(b, 3);
	});

	it('fitted values are positive for positive exponential', () => {
		const x = [1, 2, 3, 4];
		const y = x.map((xi) => Math.exp(xi));
		const result = fitTrend(x, y, 'exponential');
		result.fitted.forEach((v) => expect(v).toBeGreaterThan(0));
	});
});

// ─── logarithmic ─────────────────────────────────────────────────────────────

describe('fitTrend — logarithmic', () => {
	it('recovers a and b for y = a + b·ln(x)', () => {
		const a = 1;
		const b = 2;
		const x = [1, 2, 3, 4, 5];
		const y = x.map((xi) => a + b * Math.log(xi));
		const result = fitTrend(x, y, 'logarithmic');
		expect(result.parameters.a).toBeCloseTo(a, 4);
		expect(result.parameters.b).toBeCloseTo(b, 4);
	});

	it('R² ≈ 1 for perfect logarithmic data', () => {
		const x = [1, 2, 3, 4, 5, 6];
		const y = x.map((xi) => 3 * Math.log(xi) + 2);
		expect(fitTrend(x, y, 'logarithmic').rSquared).toBeCloseTo(1, 4);
	});
});

// ─── polynomial ──────────────────────────────────────────────────────────────

describe('fitTrend — polynomial', () => {
	it('recovers quadratic coefficients for y = x²', () => {
		const x = [0, 1, 2, 3, 4, 5];
		const y = x.map((xi) => xi * xi);
		const result = fitTrend(x, y, 'polynomial', 2);
		const coeffs = result.parameters.coeffs;
		// coeffs = [c0, c1, c2] for c0 + c1·x + c2·x²
		expect(coeffs[2]).toBeCloseTo(1, 4); // x² coefficient
		expect(coeffs[1]).toBeCloseTo(0, 4); // x coefficient
		expect(coeffs[0]).toBeCloseTo(0, 4); // constant
	});

	it('R² ≈ 1 for perfect quadratic data', () => {
		const x = [0, 1, 2, 3, 4];
		const y = x.map((xi) => 2 * xi * xi - xi + 1);
		expect(fitTrend(x, y, 'polynomial', 2).rSquared).toBeCloseTo(1, 5);
	});

	it('degree-1 polynomial is equivalent to linear', () => {
		const x = [0, 1, 2, 3, 4];
		const y = x.map((xi) => 3 * xi + 1);
		const polyResult = fitTrend(x, y, 'polynomial', 1);
		const linResult = fitTrend(x, y, 'linear');
		expect(polyResult.rSquared).toBeCloseTo(linResult.rSquared, 5);
	});
});
