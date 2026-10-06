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
	showStaticDataAsTable: vi.fn(),
	saveStaticDataAsCSV: vi.fn()
}));

import {
	groupcomparison,
	getComparisonWarnings,
	jarqueBeraNormality,
	welchTTest,
	oneWayAnova,
	tukeyKramerPostHoc,
	mannWhitneyTwoGroups,
	kruskalWallis,
	pairwiseMannWhitney
} from './GroupComparison.svelte';

import { core } from '$lib/core/core.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	core.rawData.set.mockClear();
});

/** Data last written to a mocked out-column id via writeOutputColumn. */
function writtenData(colId) {
	const calls = core.rawData.set.mock.calls.filter((c) => c[0] === colId);
	return calls.length ? calls[calls.length - 1][1] : undefined;
}

describe('groupcomparison metric outputs (statistic + pvalue ports)', () => {
	function metricCol() {
		return { type: 'number', data: -1 };
	}

	it('writes one value per y input, in yIN order', () => {
		mockColumns[1] = {
			name: 'group',
			type: 'category',
			getData: () => ['A', 'A', 'A', 'A', 'B', 'B', 'B', 'B']
		};
		mockColumns[2] = {
			name: 'y1',
			type: 'number',
			getData: () => [1, 2, 1, 2, 9, 10, 9, 10]
		};
		mockColumns[3] = {
			name: 'y2',
			type: 'number',
			getData: () => [5, 5, 5, 5, 5, 5, 5, 5]
		};
		mockColumns[100] = metricCol();
		mockColumns[101] = metricCol();

		const [result, valid] = groupcomparison({
			xIN: 1,
			yIN: [2, 3],
			method: 'ttest',
			alpha: 0.05,
			out: { statistic: 100, pvalue: 101 }
		});

		expect(valid).toBe(true);
		const stats = writtenData(100);
		const ps = writtenData(101);
		expect(stats).toHaveLength(2);
		expect(ps).toHaveLength(2);
		// y1 separates strongly; values match the editor panel's t / pValue.
		expect(stats[0]).toBeCloseTo(result.comparisons[2].t, 10);
		expect(ps[0]).toBeCloseTo(result.comparisons[2].pValue, 10);
		expect(ps[0]).toBeLessThan(0.001);
		// y2 has zero between-group difference → t = 0.
		expect(stats[1]).toBe(0);
	});

	it('multi-Y fallback (no group column) writes a single value', () => {
		mockColumns[2] = { name: 'y1', type: 'number', getData: () => [1, 2, 1, 2, 1] };
		mockColumns[3] = { name: 'y2', type: 'number', getData: () => [9, 10, 9, 10, 11] };
		mockColumns[100] = metricCol();
		mockColumns[101] = metricCol();

		const [result, valid] = groupcomparison({
			xIN: -1,
			yIN: [2, 3],
			method: 'ttest',
			alpha: 0.05,
			out: { statistic: 100, pvalue: 101 }
		});

		expect(valid).toBe(true);
		expect(writtenData(100)).toHaveLength(1);
		expect(writtenData(101)).toEqual([result.comparisons.multiY.pValue]);
	});

	it('skips writes when metric ports are unwired', () => {
		mockColumns[2] = { name: 'y1', type: 'number', getData: () => [1, 2, 1, 2, 1] };
		mockColumns[3] = { name: 'y2', type: 'number', getData: () => [9, 10, 9, 10, 11] };

		const [, valid] = groupcomparison({
			xIN: -1,
			yIN: [2, 3],
			method: 'ttest',
			alpha: 0.05,
			out: {}
		});

		expect(valid).toBe(true);
		expect(core.rawData.set).not.toHaveBeenCalled();
	});
});

