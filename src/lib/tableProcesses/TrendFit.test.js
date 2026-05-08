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

describe('trendfit', () => {
	it('returns invalid when inputs are -1', () => {
		const [, valid] = trendfit({ xIN: -1, yIN: -1, model: 'linear', out: preview, outputX: -1 });
		expect(valid).toBe(false);
	});

	it('fits a linear model and returns fitted values', () => {
		const x = [0, 1, 2, 3, 4, 5];
		const y = x.map((xi) => 2 * xi + 1);
		mockColumns[1] = { type: 'number', getData: () => x };
		mockColumns[2] = { type: 'number', getData: () => y };
		const [result, valid] = trendfit({
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

	it('fits a polynomial model', () => {
		const x = [0, 1, 2, 3, 4];
		const y = x.map((xi) => xi * xi);
		mockColumns[1] = { type: 'number', getData: () => x };
		mockColumns[2] = { type: 'number', getData: () => y };
		const [result, valid] = trendfit({
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

	it('time x in → time x out: writes ms timestamps and types the output column as "time"', () => {
		const t0 = Date.UTC(2026, 3, 30); // 2026-04-30 00:00:00 UTC
		const ms = [0, 3, 6, 9, 12].map((h) => t0 + h * 3_600_000);
		const y = [1, 2, 3, 4, 5];
		const xColOut = { data: null, type: null, tableProcessGUId: null, timeFormat: 'YYYY' };
		const yColOut = { data: null, type: null, tableProcessGUId: null };
		mockColumns[1] = { type: 'time', getData: () => ms, hoursSinceStart: [0, 3, 6, 9, 12] };
		mockColumns[2] = { type: 'number', getData: () => y };
		mockColumns[10] = xColOut;
		mockColumns[20] = yColOut;

		trendfit({
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

	it('number x in → number x out: writes raw values and keeps the output column "number"', () => {
		const x = [0, 1, 2, 3, 4];
		const y = [1, 2, 3, 4, 5];
		const xColOut = { data: null, type: null, tableProcessGUId: null };
		const yColOut = { data: null, type: null, tableProcessGUId: null };
		mockColumns[1] = { type: 'number', getData: () => x };
		mockColumns[2] = { type: 'number', getData: () => y };
		mockColumns[10] = xColOut;
		mockColumns[20] = yColOut;

		trendfit({
			xIN: 1,
			yIN: 2,
			model: 'linear',
			out: { trendx: 10, trendy_2: 20 },
			outputX: -1
		});

		expect(xColOut.type).toBe('number');
	});
});
