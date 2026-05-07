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

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
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
