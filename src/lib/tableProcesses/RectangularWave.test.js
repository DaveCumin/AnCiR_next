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

vi.mock('$lib/utils/rectwave.js', () => ({
	fitRectangularWave: vi.fn((tt, yy, opts) => {
		// Mock rectangular wave fit result
		// When fixOmega is true, fixedOmega is passed (angular frequency)
		// Otherwise use default period of 24
		let period = 24;
		if (opts.fixOmega && opts.fixedOmega) {
			period = (2 * Math.PI) / opts.fixedOmega;
		}
		return {
			fitted: yy.map((v) => v + 0.1),
			parameters: {
				period: period,
				acrophase: 12,
				dutyCycle: opts.fixedDutyCycle || 0.5,
				kappa: opts.fixedKappa || 5,
				M: 50,
				A: 25
			},
			rmse: 0.5,
			rSquared: 0.95
		};
	}),
	evaluateRectWaveAtPoints: vi.fn((params, points) => {
		// Mock evaluation at points
		return points.map(
			(p) => params.M + params.A * Math.cos((2 * Math.PI * (p - params.acrophase)) / params.period)
		);
	})
}));

import { rectangularwave } from './RectangularWave.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
});

describe('rectangularwave', () => {
	it('returns invalid when xIN is -1', () => {
		const [, valid] = rectangularwave({
			xIN: -1,
			yIN: [1],
			outputX: -1,
			out: { rectwavex: -1 }
		});
		expect(valid).toBe(false);
	});

	it('returns invalid when yIN is empty', () => {
		mockColumns[1] = { type: 'number', getData: () => [1, 2, 3], hoursSinceStart: [0, 1, 2] };

		const [, valid] = rectangularwave({
			xIN: 1,
			yIN: [],
			outputX: -1,
			out: { rectwavex: -1 }
		});
		expect(valid).toBe(false);
	});

	it('returns invalid when xIN column does not exist', () => {
		const [, valid] = rectangularwave({
			xIN: 999,
			yIN: [1],
			outputX: -1,
			out: { rectwavex: -1 }
		});
		expect(valid).toBe(false);
	});

	it('fits a rectangular wave to simple numeric data', () => {
		const t = [0, 6, 12, 18, 24, 30, 36, 42];
		const y = [50, 75, 50, 25, 50, 75, 50, 25];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = rectangularwave({
			xIN: 1,
			yIN: [2],
			outputX: -1,
			fixKappa: false,
			fixedKappa: 5,
			fixOmega: false,
			fixedPeriod: 24,
			fixDutyCycle: false,
			fixedDutyCycle: 0.5,
			out: { rectwavex: -1, rectwavey_2: -1 }
		});

		expect(valid).toBe(true);
		expect(result.y_results[2]).toBeDefined();
		expect(result.y_results[2].fitted).toBeDefined();
		expect(result.y_results[2].t).toEqual(t);
	});

	it('skips data points with NaN values', () => {
		const t = [0, 6, 12, 18, 24];
		const y = [50, NaN, 50, 25, 75];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = rectangularwave({
			xIN: 1,
			yIN: [2],
			outputX: -1,
			out: { rectwavex: -1, rectwavey_2: -1 }
		});

		expect(valid).toBe(true);
		// Should have filtered out the NaN point
		expect(result.y_results[2].t.length).toBe(4);
	});

	it('returns invalid when insufficient valid data points', () => {
		const t = [0, 6, 12]; // Only 3 points, but need at least 4
		const y = [50, 75, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [, valid] = rectangularwave({
			xIN: 1,
			yIN: [2],
			outputX: -1,
			out: { rectwavex: -1, rectwavey_2: -1 }
		});

		expect(valid).toBe(false);
	});

	it('handles multiple Y columns', () => {
		const t = [0, 6, 12, 18, 24];
		const y1 = [50, 75, 50, 25, 50];
		const y2 = [60, 80, 60, 40, 60];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y1 };
		mockColumns[3] = { type: 'number', getData: () => y2 };

		const [result, valid] = rectangularwave({
			xIN: 1,
			yIN: [2, 3],
			outputX: -1,
			out: { rectwavex: -1, rectwavey_2: -1, rectwavey_3: -1 }
		});

		expect(valid).toBe(true);
		expect(result.y_results[2]).toBeDefined();
		expect(result.y_results[3]).toBeDefined();
	});

	it('uses fixed period when fixOmega is true', () => {
		const t = [0, 6, 12, 18, 24];
		const y = [50, 75, 50, 25, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = rectangularwave({
			xIN: 1,
			yIN: [2],
			outputX: -1,
			fixOmega: true,
			fixedPeriod: 12,
			out: { rectwavex: -1, rectwavey_2: -1 }
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].fitResult.parameters.period).toBe(12);
	});

	it('uses fixed duty cycle when fixDutyCycle is true', () => {
		const t = [0, 6, 12, 18, 24];
		const y = [50, 75, 50, 25, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = rectangularwave({
			xIN: 1,
			yIN: [2],
			outputX: -1,
			fixDutyCycle: true,
			fixedDutyCycle: 0.75,
			out: { rectwavex: -1, rectwavey_2: -1 }
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].fitResult.parameters.dutyCycle).toBe(0.75);
	});

	it('uses fixed kappa (sharpness) when fixKappa is true', () => {
		const t = [0, 6, 12, 18, 24];
		const y = [50, 75, 50, 25, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = rectangularwave({
			xIN: 1,
			yIN: [2],
			outputX: -1,
			fixKappa: true,
			fixedKappa: 3,
			out: { rectwavex: -1, rectwavey_2: -1 }
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].fitResult.parameters.kappa).toBe(3);
	});

	it('evaluates at specified output X points when provided', () => {
		const t = [0, 6, 12, 18, 24];
		const y = [50, 75, 50, 25, 50];
		const outputX = [0, 3, 6, 9, 12];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };
		mockColumns[3] = { type: 'number', getData: () => outputX, hoursSinceStart: outputX };

		const [result, valid] = rectangularwave({
			xIN: 1,
			yIN: [2],
			outputX: 3,
			out: { rectwavex: -1, rectwavey_2: -1 }
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].xOutData).toEqual(outputX);
		expect(result.y_results[2].yOutData.length).toBe(outputX.length);
	});

	it('handles time columns by converting to hoursSinceStart', () => {
		const hoursSinceStart = [0, 6, 12, 18, 24];
		const y = [50, 75, 50, 25, 50];

		mockColumns[1] = {
			type: 'time',
			getData: () => [1000000, 1000001, 1000002, 1000003, 1000004],
			hoursSinceStart
		};
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = rectangularwave({
			xIN: 1,
			yIN: [2],
			outputX: -1,
			out: { rectwavex: -1, rectwavey_2: -1 }
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].t).toEqual(hoursSinceStart);
	});

	it('returns fitted data when no output X is specified', () => {
		const t = [0, 6, 12, 18, 24];
		const y = [50, 75, 50, 25, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };

		const [result, valid] = rectangularwave({
			xIN: 1,
			yIN: [2],
			outputX: -1,
			out: { rectwavex: -1, rectwavey_2: -1 }
		});

		expect(valid).toBe(true);
		expect(result.y_results[2].yOutData).toBeDefined();
	});

	it('stores result in t when processing first Y column', () => {
		const t = [0, 6, 12, 18, 24];
		const y1 = [50, 75, 50, 25, 50];
		const y2 = [60, 80, 60, 40, 60];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y1 };
		mockColumns[3] = { type: 'number', getData: () => y2 };

		const [result] = rectangularwave({
			xIN: 1,
			yIN: [2, 3],
			outputX: -1,
			out: { rectwavex: -1, rectwavey_2: -1, rectwavey_3: -1 }
		});

		expect(result.t).toEqual(t);
	});

	it('skips missing or invalid Y columns', () => {
		const t = [0, 6, 12, 18, 24];
		const y = [50, 75, 50, 25, 50];

		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { type: 'number', getData: () => y };
		// mockColumns[3] doesn't exist (null/undefined)

		const [result, valid] = rectangularwave({
			xIN: 1,
			yIN: [2, 3, 999],
			outputX: -1,
			out: { rectwavex: -1, rectwavey_2: -1, rectwavey_3: -1, rectwavey_999: -1 }
		});

		expect(valid).toBe(true);
		expect(result.y_results[2]).toBeDefined();
		expect(result.y_results[3]).toBeUndefined();
		expect(result.y_results[999]).toBeUndefined();
	});
});
