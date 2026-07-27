import { describe, it, expect } from 'vitest';
import { fisherExact, fisherExactFromColumns } from './fisherExact.js';

// Every p-value and odds ratio below was checked against
// scipy.stats.fisher_exact. A 180-comparison sweep (all three alternatives over
// fixed edge cases plus 50 random tables, n up to ~400) agreed to 2.4e-14; the
// cases pinned here are the informative ones from that sweep.

describe('fisherExact — agreement with scipy', () => {
	it("Fisher's tea-tasting table", () => {
		// The original worked example: 4 cups each way, 3 correct.
		const r = fisherExact(
			[
				[3, 1],
				[1, 3]
			],
			'greater'
		);
		expect(r.valid).toBe(true);
		expect(r.pvalue).toBeCloseTo(0.24285714285714285, 12);
	});

	it('two-sided on a small asymmetric table', () => {
		const r = fisherExact([
			[1, 9],
			[11, 3]
		]);
		expect(r.pvalue).toBeCloseTo(0.0027594561852521166, 12);
		expect(r.oddsRatio).toBeCloseTo(0.030303030303030304, 12);
	});

	it('one-sided tails on the same table', () => {
		expect(
			fisherExact(
				[
					[1, 9],
					[11, 3]
				],
				'less'
			).pvalue
		).toBeCloseTo(0.0013797280926100418, 12);
		expect(
			fisherExact(
				[
					[1, 9],
					[11, 3]
				],
				'greater'
			).pvalue
		).toBeCloseTo(0.9999663480953022, 12);
	});

	it('a balanced table is far from significant', () => {
		const r = fisherExact([
			[3, 3],
			[3, 3]
		]);
		expect(r.pvalue).toBeCloseTo(1, 12);
		expect(r.oddsRatio).toBeCloseTo(1, 12);
	});

	it('perfect separation', () => {
		const r = fisherExact([
			[10, 0],
			[0, 10]
		]);
		expect(r.pvalue).toBeCloseTo(1.0825088224469013e-5, 15);
		expect(r.oddsRatio).toBe(Infinity);
	});

	it('handles a moderately large table without overflowing', () => {
		// Factorial-ratio implementations blow up here; the log-space version does not.
		const r = fisherExact([
			[100, 50],
			[40, 110]
		]);
		expect(r.valid).toBe(true);
		expect(r.pvalue).toBeCloseTo(4.467383093506087e-12, 20);
		expect(r.oddsRatio).toBeCloseTo(5.5, 12);
	});

	it('agrees with scipy on a skewed-margin table where doubling the tail would not', () => {
		// The two-sided convention matters: doubling the smaller tail gives
		// ~0.0699 here, and on other tables can exceed 1.
		const r = fisherExact([
			[8, 2],
			[1, 5]
		]);
		expect(r.pvalue).toBeCloseTo(0.034965034965034975, 12);
	});
});

describe('fisherExact — structural properties', () => {
	it('the two one-sided tails cover the whole distribution', () => {
		// P(A<=a) + P(A>=a) = 1 + P(A=a), since the observed point is in both.
		const table = [
			[6, 12],
			[12, 6]
		];
		const less = fisherExact(table, 'less').pvalue;
		const greater = fisherExact(table, 'greater').pvalue;
		expect(less + greater).toBeGreaterThan(1);
		expect(less + greater).toBeLessThan(2);
	});

	it('is invariant to transposing the table', () => {
		const a = fisherExact([
			[3, 7],
			[8, 2]
		]).pvalue;
		const b = fisherExact([
			[3, 8],
			[7, 2]
		]).pvalue;
		expect(a).toBeCloseTo(b, 12);
	});

	it('swapping both rows and columns leaves the p-value unchanged', () => {
		const a = fisherExact([
			[3, 7],
			[8, 2]
		]).pvalue;
		const b = fisherExact([
			[2, 8],
			[7, 3]
		]).pvalue;
		expect(a).toBeCloseTo(b, 12);
	});

	it('every p-value lies in [0, 1]', () => {
		for (const t of [
			[
				[0, 5],
				[7, 2]
			],
			[
				[1, 1],
				[1, 1]
			],
			[
				[2, 7],
				[8, 2]
			],
			[
				[50, 1],
				[1, 50]
			]
		]) {
			for (const alt of ['two-sided', 'less', 'greater']) {
				const p = fisherExact(t, alt).pvalue;
				expect(p).toBeGreaterThanOrEqual(0);
				expect(p).toBeLessThanOrEqual(1);
			}
		}
	});

	it('scaling counts up makes the same association more significant', () => {
		const small = fisherExact([
			[4, 1],
			[1, 4]
		]).pvalue;
		const large = fisherExact([
			[40, 10],
			[10, 40]
		]).pvalue;
		expect(large).toBeLessThan(small);
	});
});