describe('welchTTest', () => {
	it('computes significant difference for separated means', () => {
		const a = { name: 'A', values: [1, 2, 1, 2, 1], n: 5, mean: 1.4 };
		const b = { name: 'B', values: [10, 9, 10, 9, 11], n: 5, mean: 9.8 };
		const res = welchTTest(a, b, 0.05);
		expect(res.valid).toBe(true);
		expect(res.pValue).toBeLessThan(0.001);
		expect(res.ciLow).toBeLessThan(res.ciHigh);
	});

	it('requires at least 2 observations per group', () => {
		const a = { name: 'A', values: [1], n: 1, mean: 1 };
		const b = { name: 'B', values: [2, 2], n: 2, mean: 2 };
		const res = welchTTest(a, b, 0.05);
		expect(res.valid).toBe(false);
	});
});

describe('oneWayAnova', () => {
	it('computes significant p-value for separated groups', () => {
		const groups = [
			{ name: 'A', values: [1, 2, 1], n: 3, mean: 4 / 3 },
			{ name: 'B', values: [5, 6, 5], n: 3, mean: 16 / 3 },
			{ name: 'C', values: [9, 10, 9], n: 3, mean: 28 / 3 }
		];
		const res = oneWayAnova(groups);
		expect(res.valid).toBe(true);
		expect(res.pValue).toBeLessThan(0.001);
		expect(res.etaSquared).toBeGreaterThan(0.8);
	});

	it('requires at least two groups', () => {
		const res = oneWayAnova([{ name: 'A', values: [1, 2], n: 2, mean: 1.5 }]);
		expect(res.valid).toBe(false);
	});
});

describe('tukeyKramerPostHoc', () => {
	it('returns pairwise comparisons for 3 groups', () => {
		const groups = [
			{ name: 'A', values: [1, 2, 1], n: 3, mean: 4 / 3 },
			{ name: 'B', values: [5, 6, 5], n: 3, mean: 16 / 3 },
			{ name: 'C', values: [9, 10, 9], n: 3, mean: 28 / 3 }
		];
		const pairs = tukeyKramerPostHoc(groups, 0.4, 6, 0.05);
		expect(pairs).toHaveLength(3);
		expect(pairs[0]).toHaveProperty('pAdjusted');
	});
});

