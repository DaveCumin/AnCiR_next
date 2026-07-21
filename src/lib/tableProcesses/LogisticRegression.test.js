import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: { set: vi.fn() } } }));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));

import { logisticregression } from './LogisticRegression.svelte';

const X1 = [2, 4, 1, 3, 5, 2, 6, 3, 7, 1, 5, 4, 8, 2, 6, 3, 7, 5, 4, 9, 1, 6, 3, 8, 5, 2, 7, 4, 6, 3, 5, 8, 2, 7, 4, 6, 3, 9, 5, 7];
const X2 = [1, 3, 2, 5, 1, 4, 2, 6, 3, 5, 2, 7, 1, 4, 6, 3, 2, 8, 5, 1, 7, 3, 6, 2, 4, 8, 1, 5, 3, 7, 2, 6, 4, 1, 8, 3, 5, 2, 6, 4];
const Y = [1, 1, 0, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 1];

const OUT = { term: -1, coef: -1, se: -1, z: -1, pvalue: -1, oddsRatio: -1, ciLow: -1, ciHigh: -1, outcome: -1, eta: -1, fitted: -1 };
const args = (over) => ({ yIN: 10, xIN: [1, 2], out: { ...OUT }, ...over });

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	mockColumns[1] = { name: 'x1', getData: () => X1 };
	mockColumns[2] = { name: 'x2', getData: () => X2 };
	mockColumns[10] = { name: 'outcome', getData: () => Y };
	mockColumns[11] = { name: 'grp', getData: () => Y.map((v) => (v ? 'yes' : 'no')) };
});

describe('logisticregression', () => {
	it('is invalid without an outcome or predictors', () => {
		expect(logisticregression(args({ yIN: -1 }))[1]).toBe(false);
		expect(logisticregression(args({ xIN: [] }))[1]).toBe(false);
	});

	it('emits one row per term with matching coefficients', () => {
		const [r, valid] = logisticregression(args());
		expect(valid).toBe(true);
		expect(r.converged).toBe(true);
		expect(r.rows.map((x) => x.term)).toEqual(['(intercept)', 'x1', 'x2']);
		expect(r.rows[1].coef).toBeCloseTo(0.641579, 4);
		expect(r.rows[1].oddsRatio).toBeCloseTo(1.899478, 4);
		expect(r.pseudoR2).toBeCloseTo(0.498456, 4);
	});

	it('passes through per-observation outputs for the quick-plot', () => {
		const [r] = logisticregression(args());
		expect(r.perObs.eta).toHaveLength(40);
		expect(r.perObs.fitted).toHaveLength(40);
		expect(r.perObs.outcome).toHaveLength(40);
		// fitted lies exactly on the sigmoid of eta
		expect(r.perObs.fitted[0]).toBeCloseTo(1 / (1 + Math.exp(-r.perObs.eta[0])), 9);
	});

	it('coerces a two-level category outcome to 0/1 (positive = second sorted level)', () => {
		const [r, valid] = logisticregression(args({ yIN: 11 }));
		expect(valid).toBe(true);
		expect(r.positiveClass).toBe('yes'); // 'yes' > 'no' sorted
		expect(r.rows[1].coef).toBeCloseTo(0.641579, 4); // identical fit to numeric 0/1
	});

	it('warns and returns no rows for a non-binary outcome', () => {
		mockColumns[12] = { name: 'three', getData: () => X1 }; // many distinct values
		const [r, valid] = logisticregression(args({ yIN: 12 }));
		expect(valid).toBe(true);
		expect(r.rows).toHaveLength(0);
		expect(r.warnings[0]).toContain('not binary');
	});
});