describe('fisherExact — degenerate margins', () => {
	it('returns p = 1 when a row margin is zero (only one table is possible)', () => {
		expect(
			fisherExact([
				[0, 0],
				[3, 5]
			]).pvalue
		).toBe(1);
	});

	it('returns p = 1 when a column margin is zero', () => {
		expect(
			fisherExact([
				[0, 4],
				[0, 6]
			]).pvalue
		).toBe(1);
	});

	it('an all-zero table is reported as empty rather than significant', () => {
		const r = fisherExact([
			[0, 0],
			[0, 0]
		]);
		expect(r.valid).toBe(false);
		expect(r.reason).toMatch(/empty/);
	});

	it('an undefined odds ratio is NaN, not Infinity', () => {
		// b*c = 0 AND a*d = 0 — genuinely 0/0.
		const r = fisherExact([
			[0, 0],
			[0, 5]
		]);
		expect(Number.isNaN(r.oddsRatio)).toBe(true);
	});
});

describe('fisherExact — guards', () => {
	it('rejects tables that are not 2x2', () => {
		expect(
			fisherExact([
				[1, 2, 3],
				[4, 5, 6]
			]).valid
		).toBe(false);
		expect(fisherExact([[1, 2]]).valid).toBe(false);
		expect(
			fisherExact([
				[1, 2],
				[3, 4],
				[5, 6]
			]).valid
		).toBe(false);
	});

	it('rejects non-array input without throwing', () => {
		expect(fisherExact(null).valid).toBe(false);
		expect(fisherExact(undefined).valid).toBe(false);
		expect(fisherExact([1, 2]).valid).toBe(false);
	});

	it('rejects negative counts', () => {
		const r = fisherExact([
			[-1, 2],
			[3, 4]
		]);
		expect(r.valid).toBe(false);
		expect(r.reason).toMatch(/non-negative/);
	});

	it('REFUSES non-integer counts rather than rounding them', () => {
		// Rounding would silently answer a different question; there is no exact
		// distribution for fractional counts.
		const r = fisherExact([
			[1.5, 2],
			[3, 4]
		]);
		expect(r.valid).toBe(false);
		expect(r.reason).toMatch(/whole numbers/);
	});

	it('rejects an unknown alternative', () => {
		const r = fisherExact(
			[
				[1, 2],
				[3, 4]
			],
			'both'
		);
		expect(r.valid).toBe(false);
		expect(r.reason).toMatch(/unknown alternative/);
	});
});

describe('fisherExactFromColumns', () => {
	const treated = ['A', 'A', 'A', 'A', 'B', 'B', 'B', 'B'];
	const outcome = ['yes', 'yes', 'yes', 'no', 'no', 'no', 'no', 'yes'];

	it('builds the table in first-seen label order and tests it', () => {
		const r = fisherExactFromColumns(treated, outcome);
		expect(r.valid).toBe(true);
		expect(r.rowLabels).toEqual(['A', 'B']);
		expect(r.colLabels).toEqual(['yes', 'no']);
		expect(r.table).toEqual([
			[3, 1],
			[1, 3]
		]);
		expect(r.n).toBe(8);
		expect(r.pvalue).toBeCloseTo(0.4857142857142857, 12);
	});

	it('drops pairs where either value is missing', () => {
		// A row recording only one of the two variables says nothing about their
		// association, so it must not inflate n.
		const r = fisherExactFromColumns([...treated, 'A', null, ''], [...outcome, null, 'yes', 'no']);
		expect(r.n).toBe(8);
		expect(r.table).toEqual([
			[3, 1],
			[1, 3]
		]);
	});

	it('refuses more than two categories, naming the counts', () => {
		const r = fisherExactFromColumns(['A', 'B', 'C'], ['x', 'y', 'x']);
		expect(r.valid).toBe(false);
		expect(r.reason).toMatch(/exactly 2 categories/);
		expect(r.reason).toMatch(/3 and 2/);
	});

	it('treats numeric categories consistently with string ones', () => {
		const a = fisherExactFromColumns([0, 0, 1, 1], [1, 1, 0, 1]);
		const b = fisherExactFromColumns(['0', '0', '1', '1'], ['1', '1', '0', '1']);
		expect(a.table).toEqual(b.table);
	});

	it('passes the alternative through', () => {
		const two = fisherExactFromColumns(treated, outcome, 'two-sided').pvalue;
		const greater = fisherExactFromColumns(treated, outcome, 'greater').pvalue;
		expect(greater).toBeCloseTo(0.24285714285714285, 12);
		expect(greater).toBeLessThan(two);
	});

	it('handles empty or non-array input', () => {
		expect(fisherExactFromColumns([], []).valid).toBe(false);
		expect(fisherExactFromColumns(null, null).valid).toBe(false);
	});

	it('tolerates columns of different lengths by using the shorter', () => {
		const r = fisherExactFromColumns(treated, outcome.slice(0, 6));
		expect(r.n).toBe(6);
	});
});
