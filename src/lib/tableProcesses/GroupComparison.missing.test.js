// Missing values in GroupComparison (ROB-7, STAT-1).
//
// The row filter was `gRaw == null || yRaw == null || Number.isNaN(yRaw)`, and Number.isNaN does
// not coerce, so:
//   - a NaN or '' group label became a real group (BlankColumn stores a blank numeric cell as
//     NaN): a two-group Welch t (p = 0.0213) silently became a four-group ANOVA (p = 0.00048);
//   - a blank y ('' or ' ') was pushed as Number('') === 0;
//   - a text y ('n/a') survived as NaN, the group mean became NaN, and the non-finite statistic
//     was then mapped to p = 0, i.e. "highly significant".
// The house rules are isMissingCategory (labels) and isInvalidValue (values). A NaN statistic is
// reported as an invalid result with NaN p, never p = 0. References are scipy.stats.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData: { set: vi.fn(), get: vi.fn(), has: vi.fn() } }
}));
vi.mock('$lib/core/Column.svelte', () => ({
	Column: class {},
	getColumnById: (id) => mockColumns[id],
	removeColumn: vi.fn()
}));
vi.mock('$lib/components/inputs/ColumnSelector.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/StoreValueButton.svelte', () => ({ default: {} }));
vi.mock('$lib/components/plotbits/Table.svelte', () => ({ default: {} }));
vi.mock('$lib/components/plotbits/helpers/save.svelte.js', () => ({
	showNodeResultTable: vi.fn(),
	saveStaticDataAsCSV: vi.fn()
}));

import {
	groupcomparison,
	jarqueBeraNormality,
	welchTTest,
	oneWayAnova,
	tukeyKramerPostHoc
} from './GroupComparison.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
});

function run(groups, y, method = 'auto') {
	mockColumns[1] = { name: 'group', type: 'category', getData: () => groups };
	mockColumns[2] = { name: 'y', type: 'number', getData: () => y };
	const [result, valid] = groupcomparison({ xIN: 1, yIN: [2], method, alpha: 0.05, out: {} });
	return { comp: result.comparisons[2], valid };
}

