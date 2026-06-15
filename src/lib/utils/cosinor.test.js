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

	it('recovers the acrophase of a known cosine', () => {
		// y = 2·cos(2π/24·t + 0.5) + 5.  The classical acrophase φ = -0.5 rad
		// → acrophase_hrs = (-φ)·period/2π = 0.5·24/2π ≈ 1.91h.
		const { t, y } = syntheticData();
		const result = fitCosinorFixed(t, y, 24, 1);
		const expectedAcroHrs = (0.5 * 24) / (2 * Math.PI);
		expect(result.harmonics[0].acrophase_hrs).toBeCloseTo(expectedAcroHrs, 1);
	});

	it('acrophase is reported within [0, period)', () => {
		const { t, y } = syntheticData();
		const result = fitCosinorFixed(t, y, 24, 1);
		const acro = result.harmonics[0].acrophase_hrs;
		expect(acro).toBeGreaterThanOrEqual(0);
		expect(acro).toBeLessThan(24);
	});

	it('amplitude confidence interval brackets the true amplitude', () => {
		const { t, y } = syntheticData();
		const result = fitCosinorFixed(t, y, 24, 1);
		const [lo, hi] = result.harmonics[0].CI_A;
		expect(lo).toBeLessThanOrEqual(2);
		expect(hi).toBeGreaterThanOrEqual(2);
	});

	it('fitted array reproduces the model at the data points', () => {
		const { t, y } = syntheticData();
		const result = fitCosinorFixed(t, y, 24, 1);
		for (let i = 0; i < t.length; i++) {
			expect(result.fitted[i]).toBeCloseTo(y[i], 4);
		}
	});

	it('a flat (constant) signal yields R² = 0', () => {
		const t = Array.from({ length: 50 }, (_, i) => i);
		const y = new Array(50).fill(3);
		const result = fitCosinorFixed(t, y, 24, 1);
		expect(result).not.toBeNull();
		// SStot = 0 → R² short-circuits to 0
		expect(result.R2).toBe(0);
	});

	it('fits a two-harmonic model with R² > 0.99 on a two-harmonic signal', () => {
		const t = [];
		const y = [];
		for (let ti = 0; ti <= 96; ti += 0.25) {
			t.push(ti);
			const omega = (2 * Math.PI) / 24;
			y.push(
				10 + 2 * Math.cos(omega * ti + 0.3) + 1 * Math.cos(2 * omega * ti + 1.1)
			);
		}
		const result = fitCosinorFixed(t, y, 24, 2);
		expect(result).not.toBeNull();
		expect(result.harmonics).toHaveLength(2);
		expect(result.R2).toBeGreaterThan(0.99);
		expect(result.M).toBeCloseTo(10, 1);
	});
});

describe('fitCosineCurves — additional edge cases', () => {
	function syntheticData(step = 0.5, duration = 96) {
		const t = [];
		const y = [];
		for (let ti = 0; ti <= duration; ti += step) {
			t.push(ti);
			y.push(2 * Math.cos((2 * Math.PI * ti) / 24 + 0.5) + 5);
		}
		return { t, y };
	}

	it('throws if the provided initial guess has the wrong length', () => {
		const { t, y } = syntheticData();
		// N=1 needs 3N+1 = 4 params; give it 3.
		expect(() => fitCosineCurves(t, y, 1, { initialGuess: [1, 2, 3] })).toThrow();
	});

	it('recovers the offset (mesor) close to 5', () => {
		const { t, y } = syntheticData();
		const result = fitCosineCurves(t, y, 1);
		expect(result.parameters.O).toBeCloseTo(5, 0);
	});

	it('residuals are small and fitted+residuals reconstruct the data', () => {
		const { t, y } = syntheticData();
		const result = fitCosineCurves(t, y, 1);
		for (let i = 0; i < t.length; i++) {
			expect(result.fitted[i] + result.residuals[i]).toBeCloseTo(y[i], 8);
		}
	});

	it('a single-start fit (useMultiStart false) still converges on clean data', () => {
		const { t, y } = syntheticData();
		const result = fitCosineCurves(t, y, 1, { useMultiStart: false });
		expect(result.rSquared).toBeGreaterThan(0.99);
	});
});
