// @ts-nocheck
// E2E-shaped guard: a CSV with blank cells in a numeric column, run through the SAME
// PapaParse configuration ImportData.svelte uses, must not fabricate zeros downstream.
//
// The hole: `isNaN('') === false` (JS coerces '' to 0), so an empty or whitespace-only
// string sailed through `isInvalidValue` and `Number()` then turned it into a LITERAL 0 —
// a fabricated data point. PapaParse's dynamicTyping converts a fully-empty cell to null
// (already rejected), but a WHITESPACE-only cell stays the string ' ', and '' itself
// arrives from the EnSpire path (dynamicTyping:false), Enter Data, pastes and sessions.
//
// Hand-computed truth for the fixture below (blanks at t=1,3,6):
//   valid v = [5, 0, 7, 3, 4, 6, 2]  → n=7, mean = 27/7 ≈ 3.857142857
//   linear fit on the 7 valid pairs → slope = 14/448 = 0.03125,
//                                     intercept = 25.90625/7 ≈ 3.700892857
// Buggy behaviour (documented before the fix): blanks counted as zeros →
//   n=9, mean = 3.0; slope = 45/620 ≈ 0.0725806, intercept ≈ 2.6451613.
import { describe, it, expect } from 'vitest';
import Papa from 'papaparse';
import { describeStats } from './describeStats.js';
import { isInvalidValue } from './stats.js';
import { validPairs } from './validPairs.js';
import { fitTrendSync } from './trendfit.js';

// t = 0..9; v has one fully-empty cell (t=1) and two whitespace-only cells (t=3, t=6),
// plus a GENUINE zero at t=2 that must survive as data.
const csv = ['t,v', '0,5', '1,', '2,0', '3, ', '4,7', '5,3', '6, ', '7,4', '8,6', '9,2'].join('\n');

function importColumns() {
	// Exactly the options ImportData.svelte passes to Papa.parse for CSV files.
	const { data } = Papa.parse(csv, {
		header: true,
		dynamicTyping: true,
		skipEmptyLines: 'greedy'
	});
	return {
		t: data.map((r) => r.t),
		v: data.map((r) => r.v)
	};
}

describe('blank CSV cells are missing data, not zeros', () => {
	it('the parsed column really contains the hazardous values (pins the Papa contract)', () => {
		const { v } = importColumns();
		expect(v).toEqual([5, null, 0, ' ', 7, 3, ' ', 4, 6, 2]);
	});

	it('DescribeData path: n and mean skip blanks but keep the genuine 0', () => {
		const { v } = importColumns();
		const stats = describeStats(v);
		expect(stats.n).toBe(7);
		expect(stats.mean).toBeCloseTo(27 / 7, 12);
		expect(stats.min).toBe(0); // the real zero is still data
	});

	it('TrendFit path: linear fit ignores blank rows (same filter TrendFit.svelte applies)', () => {
		const { t, v } = importColumns();
		// TrendFit.svelte builds its rows with the isInvalidValue pair filter; validPairs is
		// the canonical equivalent — assert they agree so this test tracks the real node path.
		const inline = t
			.map((_, i) => (isInvalidValue(t[i]) || isInvalidValue(v[i]) ? -1 : i))
			.filter((i) => i !== -1);
		const { tt, yy, indices } = validPairs(t, v);
		expect(indices).toEqual(inline);
		expect(indices).toEqual([0, 2, 4, 5, 7, 8, 9]);

		const fit = fitTrendSync(tt, yy, 'linear');
		expect(fit.parameters.slope).toBeCloseTo(0.03125, 12);
		expect(fit.parameters.intercept).toBeCloseTo(25.90625 / 7, 12);
	});
});
