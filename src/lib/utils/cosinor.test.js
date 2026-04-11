import { describe, it, expect } from 'vitest';
import { fitCosineCurves, evaluateCosinorAtPoints, fitCosinorFixed } from './cosinor.js';

// Synthetic: y = 2*cos(2π/24 * t + 0.5) + 5
// amplitude=2, period=24h, phase=0.5 rad, offset=5
function syntheticData(step = 0.5, duration = 96) {
	const t = [];
	const y = [];
	for (let ti = 0; ti <= duration; ti += step) {
		t.push(ti);
		y.push(2 * Math.cos((2 * Math.PI * ti) / 24 + 0.5) + 5);
	}
	return { t, y };
}

describe('fitCosineCurves', () => {
	it('recovers amplitude within 5% for synthetic 24h signal', () => {
		const { t, y } = syntheticData();
		const result = fitCosineCurves(t, y, 1);
		const amp = result.parameters.cosines[0].amplitude;
		expect(Math.abs(amp - 2.0) / 2.0).toBeLessThan(0.05);
	});

	it('recovers period within 1%', () => {
		const { t, y } = syntheticData();
		const result = fitCosineCurves(t, y, 1);
		// frequency = 2π/period  →  period = 2π/frequency
		const freq = result.parameters.cosines[0].frequency;
		const recoveredPeriod = (2 * Math.PI) / freq;
		expect(Math.abs(recoveredPeriod - 24) / 24).toBeLessThan(0.01);
	});

	it('achieves R² > 0.99 for clean synthetic data', () => {
		const { t, y } = syntheticData();
		const result = fitCosineCurves(t, y, 1);
		expect(result.rSquared).toBeGreaterThan(0.99);
	});

	it('throws if t and x have different lengths', () => {
		expect(() => fitCosineCurves([1, 2, 3], [1, 2], 1)).toThrow();
	});
});

describe('evaluateCosinorAtPoints', () => {
	it('evaluates fitted model at known points', () => {
		const { t, y } = syntheticData();
		const result = fitCosineCurves(t, y, 1);
		const pts = [0, 6, 12, 24];
		const predicted = evaluateCosinorAtPoints(result.parameters, pts);

		expect(predicted).toHaveLength(4);
		// Each predicted value should be close to the true value
		for (let i = 0; i < pts.length; i++) {
			const trueVal = 2 * Math.cos((2 * Math.PI * pts[i]) / 24 + 0.5) + 5;
			expect(predicted[i]).toBeCloseTo(trueVal, 1);
		}
	});
});

describe('fitCosinorFixed', () => {
	it('recovers mesor ≈ 5 for synthetic data', () => {
		const { t, y } = syntheticData();
		const result = fitCosinorFixed(t, y, 24, 1);
		expect(result).not.toBeNull();
		expect(result.M).toBeCloseTo(5, 1);
	});

	it('recovers amplitude ≈ 2', () => {
		const { t, y } = syntheticData();
		const result = fitCosinorFixed(t, y, 24, 1);
		expect(result.harmonics[0].amplitude).toBeCloseTo(2, 1);
	});

	it('achieves R² > 0.99', () => {
		const { t, y } = syntheticData();
		const result = fitCosinorFixed(t, y, 24, 1);
		expect(result.R2).toBeGreaterThan(0.99);
	});

	it('returns null when there are insufficient degrees of freedom', () => {
		// 3 params (mesor + 2 harmonic coeffs), need > 3 observations
		const result = fitCosinorFixed([0, 1, 2], [1, 2, 1], 24, 1);
		expect(result).toBeNull();
	});

	it('F-stat p-value is significant for strong rhythmic signal', () => {
		const { t, y } = syntheticData();
		const result = fitCosinorFixed(t, y, 24, 1);
		// pF is upper-tail: small value = significant
		expect(result.pF).toBeLessThan(0.001);
	});
});
