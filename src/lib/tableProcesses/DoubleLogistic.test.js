import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockColumns } = vi.hoisted(() => ({
	mockColumns: {}
}));

vi.mock('$lib/core/core.svelte', () => ({
	core: {
		rawData: {
			set: vi.fn(),
			delete: vi.fn(),
			has: vi.fn(),
			get: vi.fn()
		}
	}
}));

vi.mock('$lib/core/Column.svelte', () => ({
	getColumnById: (id) => mockColumns[id],
	removeColumn: vi.fn(),
	Column: class {
		constructor() {
			this.id = -1;
			this.name = '';
			this.type = 'number';
			this.data = -1;
		}
	}
}));

vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/ColumnSelector.svelte', () => ({ default: {} }));

vi.mock('$lib/utils/doublelogistic.js', () => ({
	fitDoubleLogistic: vi.fn((tt, yy, opts) => {
		// Mock double logistic fit result
		return {
			fitted: yy.map((v) => v + 0.05),
			parameters: {
				T: opts.fixedPeriod || 24,
				M: 50,
				A: 25,
				k1: opts.fixedK1 || 0.5,
				k2: opts.fixedK2 || 0.5,
				t1: 6,
				t2: 18
			},
			onsetPhase: 6,
			offsetPhase: 18,
			dutyCycle: 0.5,
			rmse: 0.3,
			rSquared: 0.96
		};
	}),
	evaluateDoubleLogisticAtPoints: vi.fn((params, periodic, points) => {
		// Mock evaluation at points
		return points.map((p) => params.M + params.A * Math.tanh((p - params.t1) * params.k1));
	})
}));

import { doublelogistic } from './DoubleLogistic.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
});

