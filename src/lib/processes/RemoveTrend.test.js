import { describe, it, expect, vi } from 'vitest';

// fitTrend imports getColumnById at module level but never calls it.
// removetrend DOES call it, but with xColId === -1 it short-circuits and uses
// an index axis, so the mock (returning undefined) is fine for those tests.
// Mock the whole Column.svelte to avoid Svelte reactive state initialisation.
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: vi.fn(() => undefined) }));

import { fitTrend, removetrend } from './RemoveTrend.svelte';

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

	it('recovers a cubic with degree 3', () => {
		const x = [0, 1, 2, 3, 4, 5];
		const y = x.map((xi) => xi ** 3 - 2 * xi + 1);
		const coeffs = fitTrend(x, y, 'polynomial', 3).parameters.coeffs;
		expect(coeffs[3]).toBeCloseTo(1, 3); // x³
		expect(coeffs[1]).toBeCloseTo(-2, 3); // x
		expect(coeffs[0]).toBeCloseTo(1, 3); // constant
	});
});

// ─── fitTrend: RMSE and residual properties ────────────────────────────────────

describe('fitTrend — RMSE and residual properties', () => {
	it('RMSE is ~0 for a perfect linear fit', () => {
		const x = [0, 1, 2, 3, 4];
		const y = x.map((xi) => 5 * xi - 2);
		expect(fitTrend(x, y, 'linear').rmse).toBeCloseTo(0, 8);
	});

	it('linear residuals sum to ~0 (least-squares property)', () => {
		const x = [0, 1, 2, 3, 4, 5];
		const y = [1, 3, 2, 5, 4, 6];
		const { fitted } = fitTrend(x, y, 'linear');
		const residualSum = y.reduce((s, yi, i) => s + (yi - fitted[i]), 0);
		expect(residualSum).toBeCloseTo(0, 6);
	});

	it('fitted length matches input for every model', () => {
		const x = [1, 2, 3, 4, 5];
		const y = x.map((xi) => 2 * xi + 1);
		for (const model of ['linear', 'exponential', 'logarithmic', 'polynomial']) {
			expect(fitTrend(x, y, model, 2).fitted).toHaveLength(5);
		}
	});
});

// ─── removetrend wrapper (default index x-axis) ────────────────────────────────
// With xColId === -1 the wrapper builds an index axis [0,1,2,...] and detrends.

describe('removetrend — index axis, linear', () => {
	it('reduces a perfect linear trend to ~zero residuals', () => {
		const x = [3, 5, 7, 9, 11]; // y = 2*index + 3
		const out = removetrend(x, { xColId: -1, model: 'linear' });
		out.forEach((v) => expect(v).toBeCloseTo(0, 8));
	});

	it('preserves null/NaN entries at their positions', () => {
		const out = removetrend([3, null, 7, NaN, 11], { xColId: -1, model: 'linear' });
		expect(out[1]).toBeNull();
		expect(Number.isNaN(out[3])).toBe(true);
		// the three valid points lie on a perfect line → residuals ≈ 0
		[0, 2, 4].forEach((i) => expect(out[i]).toBeCloseTo(0, 8));
	});

	it('returns a copy unchanged when fewer than 2 valid points', () => {
		const x = [null, 5, null];
		const out = removetrend(x, { xColId: -1, model: 'linear' });
		expect(out).toEqual(x);
		expect(out).not.toBe(x); // copy, not the same reference
	});

	it('returns a copy for an empty column', () => {
		const out = removetrend([], { xColId: -1, model: 'linear' });
		expect(out).toEqual([]);
	});

	it('does not mutate the input array', () => {
		const x = [3, 5, 7, 9];
		removetrend(x, { xColId: -1, model: 'linear' });
		expect(x).toEqual([3, 5, 7, 9]);
	});

	it('removes a quadratic trend with a polynomial model', () => {
		const x = [0, 1, 4, 9, 16, 25]; // y = index²
		const out = removetrend(x, { xColId: -1, model: 'polynomial', polyDegree: 2 });
		out.forEach((v) => expect(v).toBeCloseTo(0, 6));
	});

	it('applies sliding-window standardisation to residuals when enabled', () => {
		// Perfect line → residuals all ~0; sliding standardisation divides by std (||1)
		// guard, so output stays finite (0/1 = 0) rather than NaN.
		const x = [2, 4, 6, 8, 10, 12, 14, 16];
		const out = removetrend(x, {
			xColId: -1,
			model: 'linear',
			slidingWindow: true,
			windowSize: 4
		});
		out.forEach((v) => expect(Number.isFinite(v)).toBe(true));
	});
});
