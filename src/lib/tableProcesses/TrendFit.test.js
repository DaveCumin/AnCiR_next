import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
const writtenRawData = new Map();
vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData: { set: (id, data) => writtenRawData.set(id, data) } }
}));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));
vi.mock('$lib/components/plotbits/helpers/wrangleData.js', () => ({
	linearRegression: (x, y) => {
		const n = x.length;
		const sumX = x.reduce((a, b) => a + b, 0);
		const sumY = y.reduce((a, b) => a + b, 0);
		const sumXY = x.reduce((a, xi, i) => a + xi * y[i], 0);
		const sumXX = x.reduce((a, xi) => a + xi * xi, 0);
		const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
		const intercept = (sumY - slope * sumX) / n;
		return { slope, intercept, rSquared: 1, rmse: 0 };
	}
}));

import { trendfit } from './TrendFit.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	writtenRawData.clear();
});

const preview = { trendx: -1 };

describe('trendfit', async () => {
	it('returns invalid when inputs are -1', async () => {
		const [, valid] = await trendfit({
			xIN: -1,
			yIN: -1,
			model: 'linear',
			out: preview,
			outputX: -1
		});
		expect(valid).toBe(false);
	});

	it('fits a linear model and returns fitted values', async () => {
		const x = [0, 1, 2, 3, 4, 5];
		const y = x.map((xi) => 2 * xi + 1);
		mockColumns[1] = { type: 'number', getData: () => x };
		mockColumns[2] = { type: 'number', getData: () => y };
		const [result, valid] = await trendfit({
			xIN: 1,
			yIN: 2,
			model: 'linear',
			out: preview,
			outputX: -1
		});
		expect(valid).toBe(true);
		expect(result.y_results[2].fittedData.fitted).toHaveLength(x.length);
		result.y_results[2].fittedData.fitted.forEach((v, i) => expect(v).toBeCloseTo(y[i], 3));
	});

	it('fits a polynomial model', async () => {
		const x = [0, 1, 2, 3, 4];
		const y = x.map((xi) => xi * xi);
		mockColumns[1] = { type: 'number', getData: () => x };
		mockColumns[2] = { type: 'number', getData: () => y };
		const [result, valid] = await trendfit({
			xIN: 1,
			yIN: 2,
			model: 'polynomial',
			polyDegree: 2,
			out: preview,
			outputX: -1
		});
		expect(valid).toBe(true);
		expect(result.y_results[2].fittedData.rSquared).toBeCloseTo(1, 4);
	});

	it('time x in → time x out: writes ms timestamps and types the output column as "time"', async () => {
		const t0 = Date.UTC(2026, 3, 30); // 2026-04-30 00:00:00 UTC
		const ms = [0, 3, 6, 9, 12].map((h) => t0 + h * 3_600_000);
		const y = [1, 2, 3, 4, 5];
		const xColOut = { data: null, type: null, tableProcessGUId: null, timeFormat: 'YYYY' };
		const yColOut = { data: null, type: null, tableProcessGUId: null };
		mockColumns[1] = { type: 'time', getData: () => ms, hoursSinceStart: [0, 3, 6, 9, 12] };
		mockColumns[2] = { type: 'number', getData: () => y };
		mockColumns[10] = xColOut;
		mockColumns[20] = yColOut;

		await trendfit({
			xIN: 1,
			yIN: 2,
			model: 'linear',
			out: { trendx: 10, trendy_2: 20 },
			outputX: -1
		});

		expect(xColOut.type).toBe('time');
		expect(xColOut.timeFormat).toBe(null);
		// hours-since-start mapped back to ms via t0 = ms[0]
		expect(writtenRawData.get(10)).toEqual(ms);
	});

	it('number x in → number x out: writes raw values and keeps the output column "number"', async () => {
		const x = [0, 1, 2, 3, 4];
		const y = [1, 2, 3, 4, 5];
		const xColOut = { data: null, type: null, tableProcessGUId: null };
		const yColOut = { data: null, type: null, tableProcessGUId: null };
		mockColumns[1] = { type: 'number', getData: () => x };
		mockColumns[2] = { type: 'number', getData: () => y };
		mockColumns[10] = xColOut;
		mockColumns[20] = yColOut;

		await trendfit({
			xIN: 1,
			yIN: 2,
			model: 'linear',
			out: { trendx: 10, trendy_2: 20 },
			outputX: -1
		});

		expect(xColOut.type).toBe('number');
	});
});