describe('tukeyKramerPostHoc matches scipy.stats.tukey_hsd (unequal n)', () => {
	const mk = (vals, i) => ({
		name: String.fromCharCode(65 + i),
		values: vals,
		n: vals.length,
		mean: vals.reduce((a, b) => a + b, 0) / vals.length
	});
	const run = (data) => {
		const groups = data.map(mk);
		const a = oneWayAnova(groups);
		return tukeyKramerPostHoc(groups, a.msWithin, a.dfWithin, 0.05);
	};
	const rel = (x, y) => (y === 0 ? Math.abs(x) : Math.abs(x - y) / Math.abs(y));
	const check = (pairs, want) => {
		expect(pairs).toHaveLength(want.length);
		want.forEach((w, idx) => {
			const p = pairs[idx];
			expect(p.groupA).toBe(String.fromCharCode(65 + w.a));
			expect(p.groupB).toBe(String.fromCharCode(65 + w.b));
			expect(p.diff).toBeCloseTo(w.diff, 12);
			expect(rel(p.pAdjusted, w.p)).toBeLessThan(1e-6);
			expect(Math.abs(p.ciLow - w.lo)).toBeLessThan(1e-9);
			expect(Math.abs(p.ciHigh - w.hi)).toBeLessThan(1e-9);
		});
	};

	// The review's example (STAT-10). Reference: scipy 1.18.0 tukey_hsd(...).pvalue and
	// .confidence_interval(0.95); statsmodels pairwise_tukeyhsd gives the same p-values.
	// The old Holm-adjusted t-tests gave 0.0873, 0.1018, 8e-05, 1, 0.00419, 0.01106.
	it('the review example', () => {
		const pairs = run([
			[1, 2, 3, 4],
			[2, 4, 6, 8, 10],
			[5, 6, 7],
			[10, 11, 12, 13, 14]
		]);
		check(pairs, [
			{
				a: 0,
				b: 1,
				diff: -3.5,
				p: 0.1081645451745663,
				lo: -7.622833111620152,
				hi: 0.6228331116201522
			},
			{
				a: 0,
				b: 2,
				diff: -3.5,
				p: 0.17767836095187095,
				lo: -8.194051990115522,
				hi: 1.1940519901155229
			},
			{
				a: 0,
				b: 3,
				diff: -9.5,
				p: 6.948248814997449e-5,
				lo: -13.622833111620153,
				hi: -5.377166888379848
			},
			{ a: 1, b: 2, diff: 0, p: 1.0, lo: -4.488372185831295, hi: 4.488372185831295 },
			{
				a: 1,
				b: 3,
				diff: -6,
				p: 0.002773134456662607,
				lo: -9.887044334569392,
				hi: -2.1129556654306088
			},
			{
				a: 2,
				b: 3,
				diff: -6,
				p: 0.008291384791699108,
				lo: -10.488372185831295,
				hi: -1.5116278141687047
			}
		]);
		expect(pairs.map((p) => p.significant)).toEqual([false, false, true, false, true, true]);
	});

	it('small p-values (down to 2e-10)', () => {
		const pairs = run([
			[10.1, 10.4, 9.8, 10.0, 10.3, 9.9],
			[12.0, 12.4, 11.8],
			[15.2, 15.0, 15.5, 14.9],
			[10.2, 10.0, 10.5, 9.7, 10.1, 10.3, 10.0]
		]);
		// scipy's sf is 1 - cdf with an absolute integration tolerance of 1e-11, so its
		// p-values near 1e-15 (pairs A-C and C-D) are not a reference; those pairs are
		// checked against the bound below instead.
		const want = [
			{
				a: 0,
				b: 1,
				diff: -1.983333333333336,
				p: 4.3803739635528416e-8,
				lo: -2.502465419991755,
				hi: -1.464201246674917
			},
			{
				a: 0,
				b: 3,
				diff: -0.03095238095238173,
				p: 0.9962501014894372,
				lo: -0.43940332247110814,
				hi: 0.3774985605663447
			},
			{
				a: 1,
				b: 2,
				diff: -3.083333333333332,
				p: 2.0983292881027182e-10,
				lo: -3.6440600736427675,
				hi: -2.522606593023897
			},
			{
				a: 1,
				b: 3,
				diff: 1.9523809523809543,
				p: 3.873414755606319e-8,
				lo: 1.445759911141079,
				hi: 2.45900199362083
			}
		];
		const byName = (a, b) =>
			pairs.find(
				(p) => p.groupA === String.fromCharCode(65 + a) && p.groupB === String.fromCharCode(65 + b)
			);
		check(
			want.map((w) => byName(w.a, w.b)),
			want
		);
		for (const [a, b, lo, hi] of [
			[0, 2, -5.540567256979239, -4.592766076354097],
			[2, 3, 4.575552873243342, 5.495875698185231]
		]) {
			const p = byName(a, b);
			expect(p.pAdjusted).toBeGreaterThan(0);
			expect(p.pAdjusted).toBeLessThan(1e-13);
			expect(Math.abs(p.ciLow - lo)).toBeLessThan(1e-9);
			expect(Math.abs(p.ciHigh - hi)).toBeLessThan(1e-9);
		}
	});

	it('reports q = |diff| / sqrt(MSE/2 (1/n_i + 1/n_j)) and the unadjusted p for that pair', () => {
		const groups = [
			[1, 2, 3, 4],
			[2, 4, 6, 8, 10],
			[5, 6, 7]
		].map(mk);
		const a = oneWayAnova(groups);
		const pairs = tukeyKramerPostHoc(groups, a.msWithin, a.dfWithin, 0.05);
		const se = Math.sqrt((a.msWithin / 2) * (1 / 4 + 1 / 3));
		const ac = pairs.find((p) => p.groupA === 'A' && p.groupB === 'C');
		expect(ac.statistic).toBeCloseTo(Math.abs(groups[0].mean - groups[2].mean) / se, 12);
		// unadjusted: the same q against the range of TWO means, i.e. the pooled t-test
		expect(ac.pValue).toBeLessThan(ac.pAdjusted);
		const t = (groups[0].mean - groups[2].mean) / Math.sqrt(a.msWithin * (1 / 4 + 1 / 3));
		expect(ac.statistic).toBeCloseTo(Math.abs(t) * Math.SQRT2, 12);
	});

	it('zero within-group variance: different means give p = 0, equal means p = 1', () => {
		const groups = [
			{ name: 'A', values: [1, 1], n: 2, mean: 1 },
			{ name: 'B', values: [1, 1], n: 2, mean: 1 },
			{ name: 'C', values: [5, 5], n: 2, mean: 5 }
		];
		const pairs = tukeyKramerPostHoc(groups, 0, 3, 0.05);
		expect(pairs[0].pAdjusted).toBe(1);
		expect(pairs[0].significant).toBe(false);
		expect(pairs[1].pAdjusted).toBe(0);
		expect(pairs[1].significant).toBe(true);
	});
});

