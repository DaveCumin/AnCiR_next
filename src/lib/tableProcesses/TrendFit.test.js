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
