import { describe, it, expect } from 'vitest';
import { estimateFreeRunningPeriod } from './freeRunningPeriod.js';

// Build `days` of hourly samples of a clean sinusoid at `period` hours.
function makeRhythm(period, days = 12, amp = 40, base = 50) {
	const t = [];
	const y = [];
	const n = days * 24;
	for (let i = 0; i < n; i++) {
		t.push(i);
		y.push(base + amp * Math.sin((2 * Math.PI * i) / period));
	}
	return { t, y };
}

describe('estimateFreeRunningPeriod', () => {
	it('recovers a known free-running period (chi-squared)', () => {
		const { t, y } = makeRhythm(25, 14);
		const r = estimateFreeRunningPeriod(t, y, {
			pMin: 20,
			pMax: 30,
			step: 0.1,
			binSize: 1
		});
		expect(r.period).toBeGreaterThan(24.4);
		expect(r.period).toBeLessThan(25.6);
		expect(Number.isFinite(r.power)).toBe(true);
		expect(r.power).toBeGreaterThan(0);
		// Chi-squared exposes an analytic p-value; a strong rhythm is highly significant.
		expect(Number.isFinite(r.pValue)).toBe(true);
		expect(r.pValue).toBeLessThan(0.05);
	});

	it('recovers a known period near the classic circadian value', () => {
		const { t, y } = makeRhythm(24, 14);
		const r = estimateFreeRunningPeriod(t, y, { pMin: 20, pMax: 28, step: 0.1, binSize: 1 });
		expect(r.period).toBeGreaterThan(23.4);
		expect(r.period).toBeLessThan(24.6);
	});

	it('also works with the Lomb-Scargle method (no analytic p-value)', () => {
		const { t, y } = makeRhythm(25, 14);
		const r = estimateFreeRunningPeriod(t, y, {
			pMin: 20,
			pMax: 30,
			step: 0.1,
			method: 'Lomb-Scargle'
		});
		expect(r.period).toBeGreaterThan(24.5);
		expect(r.period).toBeLessThan(25.5);
		expect(Number.isFinite(r.power)).toBe(true);
		// Lomb-Scargle has no analytic significance line here → NaN by design.
		expect(Number.isNaN(r.pValue)).toBe(true);
	});

	it('is robust to interspersed NaN / null samples', () => {
		const { t, y } = makeRhythm(25, 14);
		// Punch holes: every 13th sample is missing.
		for (let i = 0; i < y.length; i += 13) y[i] = NaN;
		y[5] = null;
		t[9] = null;
		const r = estimateFreeRunningPeriod(t, y, { pMin: 20, pMax: 30, step: 0.1, binSize: 1 });
		expect(r.period).toBeGreaterThan(24.2);
		expect(r.period).toBeLessThan(25.8);
	});

	it('returns NaNs for empty input', () => {
		const r = estimateFreeRunningPeriod([], []);
		expect(Number.isNaN(r.period)).toBe(true);
		expect(Number.isNaN(r.power)).toBe(true);
		expect(Number.isNaN(r.pValue)).toBe(true);
	});

	it('returns NaNs for fewer than 3 valid samples', () => {
		const r = estimateFreeRunningPeriod([0, 1], [1, 2]);
		expect(Number.isNaN(r.period)).toBe(true);
	});

	it('returns NaNs for a degenerate window (pMax <= pMin or step <= 0)', () => {
		const { t, y } = makeRhythm(25, 5);
		expect(Number.isNaN(estimateFreeRunningPeriod(t, y, { pMin: 28, pMax: 20 }).period)).toBe(true);
		expect(
			Number.isNaN(estimateFreeRunningPeriod(t, y, { pMin: 20, pMax: 28, step: 0 }).period)
		).toBe(true);
	});

	it('returns NaNs when handed non-array inputs', () => {
		expect(Number.isNaN(estimateFreeRunningPeriod(null, null).period)).toBe(true);
		expect(Number.isNaN(estimateFreeRunningPeriod(undefined, [1, 2, 3]).period)).toBe(true);
	});

	it('handles a flat (zero-variance) series without throwing', () => {
		const t = Array.from({ length: 240 }, (_, i) => i);
		const y = new Array(240).fill(7);
		const r = estimateFreeRunningPeriod(t, y, { pMin: 20, pMax: 28, step: 0.1, binSize: 1 });
		// No rhythm → power is either NaN or a finite non-informative value, but the
		// call must not throw and must return the documented shape.
		expect(r).toHaveProperty('period');
		expect(r).toHaveProperty('power');
		expect(r).toHaveProperty('pValue');
	});
});
