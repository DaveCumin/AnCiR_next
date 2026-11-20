// STAT-4: RemoveTrend fitted rows with a missing X at x = 0.
//
// The pair filter was `!isNaN(v) && x[i] != null && !isNaN(x[i])`: the y side was guarded
// but the X side only by `!isNaN(v)`, and isNaN(null) is false, so a missing time became a
// point at x = 0 and dragged the fitted line. The static guard (noBareIsNaNFilter) missed it
// because the line also contained `x[i] != null`. Reviewer's exact inputs: X = [null, 1..7],
// y = 2X with y[0] = 100. The complete rows lie exactly on y = 2X, so they must detrend to 0;
// the row with no X has no fitted value and is blank in the output (2026-11-21: it used to pass
// through untouched, so one column mixed a raw value into the detrended ones).
import { describe, it, expect, vi } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));

import { removetrend } from './RemoveTrend.svelte';

const args = { xColId: 7, model: 'linear', polyDegree: 2, slidingWindow: false, windowSize: 10 };

describe('RemoveTrend with a missing X (STAT-4)', () => {
	for (const missing of [null, undefined, '', ' ', 'n/a', NaN]) {
		it(`an X of ${JSON.stringify(missing)} is not fitted at x = 0`, () => {
			mockColumns[7] = { type: 'number', getData: () => [missing, 1, 2, 3, 4, 5, 6, 7] };
			const y = [100, 2, 4, 6, 8, 10, 12, 14];
			const out = removetrend(y, args);
			expect(out[0]).toBe(null); // no X, no fitted value: blank, not the raw 100
			for (let i = 1; i < 8; i++) expect(out[i]).toBeCloseTo(0, 10);
		});
	}

	it('a missing y stays blank and is not fitted as 0', () => {
		mockColumns[7] = { type: 'number', getData: () => [0, 1, 2, 3, 4, 5] };
		const out = removetrend([0, 2, '', 6, null, 10], args);
		expect(out[2]).toBe(null);
		expect(out[4]).toBe(null);
		for (const i of [0, 1, 3, 5]) expect(out[i]).toBeCloseTo(0, 10);
	});

	it('numeric strings are fitted as numbers', () => {
		mockColumns[7] = { type: 'number', getData: () => ['0', '1', '2', '3'] };
		const out = removetrend(['1', '3', '5', '7'], args);
		for (const v of out) expect(v).toBeCloseTo(0, 10);
	});

	it('no row of the output is a raw value: unfitted rows are blank, the rest detrended', () => {
		mockColumns[7] = { type: 'number', getData: () => [0, 1, null, 3, 4, '', 6, 7] };
		const y = [5, 7, 50, 11, 13, 60, 17, 19]; // y = 2x + 5 where x is known
		const out = removetrend(y, args);
		expect(out[2]).toBe(null);
		expect(out[5]).toBe(null);
		for (const i of [0, 1, 3, 4, 6, 7]) expect(out[i]).toBeCloseTo(0, 10);
		// With the sliding z-score too.
		const z = removetrend(y, { ...args, slidingWindow: true, windowSize: 3 });
		expect([z[2], z[5]]).toEqual([null, null]);
		expect(z.filter((v) => v != null)).toHaveLength(6);
	});

	it('fewer than 2 fitted rows, or a refused fit, passes the whole column through', () => {
		mockColumns[7] = { type: 'number', getData: () => [null, null, 2] };
		expect(removetrend([1, 2, 3], args)).toEqual([1, 2, 3]);
		mockColumns[7] = { type: 'number', getData: () => [0, null, 2, 3] };
		// Logarithmic needs x > 0: refused, so the input comes back whole (blank x included).
		expect(removetrend([1, 2, 3, 4], { ...args, model: 'logarithmic' })).toEqual([1, 2, 3, 4]);
	});

	it('a real 0 X is data', () => {
		mockColumns[7] = { type: 'number', getData: () => [0, 1, 2, 3] };
		const out = removetrend([100, 2, 4, 6], args);
		// (0, 100) is a real point, so it pulls the line and nothing detrends to 0.
		expect(Math.abs(out[1])).toBeGreaterThan(1);
	});
});