describe('GroupComparison: missing group labels are not groups', () => {
	it("reviewer's case: [1,1,1,2,2,2,NaN,NaN,'',''] with y = 1..10 is a two-group Welch t", () => {
		const { comp } = run([1, 1, 1, 2, 2, 2, NaN, NaN, '', ''], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		expect(comp.test).toBe('Welch t-test');
		expect(comp.groupCount).toBe(2);
		expect(comp.groups.map((g) => g.name)).toEqual(['1', '2']);
		// scipy.stats.ttest_ind([1,2,3],[4,5,6], equal_var=False)
		expect(comp.t).toBeCloseTo(-3.6742346141747673, 10);
		expect(comp.pValue).toBeCloseTo(0.021311641128756713, 10);
	});

	it("a stringified 'NaN' label and a null label are also dropped", () => {
		const { comp } = run(['A', 'A', 'A', 'B', 'B', 'B', 'NaN', null], [1, 2, 3, 4, 5, 6, 7, 8]);
		expect(comp.groupCount).toBe(2);
		expect(comp.nTotal).toBe(6);
	});

	it('a real 0 label is a group', () => {
		const { comp } = run([0, 0, 0, 1, 1, 1], [1, 2, 3, 4, 5, 6]);
		expect(comp.groups.map((g) => g.name)).toEqual(['0', '1']);
	});
});

describe('GroupComparison: missing y values are not zeros', () => {
	for (const blank of ['', ' ', null, undefined, NaN, 'NA']) {
		it(`a ${JSON.stringify(blank)} y is dropped, not read as 0`, () => {
			const { comp } = run(['A', 'A', 'A', 'B', 'B', 'B'], [1, 2, blank, 4, 5, 6]);
			expect(comp.groups[0].n).toBe(2);
			expect(comp.groups[0].values).toEqual([1, 2]);
			// scipy.stats.ttest_ind([1,2],[4,5,6], equal_var=False)
			expect(comp.t).toBeCloseTo(-4.582575694955841, 10);
			expect(comp.pValue).toBeCloseTo(0.021273413535480065, 10);
		});
	}

	it('a real 0 y is data', () => {
		const { comp } = run(['A', 'A', 'A', 'B', 'B', 'B'], [1, 2, 0, 4, 5, 6]);
		expect(comp.groups[0].n).toBe(3);
		// scipy.stats.ttest_ind([1,2,0],[4,5,6], equal_var=False)
		expect(comp.pValue).toBeCloseTo(0.008049893100837719, 10);
	});

	it('numeric-string y values are read as numbers (no concatenation)', () => {
		const { comp } = run(['A', 'A', 'A', 'B', 'B', 'B'], ['1', '2', '3', '4', '5', '6']);
		expect(comp.groups[0].mean).toBe(2);
		expect(comp.pValue).toBeCloseTo(0.021311641128756713, 10);
	});

	it("multi-Y fallback: [1,2,'n/a',3,4] vs [3,4,5,6] drops the text cell (scipy F = 4.8, p = 0.0710)", () => {
		mockColumns[2] = { name: 'A', type: 'number', getData: () => [1, 2, 'n/a', 3, 4] };
		mockColumns[3] = { name: 'B', type: 'number', getData: () => [3, 4, ' ', 5, 6] };
		const [result] = groupcomparison({ xIN: -1, yIN: [2, 3], method: 'anova', out: {} });
		const comp = result.comparisons.multiY;
		expect(comp.groups.map((g) => g.n)).toEqual([4, 4]);
		expect(comp.f).toBeCloseTo(4.8, 10);
		expect(comp.pValue).toBeCloseTo(0.07098765432098765, 10);
	});

	it('the normality screen drops blanks and text instead of reading them as 0 or NaN', () => {
		const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
		const ref = jarqueBeraNormality(vals);
		const got = jarqueBeraNormality([...vals, '', ' ', 'n/a', null]);
		expect(got.statistic).toBe(ref.statistic);
		expect(got.pValue).toBe(ref.pValue);
	});
});

describe('GroupComparison: a NaN statistic is invalid, never p = 0', () => {
	// A group whose values cannot give a mean (an infinite value, e.g. a pasted '1e999') makes
	// the statistic NaN. That used to come out as p = 0.
	const bad = { name: 'A', values: [1, 2, Infinity], n: 3, mean: Infinity };
	const ok = { name: 'B', values: [4, 5, 6], n: 3, mean: 5 };

	it('Welch t', () => {
		const r = welchTTest(bad, ok);
		expect(r.valid).toBe(false);
		expect(Number.isNaN(r.pValue)).toBe(true);
		expect(r.reason).toMatch(/could not be computed/);
	});

	it('ANOVA', () => {
		const r = oneWayAnova([bad, ok]);
		expect(r.valid).toBe(false);
		expect(Number.isNaN(r.pValue)).toBe(true);
		expect(r.reason).toMatch(/could not be computed/);
	});

	it('Tukey-Kramer pair', () => {
		const pairs = tukeyKramerPostHoc([bad, ok, { ...ok, name: 'C' }], 1, 6);
		const ab = pairs.find((p) => p.groupA === 'A' && p.groupB === 'B');
		expect(Number.isNaN(ab.pValue)).toBe(true);
		expect(ab.significant).toBe(false);
	});

	it('a node-level run with an infinite cell is not reported valid', () => {
		const { comp, valid } = run(['A', 'A', 'A', 'B', 'B', 'B'], [1, 2, '1e999', 4, 5, 6]);
		expect(valid).toBe(false);
		expect(comp.valid).toBe(false);
		expect(Number.isNaN(comp.pValue)).toBe(true);
	});

	it('an infinite t from zero within-group variance keeps its limiting p = 0 (pinned elsewhere)', () => {
		const r = welchTTest(
			{ name: 'A', values: [1, 1, 1], n: 3, mean: 1 },
			{ name: 'B', values: [9, 9, 9], n: 3, mean: 9 }
		);
		expect(r.valid).toBe(true);
		expect(r.pValue).toBe(0);
	});
});