describe('trendfit metric outputs (one value per y, in yIN order)', () => {
	function metricCol() {
		return { data: null, type: null, tableProcessGUId: null };
	}

	it('linear: writes r2, rmse, coef_slope, coef_intercept', async () => {
		const x = [0, 1, 2, 3, 4, 5];
		mockColumns[1] = { type: 'number', getData: () => x };
		mockColumns[2] = { type: 'number', getData: () => x.map((xi) => 2 * xi + 1) };
		mockColumns[3] = { type: 'number', getData: () => x.map((xi) => -0.5 * xi + 4) };
		for (const id of [10, 20, 21, 30, 31, 32, 33]) mockColumns[id] = metricCol();

		const [, valid] = await trendfit({
			xIN: 1,
			yIN: [2, 3],
			model: 'linear',
			out: {
				trendx: 10,
				trendy_2: 20,
				trendy_3: 21,
				r2: 30,
				rmse: 31,
				coef_slope: 32,
				coef_intercept: 33
			},
			outputX: -1
		});

		expect(valid).toBe(true);
		expect(writtenRawData.get(30)).toHaveLength(2);
		expect(writtenRawData.get(31)).toHaveLength(2);
		const slopes = writtenRawData.get(32);
		const intercepts = writtenRawData.get(33);
		expect(slopes[0]).toBeCloseTo(2, 6);
		expect(slopes[1]).toBeCloseTo(-0.5, 6);
		expect(intercepts[0]).toBeCloseTo(1, 6);
		expect(intercepts[1]).toBeCloseTo(4, 6);
	});

	it('polynomial: writes coef_c0..cN in x^i order', async () => {
		const x = [0, 1, 2, 3, 4];
		mockColumns[1] = { type: 'number', getData: () => x };
		mockColumns[2] = { type: 'number', getData: () => x.map((xi) => 3 + xi * xi) };
		for (const id of [10, 20, 40, 41, 42]) mockColumns[id] = metricCol();

		await trendfit({
			xIN: 1,
			yIN: [2],
			model: 'polynomial',
			polyDegree: 2,
			out: { trendx: 10, trendy_2: 20, coef_c0: 40, coef_c1: 41, coef_c2: 42 },
			outputX: -1
		});

		expect(writtenRawData.get(40)[0]).toBeCloseTo(3, 3);
		expect(writtenRawData.get(41)[0]).toBeCloseTo(0, 3);
		expect(writtenRawData.get(42)[0]).toBeCloseTo(1, 3);
	});

	it('skips unwired metric ports without throwing', async () => {
		const x = [0, 1, 2];
		mockColumns[1] = { type: 'number', getData: () => x };
		mockColumns[2] = { type: 'number', getData: () => [1, 2, 3] };
		mockColumns[10] = metricCol();

		const [, valid] = await trendfit({
			xIN: 1,
			yIN: [2],
			model: 'linear',
			out: { trendx: 10 },
			outputX: -1
		});
		expect(valid).toBe(true);
	});
});

describe('trendfit — R² through the node data-prep path', () => {
	// Through the REAL node func (not the pure util): a 'number' column's data is
	// handed through verbatim, so numeric strings reach the fit. This used to make
	// the exponential/polynomial R² exactly 0 while the fitted curve, the
	// coefficients and the RMSE were all correct — see utils/trendfit.js.
	const x = Array.from({ length: 30 }, (_, i) => i + 1);
	const yNum = x.map((xi) => 2 * Math.exp(0.1 * xi));

	async function fitWith(values, model) {
		mockColumns[1] = { type: 'number', getData: () => x };
		mockColumns[2] = { type: 'number', getData: () => values };
		const [result] = await trendfit({
			xIN: 1,
			yIN: [2],
			model,
			polyDegree: 2,
			out: preview,
			outputX: -1
		});
		return result.y_results[2].fittedData;
	}

	for (const model of ['exponential', 'polynomial']) {
		it(`${model}: string column values give the same R² as numeric ones`, async () => {
			const num = await fitWith(yNum, model);
			const str = await fitWith(yNum.map(String), model);
			expect(str.rSquared).not.toBe(0);
			expect(str.rSquared).toBeCloseTo(num.rSquared, 10);
			expect(str.rSquared).toBeGreaterThan(0.9);
		});
	}
});

