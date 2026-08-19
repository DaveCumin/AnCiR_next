import { describe, it, expect, vi } from 'vitest';

// removetrend calls getColumnById, but with xColId === -1 it short-circuits and
// uses an index axis, so the mock (returning undefined) is fine for these tests.
// Mock the whole Column.svelte to avoid Svelte reactive state initialisation.
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: vi.fn(() => undefined) }));

import { removetrend } from './RemoveTrend.svelte';
// RemoveTrend used to carry a VERBATIM COPY of the trend maths in its module
// script. It now calls the shared fitTrendSync. The `fitTrend` describes below
// are kept, retargeted at the shared implementation, because they document the
// exact behaviours RemoveTrend's detrending depends on — if the shared code
// ever drifts from them, RemoveTrend's output changes.
import { fitTrendSync as fitTrend } from '$lib/utils/trendfit.js';

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

// ─── de-duplication guard: RemoveTrend and trendfit.js are ONE implementation ──
// RemoveTrend's module script used to define its own fitTrend/computeRSquared.
// These tests pin the contract that removetrend's output is exactly
// `y - fitTrendSync(...).fitted` at the valid indices, for every model.

describe('removetrend shares trendfit.js', () => {
	const models = ['linear', 'exponential', 'logarithmic', 'polynomial'];

	it.each(models)('%s: residuals equal y − fitTrendSync().fitted exactly', (model) => {
		// Positive, non-zero y so exponential's log(y) is defined; index axis
		// starts at 0, so shift it for the logarithmic branch's log(x).
		const y = [2.1, 3.4, 4.9, 6.1, 8.2, 9.9, 12.4, 15.1];
		const idx = y.map((_, i) => i);
		const expected = fitTrend(idx, y, model, 2).fitted.map((f, i) => y[i] - f);
		const out = removetrend(y, { xColId: -1, model, polyDegree: 2 });
		// logarithmic at x=0 is -Infinity; compare only the finite entries so the
		// test still asserts equality where the model is defined.
		for (let i = 0; i < y.length; i++) {
			if (Number.isFinite(expected[i])) expect(out[i]).toBe(expected[i]);
			else expect(Number.isFinite(out[i])).toBe(false);
		}
	});

	// The v72.20 bug class: a 'number' column's rawData is passed through
	// verbatim, so numeric STRINGS reach the fit after a CSV import or paste.
	// The old copy summed them with `+`, which concatenated, so SStot was NaN and
	// R² fell through to 0 for exponential / logarithmic / polynomial.
	// BEFORE this de-duplication these three assertions returned rSquared === 0.
	it.each(['exponential', 'logarithmic', 'polynomial'])(
		'%s: string-valued y gives the true R², not 0',
		(model) => {
			const x = [1, 2, 3, 4, 5, 6];
			const y = x.map((xi) => 2 * Math.exp(0.3 * xi));
			const r = fitTrend(x.map(String), y.map(String), model, 2);
			expect(r.rSquared).toBeGreaterThan(0.5);
			expect(r.rSquared).toBeCloseTo(fitTrend(x, y, model, 2).rSquared, 12);
		}
	);

	it('string-valued y detrends to the same numbers as numeric y', () => {
		const y = [2.1, 3.4, 4.9, 6.1, 8.2, 9.9];
		const fromNum = removetrend(y, { xColId: -1, model: 'polynomial', polyDegree: 2 });
		const fromStr = removetrend(y.map(String), { xColId: -1, model: 'polynomial', polyDegree: 2 });
		fromStr.forEach((v, i) => expect(v).toBeCloseTo(fromNum[i], 12));
	});
});
