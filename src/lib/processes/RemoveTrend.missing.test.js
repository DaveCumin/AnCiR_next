// STAT-4: RemoveTrend fitted rows with a missing X at x = 0.
//
// The pair filter was `!isNaN(v) && x[i] != null && !isNaN(x[i])`: the y side was guarded
// but the X side only by `!isNaN(v)`, and isNaN(null) is false, so a missing time became a
// point at x = 0 and dragged the fitted line. The static guard (noBareIsNaNFilter) missed it
// because the line also contained `x[i] != null`. Reviewer's exact inputs: X = [null, 1..7],
// y = 2X with y[0] = 100. The complete rows lie exactly on y = 2X, so they must detrend to 0;
// the row with no X has no fitted value and passes through untouched.
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
			expect(out[0]).toBe(100); // no X, no fitted value: passed through
			for (let i = 1; i < 8; i++) expect(out[i]).toBeCloseTo(0, 10);
		});
	}

	it('a missing y passes through and is not fitted as 0', () => {
		mockColumns[7] = { type: 'number', getData: () => [0, 1, 2, 3, 4, 5] };
		const out = removetrend([0, 2, '', 6, null, 10], args);
		expect(out[2]).toBe('');
		expect(out[4]).toBe(null);
		for (const i of [0, 1, 3, 5]) expect(out[i]).toBeCloseTo(0, 10);
	});

	it('numeric strings are fitted as numbers', () => {
		mockColumns[7] = { type: 'number', getData: () => ['0', '1', '2', '3'] };
		const out = removetrend(['1', '3', '5', '7'], args);
		for (const v of out) expect(v).toBeCloseTo(0, 10);
	});

	it('a real 0 X is data', () => {
		mockColumns[7] = { type: 'number', getData: () => [0, 1, 2, 3] };
		const out = removetrend([100, 2, 4, 6], args);
		// (0, 100) is a real point, so it pulls the line and nothing detrends to 0.
		expect(Math.abs(out[1])).toBeGreaterThan(1);
	});
});