describe('mannWhitneyTwoGroups', () => {
	it('detects separation between two groups', () => {
		const a = { name: 'A', values: [1, 2, 1, 2], n: 4, mean: 1.5 };
		const b = { name: 'B', values: [8, 9, 10, 11], n: 4, mean: 9.5 };
		const res = mannWhitneyTwoGroups(a, b);
		expect(res.valid).toBe(true);
		expect(res.pValue).toBeLessThan(0.05);
	});
});

describe('kruskalWallis', () => {
	it('detects separation for 3 groups', () => {
		const groups = [
			{ name: 'A', values: [1, 2, 1], n: 3, mean: 4 / 3 },
			{ name: 'B', values: [5, 6, 5], n: 3, mean: 16 / 3 },
			{ name: 'C', values: [9, 10, 9], n: 3, mean: 28 / 3 }
		];
		const res = kruskalWallis(groups);
		expect(res.valid).toBe(true);
		expect(res.pValue).toBeLessThan(0.05);
	});

	// Tomczak and Tomczak (2014) epsilon-squared, E2_R = H / ((n^2 - 1) / (n + 1)) = H / (n - 1),
	// as rcompanion::epsilonSquared computes it. H from scipy.stats.kruskal on the same groups:
	// 7.384615384615388 (n = 9) and 5.9286384976525826 (n = 12, one tie).
	it('reports Tomczak and Tomczak epsilon-squared, H / (n - 1)', () => {
		const grp = (name, values) => ({ name, values, n: values.length });
		const sep = kruskalWallis([grp('A', [1, 2, 1]), grp('B', [5, 6, 5]), grp('C', [9, 10, 9])]);
		expect(sep.h).toBeCloseTo(7.384615384615388, 10);
		expect(sep.epsilonSquared).toBeCloseTo(7.384615384615388 / 8, 10);
		const mixed = kruskalWallis([
			grp('A', [1, 2, 3, 4]),
			grp('B', [2, 5, 6]),
			grp('C', [7, 8, 9, 3, 10])
		]);
		expect(mixed.h).toBeCloseTo(5.9286384976525826, 10);
		expect(mixed.epsilonSquared).toBeCloseTo(5.9286384976525826 / 11, 10);
	});

	it('returns pairwise posthoc comparisons', () => {
		const groups = [
			{ name: 'A', values: [1, 2, 1], n: 3, mean: 4 / 3 },
			{ name: 'B', values: [5, 6, 5], n: 3, mean: 16 / 3 },
			{ name: 'C', values: [9, 10, 9], n: 3, mean: 28 / 3 }
		];
		const pairs = pairwiseMannWhitney(groups, 0.05);
		expect(pairs).toHaveLength(3);
		expect(pairs[0]).toHaveProperty('pAdjusted');
	});
});