describe('getCoefKeys', () => {
	it('maps model → metric coefficient keys', async () => {
		const { getCoefKeys } = await import('./TrendFit.svelte');
		expect(getCoefKeys({ model: 'linear' })).toEqual(['coef_slope', 'coef_intercept']);
		expect(getCoefKeys({ model: 'exponential' })).toEqual(['coef_a', 'coef_b']);
		expect(getCoefKeys({ model: 'logarithmic' })).toEqual(['coef_a', 'coef_b']);
		expect(getCoefKeys({ model: 'polynomial', polyDegree: 3 })).toEqual([
			'coef_c0',
			'coef_c1',
			'coef_c2',
			'coef_c3'
		]);
	});
});

describe('permutation settings persist with the session', () => {
	// The permutation controls used to be component-local `$state` with a seed of
	// Math.random(), so a saved session came back with a DIFFERENT seed and
	// therefore a different p-value. They now live in the node's `defaults` map,
	// which is what buildTableProcessDefaults() reads when a node is spawned and
	// what TableProcess.toJSON() writes out verbatim.
	async function nodeDefaults() {
		const { definition } = await import('./TrendFit.svelte');
		const { buildTableProcessDefaults } = await import('$lib/core/tpDefaults.js');
		return buildTableProcessDefaults(definition);
	}

	it('a freshly spawned node carries the permutation params in its args', async () => {
		const { PERMUTATION_DEFAULTS } = await import('$lib/utils/fitFunction.js');
		const args = await nodeDefaults();
		expect(args.permuteTest).toBe(PERMUTATION_DEFAULTS.permuteTest);
		expect(args.autoPermutations).toBe(false);
		expect(args.nPermutations).toBe(PERMUTATION_DEFAULTS.nPermutations);
		expect(args.permutationSeed).toBe(PERMUTATION_DEFAULTS.permutationSeed);
		expect(args.permutationStatistic).toBe(PERMUTATION_DEFAULTS.permutationStatistic);
	});

	it('the seed is a fixed default, not randomised per node', async () => {
		const a = await nodeDefaults();
		const b = await nodeDefaults();
		expect(a.permutationSeed).toBe(b.permutationSeed);
		expect(Number.isFinite(a.permutationSeed)).toBe(true);
	});

	it('survives the save/load round trip, including seed 0', async () => {
		const { applyPermutationDefaults } = await import('./TrendFit.svelte');
		const args = await nodeDefaults();
		// A user configures the test and saves.
		args.permuteTest = true;
		args.autoPermutations = true;
		args.nPermutations = 199;
		args.permutationSeed = 0; // 0 is a legal seed — a `||` guard would eat it
		args.permutationStatistic = 'rmse';

		// Exactly what TableProcess.toJSON() persists, through a real JSON round trip.
		const saved = JSON.parse(JSON.stringify({ id: 3, name: 'TrendFit', args }));
		// ...and what the component does to the loaded args on mount.
		const loaded = applyPermutationDefaults(saved.args);

		expect(loaded.permutationSeed).toBe(0);
		expect(loaded.permuteTest).toBe(true);
		expect(loaded.autoPermutations).toBe(true);
		expect(loaded.nPermutations).toBe(199);
		expect(loaded.permutationStatistic).toBe('rmse');
	});

	it('backfills a pre-existing session that has no permutation keys, without touching set ones', async () => {
		const { applyPermutationDefaults } = await import('./TrendFit.svelte');
		const { PERMUTATION_DEFAULTS } = await import('$lib/utils/fitFunction.js');
		const old = { xIN: 1, yIN: [2], model: 'linear', permutationSeed: 0, permuteTest: false };
		applyPermutationDefaults(old);
		expect(old.permutationSeed).toBe(0);
		expect(old.permuteTest).toBe(false);
		expect(old.nPermutations).toBe(PERMUTATION_DEFAULTS.nPermutations);
		expect(old.permutationStatistic).toBe(PERMUTATION_DEFAULTS.permutationStatistic);
		expect(old.autoPermutations).toBe(false);
	});

	it('the component no longer generates a random seed', async () => {
		const { readFileSync } = await import('node:fs');
		// import.meta.url is not a file: URL under this suite's environment, so
		// resolve from the repo root (vitest's cwd) instead.
		const src = readFileSync('src/lib/tableProcesses/TrendFit.svelte', 'utf8');
		expect(src).not.toMatch(/Math\.random/);
		// And the settings are read off args, not local state.
		expect(src).toMatch(/seed: p\.args\.permutationSeed/);
	});
});