describe('doublelogistic', () => {
	it('returns invalid when xIN is -1', () => {
		const [result, valid] = doublelogistic({
			xIN: -1,
			yIN: [1],
			outputX: -1,
			out: { dlogx: -1 }
		});
		expect(valid).toBe(false);
		expect(result).toBeNull();
	});

	it('returns invalid when yIN is empty', () => {
		mockColumns[1] = { type: 'number', getData: () => [1, 2, 3], hoursSinceStart: [0, 1, 2] };

		const [result, valid] = doublelogistic({
			xIN: 1,
			yIN: [],
			outputX: -1,
			out: { dlogx: -1 }
		});
		expect(valid).toBe(false);
		expect(result).toBeNull();
	});

	it('returns invalid when xIN column does not exist', () => {
		const [result, valid] = doublelogistic({
			xIN: 999,
			yIN: [1],
			outputX: -1,
			out: { dlogx: -1 }
		});
		expect(valid).toBe(false);
		expect(result).toBeNull();
	});

	it('fits a double logistic curve to simple numeric data', () => {
		const t = [0, 6, 12, 18, 24, 30, 36, 42];
		const y = [25, 50, 75, 75, 75, 50, 25, 25];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = doublelogistic({
			xIN: 1,
			yIN: [2],
			outputX: -1,
			fixK1: false,
			fixedK1: 0.5,
			fixK2: false,
			fixedK2: 0.5,
			fixPeriod: false,
			fixedPeriod: 24,
			out: { dlogx: -1, dlogy_2: -1 }
		});

		expect(valid).toBe(true);
		expect(result.y_results[2]).toBeDefined();
		expect(result.y_results[2].fitted).toBeDefined();
		expect(result.y_results[2].t).toEqual(t);
	});

	it('skips data points with NaN values', () => {
		const t = [0, 6, 12, 18, 24];
		const y = [25, NaN, 75, 75, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = doublelogistic({
			xIN: 1,
			yIN: [2],
			outputX: -1,
			out: { dlogx: -1, dlogy_2: -1 }
		});

		expect(valid).toBe(true);
		// Should have filtered out the NaN point
		expect(result.y_results[2].t.length).toBe(4);
	});

	it('returns invalid when insufficient valid data points', () => {
		const t = [0, 6, 12]; // Only 3 points, but need at least 4
		const y = [25, 75, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = doublelogistic({
			xIN: 1,
			yIN: [2],
			outputX: -1,
			out: { dlogx: -1, dlogy_2: -1 }
		});

		expect(valid).toBe(false);
		expect(result).toBeNull();
	});

	it('handles multiple Y columns', () => {
		const t = [0, 6, 12, 18, 24];
		const y1 = [25, 50, 75, 75, 50];
		const y2 = [30, 60, 80, 80, 55];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y1 };
		mockColumns[3] = { type: 'number', getData: () => y2 };

		const [result, valid] = doublelogistic({
			xIN: 1,
			yIN: [2, 3],
			outputX: -1,
			out: { dlogx: -1, dlogy_2: -1, dlogy_3: -1 }
		});

		expect(valid).toBe(true);
		expect(result.y_results[2]).toBeDefined();
		expect(result.y_results[3]).toBeDefined();
	});

	it('uses fixed period when fixPeriod is true', () => {
		const t = [0, 6, 12, 18, 24];
		const y = [25, 50, 75, 75, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = doublelogistic({
			xIN: 1,
			yIN: [2],
			outputX: -1,
			fixPeriod: true,
			fixedPeriod: 12,
			out: { dlogx: -1, dlogy_2: -1 }
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].fitResult.parameters.T).toBe(12);
	});

	it('uses fixed rise rate (k1) when fixK1 is true', () => {
		const t = [0, 6, 12, 18, 24];
		const y = [25, 50, 75, 75, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = doublelogistic({
			xIN: 1,
			yIN: [2],
			outputX: -1,
			fixK1: true,
			fixedK1: 0.3,
			out: { dlogx: -1, dlogy_2: -1 }
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].fitResult.parameters.k1).toBe(0.3);
	});

	it('uses fixed fall rate (k2) when fixK2 is true', () => {
		const t = [0, 6, 12, 18, 24];
		const y = [25, 50, 75, 75, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = doublelogistic({
			xIN: 1,
			yIN: [2],
			outputX: -1,
			fixK2: true,
			fixedK2: 0.35,
			out: { dlogx: -1, dlogy_2: -1 }
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].fitResult.parameters.k2).toBe(0.35);
	});

	it('evaluates at specified output X points when provided', () => {
		const t = [0, 6, 12, 18, 24];
		const y = [25, 50, 75, 75, 50];
		const outputX = [0, 3, 6, 9, 12];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };
		mockColumns[3] = { type: 'number', getData: () => outputX, hoursSinceStart: outputX };

		const [result, valid] = doublelogistic({
			xIN: 1,
			yIN: [2],
			outputX: 3,
			out: { dlogx: -1, dlogy_2: -1 }
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].xOutData).toEqual(outputX);
		expect(result.y_results[2].yOutData.length).toBe(outputX.length);
	});

	it('handles time columns by converting to hoursSinceStart', () => {
		const hoursSinceStart = [0, 6, 12, 18, 24];
		const y = [25, 50, 75, 75, 50];

		mockColumns[1] = {
			type: 'time',
			getData: () => [1000000, 1000001, 1000002, 1000003, 1000004],
			hoursSinceStart
		};
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = doublelogistic({
			xIN: 1,
			yIN: [2],
			outputX: -1,
			out: { dlogx: -1, dlogy_2: -1 }
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].t).toEqual(hoursSinceStart);
	});

	it('filters NaN values from output X data', () => {
		const t = [0, 6, 12, 18, 24];
		const y = [25, 50, 75, 75, 50];
		const outputX = [0, NaN, 6, 9, 12];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };
		mockColumns[3] = { type: 'number', getData: () => outputX, hoursSinceStart: outputX };

		const [result, valid] = doublelogistic({
			xIN: 1,
			yIN: [2],
			outputX: 3,
			out: { dlogx: -1, dlogy_2: -1 }
		});

		expect(valid).toBe(true);
		// NaN should be filtered from outputX
		expect(result.y_results[2].xOutData.includes(NaN)).toBe(false);
	});

	it('returns fitted data when no output X is specified', () => {
		const t = [0, 6, 12, 18, 24];
		const y = [25, 50, 75, 75, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = doublelogistic({
			xIN: 1,
			yIN: [2],
			outputX: -1,
			out: { dlogx: -1, dlogy_2: -1 }
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].yOutData).toBeDefined();
		expect(result.y_results[2].yOutData.length).toBeGreaterThan(0);
	});

	it('shares t across all Y columns from first valid one', () => {
		const t = [0, 6, 12, 18, 24];
		const y1 = [25, 50, 75, 75, 50];
		const y2 = [30, 60, 80, 80, 55];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y1 };
		mockColumns[3] = { type: 'number', getData: () => y2 };

		const [result] = doublelogistic({
			xIN: 1,
			yIN: [2, 3],
			outputX: -1,
			out: { dlogx: -1, dlogy_2: -1, dlogy_3: -1 }
		});

		expect(result.t).toEqual(t);
	});

	it('skips missing or invalid Y columns', () => {
		const t = [0, 6, 12, 18, 24];
		const y = [25, 50, 75, 75, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };
		// mockColumns[3] doesn't exist

		const [result, valid] = doublelogistic({
			xIN: 1,
			yIN: [2, 3, 999],
			outputX: -1,
			out: { dlogx: -1, dlogy_2: -1, dlogy_3: -1, dlogy_999: -1 }
		});

		expect(valid).toBe(true);
		expect(result.y_results[2]).toBeDefined();
		expect(result.y_results[3]).toBeUndefined();
		expect(result.y_results[999]).toBeUndefined();
	});

	it('returns null and invalid when no Y columns successfully fit', () => {
		const t = [0, 1]; // Too few points
		const y = [25, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = doublelogistic({
			xIN: 1,
			yIN: [2],
			outputX: -1,
			out: { dlogx: -1, dlogy_2: -1 }
		});

		expect(valid).toBe(false);
		expect(result).toBeNull();
	});

	it('handles periodic mode with fixed parameters', () => {
		const t = [0, 6, 12, 18, 24];
		const y = [25, 50, 75, 75, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = doublelogistic({
			xIN: 1,
			yIN: [2],
			outputX: -1,
			fixK1: true,
			fixedK1: 0.2,
			fixK2: true,
			fixedK2: 0.2,
			fixPeriod: true,
			fixedPeriod: 24,
			out: { dlogx: -1, dlogy_2: -1 }
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].fitResult.parameters.k1).toBe(0.2);
		expect(result.y_results[2].fitResult.parameters.k2).toBe(0.2);
		expect(result.y_results[2].fitResult.parameters.T).toBe(24);
	});
});