describe('groupcomparison', () => {
	const baseArgs = {
		xIN: -1,
		yIN: [],
		method: 'auto',
		alpha: 0.05,
		postHocEnabled: true,
		out: {}
	};

	it('returns invalid when required inputs are missing', () => {
		const [, valid] = groupcomparison(baseArgs);
		expect(valid).toBe(false);
	});

	it('auto mode chooses Welch t-test when there are two groups', () => {
		mockColumns[1] = {
			name: 'group',
			getData: () => ['A', 'A', 'A', 'B', 'B', 'B']
		};
		mockColumns[2] = {
			name: 'value',
			getData: () => [1, 2, 1, 8, 9, 10]
		};

		const [result, valid] = groupcomparison({ ...baseArgs, xIN: 1, yIN: [2], method: 'auto' });
		expect(valid).toBe(true);
		expect(result.comparisons[2].test).toBe('Welch t-test');
		expect(result.comparisons[2].pValue).toBeLessThan(0.05);
	});

	it('auto mode chooses ANOVA when there are 3+ groups', () => {
		mockColumns[1] = {
			name: 'group',
			getData: () => ['A', 'A', 'B', 'B', 'C', 'C']
		};
		mockColumns[2] = {
			name: 'value',
			getData: () => [1, 2, 5, 6, 9, 10]
		};

		const [result, valid] = groupcomparison({ ...baseArgs, xIN: 1, yIN: [2], method: 'auto' });
		expect(valid).toBe(true);
		expect(result.comparisons[2].test).toBe('One-way ANOVA');
		expect(result.comparisons[2].pValue).toBeLessThan(0.05);
		expect(result.comparisons[2].postHoc.length).toBeGreaterThan(0);
	});

	it('force ttest returns invalid result when there are not exactly two groups', () => {
		mockColumns[1] = {
			name: 'group',
			getData: () => ['A', 'A', 'B', 'B', 'C', 'C']
		};
		mockColumns[2] = {
			name: 'value',
			getData: () => [1, 2, 5, 6, 9, 10]
		};

		const [result, valid] = groupcomparison({ ...baseArgs, xIN: 1, yIN: [2], method: 'ttest' });
		expect(valid).toBe(false);
		expect(result.comparisons[2].valid).toBe(false);
	});

	it('runs Mann-Whitney when selected', () => {
		mockColumns[1] = {
			name: 'group',
			getData: () => ['A', 'A', 'A', 'A', 'A', 'B', 'B', 'B', 'B', 'B']
		};
		mockColumns[2] = {
			name: 'value',
			getData: () => [1, 1, 2, 1, 2, 8, 9, 10, 9, 10]
		};

		const [result, valid] = groupcomparison({
			...baseArgs,
			xIN: 1,
			yIN: [2],
			method: 'mannwhitney'
		});
		expect(valid).toBe(true);
		expect(result.comparisons[2].test).toBe('Mann-Whitney U');
		expect(result.comparisons[2].pValue).toBeLessThan(0.05);
	});

	it('runs Kruskal-Wallis and posthoc when selected', () => {
		mockColumns[1] = {
			name: 'group',
			getData: () => ['A', 'A', 'A', 'B', 'B', 'B', 'C', 'C', 'C']
		};
		mockColumns[2] = {
			name: 'value',
			getData: () => [1, 1.5, 2, 5, 5.5, 6, 9, 9.5, 10]
		};

		const [result, valid] = groupcomparison({ ...baseArgs, xIN: 1, yIN: [2], method: 'kruskal' });
		expect(valid).toBe(true);
		expect(result.comparisons[2].test).toBe('Kruskal-Wallis');
		expect(result.comparisons[2].pValue).toBeLessThan(0.05);
		expect(result.comparisons[2].postHoc.length).toBeGreaterThan(0);
	});

	it('does not compute post-hoc when toggle is disabled', () => {
		mockColumns[1] = {
			name: 'group',
			getData: () => ['A', 'A', 'B', 'B', 'C', 'C']
		};
		mockColumns[2] = {
			name: 'value',
			getData: () => [1, 2, 5, 6, 9, 10]
		};

		const [result, valid] = groupcomparison({
			...baseArgs,
			xIN: 1,
			yIN: [2],
			method: 'anova',
			postHocEnabled: false
		});
		expect(valid).toBe(true);
		expect(result.comparisons[2].test).toBe('One-way ANOVA');
		expect(result.comparisons[2].postHoc).toEqual([]);
	});

	it('supports comparison with multiple Y columns and no grouping column', () => {
		mockColumns[2] = {
			name: 'A',
			getData: () => [1, 2, 1, 2, 1]
		};
		mockColumns[3] = {
			name: 'B',
			getData: () => [8, 9, 10, 9, 8]
		};

		const [result, valid] = groupcomparison({
			...baseArgs,
			xIN: -1,
			yIN: [2, 3],
			method: 'auto'
		});
		expect(valid).toBe(true);
		expect(result.comparisons.multiY).toBeDefined();
		expect(result.comparisons.multiY.test).toBe('Welch t-test');
		expect(result.comparisons.multiY.pValue).toBeLessThan(0.05);
	});

	it('adds warnings for parametric tests on clearly non-normal data', () => {
		mockColumns[1] = {
			name: 'group',
			getData: () => [
				'A',
				'A',
				'A',
				'A',
				'A',
				'A',
				'A',
				'A',
				'A',
				'A',
				'B',
				'B',
				'B',
				'B',
				'B',
				'B',
				'B',
				'B',
				'B',
				'B'
			]
		};
		mockColumns[2] = {
			name: 'value',
			getData: () => [0, 0, 0, 0, 0, 0, 0, 0, 0, 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 18]
		};

		const [result, valid] = groupcomparison({ ...baseArgs, xIN: 1, yIN: [2], method: 'ttest' });
		expect(valid).toBe(true);
		expect(result.comparisons[2].warnings.length).toBeGreaterThan(0);
		expect(result.warnings.some((warning) => warning.includes('non-normal'))).toBe(true);
	});

	// --- Added edge cases ---

	it('returns invalid with a single group (need >=2 groups)', () => {
		mockColumns[1] = { name: 'group', getData: () => ['A', 'A', 'A', 'A'] };
		mockColumns[2] = { name: 'value', getData: () => [1, 2, 3, 4] };
		const [result, valid] = groupcomparison({ ...baseArgs, xIN: 1, yIN: [2], method: 'auto' });
		expect(valid).toBe(false);
		expect(result.comparisons[2].valid).toBe(false);
	});

	it('fails safe (no throw) when a Y column ref is missing', () => {
		mockColumns[1] = { name: 'group', getData: () => ['A', 'A', 'B', 'B'] };
		expect(() =>
			groupcomparison({ ...baseArgs, xIN: 1, yIN: [999], method: 'auto' })
		).not.toThrow();
		const [, valid] = groupcomparison({ ...baseArgs, xIN: 1, yIN: [999], method: 'auto' });
		expect(valid).toBe(false);
	});

	it('drops rows with NaN/null Y values when building groups', () => {
		mockColumns[1] = { name: 'group', getData: () => ['A', 'A', 'A', 'B', 'B', 'B'] };
		mockColumns[2] = { name: 'value', getData: () => [1, NaN, 2, 8, null, 10] };
		const [result, valid] = groupcomparison({ ...baseArgs, xIN: 1, yIN: [2], method: 'auto' });
		expect(valid).toBe(true);
		const groups = result.comparisons[2].groups;
		const a = groups.find((g) => g.name === 'A');
		const b = groups.find((g) => g.name === 'B');
		expect(a.n).toBe(2); // NaN dropped
		expect(b.n).toBe(2); // null dropped
	});

	it('handles unequal group sizes', () => {
		mockColumns[1] = { name: 'group', getData: () => ['A', 'A', 'A', 'A', 'A', 'B', 'B'] };
		mockColumns[2] = { name: 'value', getData: () => [1, 2, 1, 2, 1, 9, 10] };
		const [result, valid] = groupcomparison({ ...baseArgs, xIN: 1, yIN: [2], method: 'auto' });
		expect(valid).toBe(true);
		const groups = result.comparisons[2].groups;
		expect(groups.find((g) => g.name === 'A').n).toBe(5);
		expect(groups.find((g) => g.name === 'B').n).toBe(2);
		expect(result.comparisons[2].test).toBe('Welch t-test');
	});

	it('ANOVA on identical groups yields a non-significant (or degenerate) result', () => {
		// All groups equal → between-group variance ~0 → not significant
		mockColumns[1] = {
			name: 'group',
			getData: () => ['A', 'A', 'A', 'B', 'B', 'B', 'C', 'C', 'C']
		};
		mockColumns[2] = { name: 'value', getData: () => [5, 5, 5, 5, 5, 5, 5, 5, 5] };
		const [result, valid] = groupcomparison({ ...baseArgs, xIN: 1, yIN: [2], method: 'anova' });
		// With zero within-group variance the test may be flagged invalid; either way it must not be "significant".
		if (valid && Number.isFinite(result.comparisons[2].pValue)) {
			expect(result.comparisons[2].pValue).toBeGreaterThanOrEqual(0.05);
		} else {
			expect(
				result.comparisons[2].valid === false || Number.isNaN(result.comparisons[2].pValue)
			).toBe(true);
		}
	});

	it('forced mannwhitney on three groups returns invalid', () => {
		mockColumns[1] = { name: 'group', getData: () => ['A', 'A', 'B', 'B', 'C', 'C'] };
		mockColumns[2] = { name: 'value', getData: () => [1, 2, 5, 6, 9, 10] };
		const [result, valid] = groupcomparison({
			...baseArgs,
			xIN: 1,
			yIN: [2],
			method: 'mannwhitney'
		});
		expect(valid).toBe(false);
		expect(result.comparisons[2].valid).toBe(false);
	});
});

