import { describe, it, expect } from 'vitest';
import { fitRectangularWave, evaluateRectWaveAtPoints } from './rectwave.js';

// A clean square wave: period 24h, duty 0.5, mesor 0, half-amplitude 1.
function squareWave(durationH = 120, stepH = 0.5, periodH = 24, duty = 0.5) {
	const t = [];
	const x = [];
	for (let ti = 0; ti <= durationH; ti += stepH) {
		t.push(ti);
		const phase = ((ti % periodH) + periodH) % periodH;
		x.push(phase < duty * periodH ? 1 : -1);
	}
	return { t, x };
}

describe('fitRectangularWave — recovery of a clean square wave', () => {
	const { t, x } = squareWave();
	const result = fitRectangularWave(t, x, { numStarts: 5 });

	it('returns a result object', () => {
		expect(result).not.toBeNull();
	});

	it('recovers the 24h period within a few percent', () => {
		expect(result.period).toBeGreaterThan(23);
		expect(result.period).toBeLessThan(25);
	});

	it('recovers a duty cycle near 0.5', () => {
		expect(result.parameters.dutyCycle).toBeCloseTo(0.5, 1);
	});

	it('achieves a near-perfect fit (R² > 0.99)', () => {
		expect(result.rSquared).toBeGreaterThan(0.99);
	});

	it('reports an acrophase inside one period', () => {
		expect(result.acrophase).toBeGreaterThanOrEqual(0);
		expect(result.acrophase).toBeLessThan(result.period);
	});

	it('rmse and rss are non-negative and consistent', () => {
		expect(result.rmse).toBeGreaterThanOrEqual(0);
		expect(result.rss).toBeGreaterThanOrEqual(0);
		// rmse = sqrt(rss / n)
		expect(result.rmse).toBeCloseTo(Math.sqrt(result.rss / t.length), 6);
	});
});

describe('fitRectangularWave — fixed parameters', () => {
	it('respects a fixed period (ω pinned)', () => {
		const { t, x } = squareWave();
		const fixedPeriod = 24;
		const fixedOmega = (2 * Math.PI) / fixedPeriod;
		const result = fitRectangularWave(t, x, {
			fixOmega: true,
			fixedOmega,
			numStarts: 3
		});
		expect(result).not.toBeNull();
		expect(result.parameters.omega).toBeCloseTo(fixedOmega, 8);
		expect(result.period).toBeCloseTo(fixedPeriod, 6);
	});

	it('respects a fixed duty cycle', () => {
		const { t, x } = squareWave(120, 0.5, 24, 0.5);
		const result = fitRectangularWave(t, x, {
			fixDutyCycle: true,
			fixedDutyCycle: 0.5,
			numStarts: 3
		});
		expect(result).not.toBeNull();
		expect(result.parameters.dutyCycle).toBeCloseTo(0.5, 6);
	});
});

describe('fitRectangularWave — input validation', () => {
	it('throws when t and x lengths differ', () => {
		expect(() => fitRectangularWave([0, 1, 2], [0, 1])).toThrow();
	});
});

describe('evaluateRectWaveAtPoints', () => {
	it('reproduces the model values at the fitted time points', () => {
		const { t, x } = squareWave(72, 0.5);
		const result = fitRectangularWave(t, x, { numStarts: 5 });
		const reEval = evaluateRectWaveAtPoints(result.parameters, t);
		for (let i = 0; i < t.length; i++) {
			expect(reEval[i]).toBeCloseTo(result.fitted[i], 8);
		}
	});

	it('is bounded by M ± |A| for a tanh-based model', () => {
		const params = { M: 0, A: 1, kappa: 5, omega: (2 * Math.PI) / 24, phi: 0, dutyCycle: 0.5 };
		const out = evaluateRectWaveAtPoints(params, [0, 3, 6, 9, 12, 15, 18, 21]);
		for (const v of out) {
			expect(v).toBeGreaterThanOrEqual(-1.0000001);
			expect(v).toBeLessThanOrEqual(1.0000001);
		}
	});
});

// REPORTED (2026-10-28): on a flat series (y = 5) the free-period fit reported RMSE 0.852, not
// about 0. Every start began at the shortest period (2 samples) with the samples on the sine's
// peaks, so omega and phi had no effect (JtJ diagonal ~1e-30 of the largest). Marquardt's
// diagonal-scaled damping then gave those columns no damping, every step was singular, and
// each start was given up at its seed (A = 1). Such columns now get plain damping.
describe('fitRectangularWave on a flat series', () => {
	for (const [n, dt] of [
		[169, 1],
		[50, 0.5]
	]) {
		it(`fits the flat line (n = ${n}, every ${dt} h, free period)`, () => {
			const t = Array.from({ length: n }, (_, i) => i * dt);
			const r = fitRectangularWave(
				t,
				t.map(() => 5)
			);
			expect(r.rmse).toBeLessThan(1e-6);
			expect(Math.abs(r.parameters.A)).toBeLessThan(1e-4);
			expect(r.parameters.M).toBeCloseTo(5, 6);
		});
	}
	it('and with the period fixed (already right; pinned)', () => {
		const t = Array.from({ length: 169 }, (_, i) => i);
		const r = fitRectangularWave(
			t,
			t.map(() => 5),
			{ fixOmega: true, fixedOmega: (2 * Math.PI) / 24 }
		);
		expect(r.rmse).toBeLessThan(1e-6);
	});
});
