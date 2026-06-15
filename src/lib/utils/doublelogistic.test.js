import { describe, it, expect } from 'vitest';
import { fitDoubleLogistic, evaluateDoubleLogisticAtPoints } from './doublelogistic.js';

// A single rise-then-fall pulse for the non-periodic model.
function singlePulse(durationH = 48, stepH = 0.5, riseAt = 12, fallAt = 30) {
	const t = [];
	const x = [];
	for (let ti = 0; ti <= durationH; ti += stepH) {
		t.push(ti);
		// smooth-ish pulse: 1 between rise and fall, 0 elsewhere
		x.push(ti > riseAt && ti < fallAt ? 1 : 0);
	}
	return { t, x };
}

// A periodic pulse train: active 6h–14h each 24h cycle.
function periodicPulse(durationH = 96, stepH = 0.5, periodH = 24, onAt = 6, offAt = 14) {
	const t = [];
	const x = [];
	for (let ti = 0; ti <= durationH; ti += stepH) {
		t.push(ti);
		const phase = ((ti % periodH) + periodH) % periodH;
		x.push(phase > onAt && phase < offAt ? 1 : 0);
	}
	return { t, x };
}

describe('fitDoubleLogistic — non-periodic single pulse', () => {
	const { t, x } = singlePulse();
	const result = fitDoubleLogistic(t, x, { periodic: false, numStarts: 5 });

	it('returns a result object', () => {
		expect(result).not.toBeNull();
	});

	it('achieves a good fit (R² > 0.95)', () => {
		expect(result.rSquared).toBeGreaterThan(0.95);
	});

	it('places the fall inflection after the rise inflection (t2 > t1)', () => {
		expect(result.parameters.t2).toBeGreaterThan(result.parameters.t1);
	});

	it('estimates a positive pulse duration', () => {
		expect(result.duration).toBeGreaterThan(0);
		expect(result.duration).toBeCloseTo(result.parameters.t2 - result.parameters.t1, 8);
	});

	it('does not report periodic-only fields for the non-periodic model', () => {
		expect(result.parameters.T).toBeNull();
		expect(result.onsetPhase).toBeNull();
		expect(result.dutyCycle).toBeNull();
	});
});

describe('fitDoubleLogistic — periodic pulse train', () => {
	const { t, x } = periodicPulse();
	const result = fitDoubleLogistic(t, x, { periodic: true, numStarts: 5 });

	it('returns a result object', () => {
		expect(result).not.toBeNull();
	});

	it('achieves a good fit (R² > 0.95)', () => {
		expect(result.rSquared).toBeGreaterThan(0.95);
	});

	it('recovers a period near 24h', () => {
		expect(result.parameters.T).toBeGreaterThan(22);
		expect(result.parameters.T).toBeLessThan(26);
	});

	it('reports onset/offset phases within one cycle', () => {
		const T = result.parameters.T;
		expect(result.onsetPhase).toBeGreaterThanOrEqual(0);
		expect(result.onsetPhase).toBeLessThan(T);
		expect(result.offsetPhase).toBeGreaterThanOrEqual(0);
		expect(result.offsetPhase).toBeLessThan(T);
	});

	it('reports a duty cycle in (0, 1)', () => {
		expect(result.dutyCycle).toBeGreaterThan(0);
		expect(result.dutyCycle).toBeLessThan(1);
	});

	it('recovers a duty cycle near the true 8/24 ≈ 0.33', () => {
		expect(result.dutyCycle).toBeCloseTo(8 / 24, 1);
	});
});

describe('fitDoubleLogistic — fixed parameters', () => {
	it('respects a fixed period', () => {
		const { t, x } = periodicPulse();
		const result = fitDoubleLogistic(t, x, {
			periodic: true,
			fixPeriod: true,
			fixedPeriod: 24,
			numStarts: 3
		});
		expect(result).not.toBeNull();
		expect(result.parameters.T).toBeCloseTo(24, 6);
	});

	it('respects fixed rise/fall rates', () => {
		const { t, x } = singlePulse();
		const result = fitDoubleLogistic(t, x, {
			periodic: false,
			fixK1: true,
			fixedK1: 1,
			fixK2: true,
			fixedK2: 1,
			numStarts: 3
		});
		expect(result).not.toBeNull();
		expect(result.parameters.k1).toBeCloseTo(1, 6);
		expect(result.parameters.k2).toBeCloseTo(1, 6);
	});
});

describe('fitDoubleLogistic — input validation', () => {
	it('throws when t and x lengths differ', () => {
		expect(() => fitDoubleLogistic([0, 1, 2], [0, 1])).toThrow();
	});
});

describe('evaluateDoubleLogisticAtPoints', () => {
	it('reproduces the fitted values for the non-periodic model', () => {
		const { t, x } = singlePulse(36, 0.5);
		const result = fitDoubleLogistic(t, x, { periodic: false, numStarts: 5 });
		const reEval = evaluateDoubleLogisticAtPoints(result.parameters, false, t);
		for (let i = 0; i < t.length; i++) {
			expect(reEval[i]).toBeCloseTo(result.fitted[i], 6);
		}
	});

	it('reproduces the fitted values for the periodic model', () => {
		const { t, x } = periodicPulse(72, 0.5);
		const result = fitDoubleLogistic(t, x, { periodic: true, numStarts: 5 });
		const reEval = evaluateDoubleLogisticAtPoints(result.parameters, true, t);
		for (let i = 0; i < t.length; i++) {
			expect(reEval[i]).toBeCloseTo(result.fitted[i], 6);
		}
	});
});