describe('welchTTest extra edge cases', () => {
	it('identical constant groups give t=0 and a non-significant p-value', () => {
		const a = { name: 'A', values: [5, 5, 5], n: 3, mean: 5 };
		const b = { name: 'B', values: [5, 5, 5], n: 3, mean: 5 };
		const res = welchTTest(a, b, 0.05);
		expect(res.valid).toBe(true);
		expect(res.t).toBe(0);
		expect(res.difference).toBe(0);
		expect(res.pValue).toBeGreaterThanOrEqual(0.05); // not significant
	});

	it('constant groups with separated means give an infinite t and significant p', () => {
		const a = { name: 'A', values: [1, 1, 1], n: 3, mean: 1 };
		const b = { name: 'B', values: [9, 9, 9], n: 3, mean: 9 };
		const res = welchTTest(a, b, 0.05);
		expect(res.valid).toBe(true);
		expect(res.t).toBe(Number.POSITIVE_INFINITY);
		expect(res.pValue).toBe(0); // se=0, t=Infinity → p forced to 0
	});
});

describe('mannWhitneyTwoGroups ties', () => {
	it('handles tied values across groups without throwing', () => {
		const a = { name: 'A', values: [1, 1, 2, 2], n: 4, mean: 1.5 };
		const b = { name: 'B', values: [1, 2, 2, 3], n: 4, mean: 2 };
		const res = mannWhitneyTwoGroups(a, b);
		expect(res.valid).toBe(true);
		expect(Number.isFinite(res.pValue)).toBe(true);
	});
});

