import { describe, it, expect, vi } from 'vitest';

// Mock binData — only the Chi-squared method uses it.
// Lomb-Scargle and Enright tests never call it.
vi.mock('$lib/components/plotbits/helpers/wrangleData.js', () => ({
	binData: vi.fn()
}));

import { runPeriodogramCalculation } from './periodogram.js';

// Helpers
function cosineTimeSeries(periodH, durationH, stepH) {
	const t = [];
	const y = [];
	for (let ti = 0; ti <= durationH; ti += stepH) {
		t.push(ti);
		y.push(Math.cos((2 * Math.PI * ti) / periodH));
	}
	return { t, y };
}

describe('runPeriodogramCalculation — Lomb-Scargle', () => {
	it('detects a pure 24-hour cosine signal', () => {
		const { t, y } = cosineTimeSeries(24, 96, 0.25);

		const result = runPeriodogramCalculation({
			method: 'Lomb-Scargle',
			xData: t,
			yData: y,
			periodMin: 18,
			periodMax: 30,
			periodSteps: 0.1
		});

		expect(result.x.length).toBeGreaterThan(0);

		// Find period with peak power
		const peakIdx = result.y.indexOf(Math.max(...result.y));
		const peakPeriod = result.x[peakIdx];

		expect(peakPeriod).toBeCloseTo(24, 0);
	});

	it('returns empty arrays when yData is null', () => {
		const result = runPeriodogramCalculation({
			method: 'Lomb-Scargle',
			xData: [0, 1, 2],
			yData: null,
			periodMin: 20,
			periodMax: 28,
			periodSteps: 1
		});
		expect(result.y).toEqual([]);
	});

	it('handles NaN values in the input gracefully', () => {
		const { t, y } = cosineTimeSeries(24, 96, 0.5);
		// Scatter some NaNs
		y[5] = NaN;
		y[20] = NaN;
		y[40] = NaN;

		const result = runPeriodogramCalculation({
			method: 'Lomb-Scargle',
			xData: t,
			yData: y,
			periodMin: 18,
			periodMax: 30,
			periodSteps: 0.5
		});

		// Should still return valid power values (no NaN in output)
		const hasNaN = result.y.some((v) => isNaN(v));
		expect(hasNaN).toBe(false);
	});

	it('returns x and y arrays of equal length', () => {
		const { t, y } = cosineTimeSeries(24, 48, 0.5);
		const result = runPeriodogramCalculation({
			method: 'Lomb-Scargle',
			xData: t,
			yData: y,
			periodMin: 20,
			periodMax: 28,
			periodSteps: 1
		});
		expect(result.x.length).toBe(result.y.length);
	});
});