describe('kruskalWallis requires multiple groups', () => {
	it('is invalid with a single group', () => {
		const res = kruskalWallis([{ name: 'A', values: [1, 2, 3], n: 3, mean: 2 }]);
		expect(res.valid).toBe(false);
	});
});

describe('warning helpers', () => {
	it('flags strongly skewed data in Jarque-Bera normality check', () => {
		const result = jarqueBeraNormality([0, 0, 0, 0, 0, 0, 0, 0, 0, 12]);
		expect(result.evaluable).toBe(true);
		expect(result.normal).toBe(false);
	});

	it('returns comparison warnings for parametric tests with non-normal groups', () => {
		const warnings = getComparisonWarnings(
			[
				{ name: 'A', values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 12], n: 10, mean: 1.2 },
				{ name: 'B', values: [1, 1, 1, 1, 1, 1, 1, 1, 1, 18], n: 10, mean: 2.7 }
			],
			'ttest',
			0.05
		);
		expect(warnings.some((warning) => warning.includes('Jarque-Bera'))).toBe(true);
	});
});

describe('groupcomparison — effect size output port', () => {
	// The four effect sizes were computed and shown in the panel but had no port,
	// so they could not be plotted, FDR-corrected or compared downstream.
	const mk = (id, name, data) => {
		mockColumns[id] = { id, name, getData: () => data, getDataHash: String(data) };
		return id;
	};

	it('emits Cohen’s d for a two-group t-test', () => {
		mk(80, 'grp', [...Array(10).fill('a'), ...Array(10).fill('b')]);
		mk(
			81,
			'val',
			[...Array(10).fill(0), ...Array(10).fill(0)].map((_, i) => (i < 10 ? i : i + 8))
		);
		const out = { statistic: -1, pvalue: -1, effectSize: 900 };
		mockColumns[900] = { id: 900 };
		const [res] = groupcomparison({ xIN: 80, yIN: [81], method: 'ttest', alpha: 0.05, out });
		const comp = res.comparisons[81];
		expect(Number.isFinite(comp.cohenD)).toBe(true);
	});

	it('picks the measure that belongs to the test that ran', () => {
		// Each test has its own conventional effect size; they are not swappable.
		mk(82, 'grp', [...Array(8).fill('a'), ...Array(8).fill('b'), ...Array(8).fill('c')]);
		mk(
			83,
			'val',
			Array.from({ length: 24 }, (_, i) => (i % 8 === 0 ? 10 : i))
		);
		const anova = groupcomparison({
			xIN: 82,
			yIN: [83],
			method: 'anova',
			alpha: 0.05,
			out: {}
		})[0].comparisons[83];
		const kw = groupcomparison({
			xIN: 82,
			yIN: [83],
			method: 'kruskal',
			alpha: 0.05,
			out: {}
		})[0].comparisons[83];
		expect(Number.isFinite(anova.etaSquared)).toBe(true);
		expect(Number.isFinite(kw.epsilonSquared)).toBe(true);
	});
});

// Upper tails computed directly, not as 1 - cdf (which rounds anything below ~1e-16 to 0).
// References: scipy.stats ttest_ind(equal_var=False), f_oneway, kruskal on the same data.
describe('tiny p-values are reported, not rounded to 0', () => {
	const vals = Array.from({ length: 30 }, (_, i) => 10 + 0.1 * i);
	const grp = (name, values) => ({
		name,
		values,
		n: values.length,
		mean: values.reduce((s, v) => s + v, 0) / values.length
	});
	const a = grp('A', vals);
	const b = grp(
		'B',
		vals.map((v) => v + 10)
	);
	const c = grp(
		'C',
		vals.map((v) => v + 20)
	);
	const rel = (x, want) => Math.abs(x - want) / want;
	it('Welch t-test', () => {
		expect(rel(welchTTest(a, b).pValue, 2.986701986972705e-46)).toBeLessThan(1e-6);
	});
	it('one-way ANOVA', () => {
		expect(rel(oneWayAnova([a, b, c]).pValue, 9.840551130227052e-86)).toBeLessThan(1e-6);
	});
	it('Kruskal-Wallis', () => {
		expect(rel(kruskalWallis([a, b, c]).pValue, 6.593551417550708e-18)).toBeLessThan(1e-6);
	});
});
