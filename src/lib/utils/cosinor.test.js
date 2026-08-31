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

// Zero-amplitude F-test pinned against scipy (the field's reference implementation).
//
// Both datasets are 48 hourly points of 10 + A·cos(2π(t−8)/24) + fixed noise; the
// noise arrays were drawn ONCE from numpy's seeded default_rng(42) and hard-coded,
// then F and p computed with numpy lstsq + scipy.stats.f.sf:
//   strong (A=3, σ=1.5): F = 73.57991673022295,  p = 6.5293921447440736e-15
//   weak   (A=0.9, σ=3): F = 2.3424837144170088, p = 0.10770077966803805
// The weak case matters most: a mid-range p exercises the CDF where precision is
// visible, not just the underflow-to-zero tail the existing "p < 0.001" test hits.
describe('fitCosinorFixed F-test vs scipy', () => {
	const t48 = Array.from({ length: 48 }, (_, i) => i);
	const NOISE_STRONG = [
		0.457076, -1.559976, 1.125677, 1.410847, -2.926553, -1.953269, 0.191761, -0.474364,
		-0.025202, -1.279566, 1.319097, 1.166688, 0.099046, 1.690862, 0.701264, -1.288939,
		0.553126, -1.438324, 1.317675, -0.074889, -0.277294, -1.021394, 1.833812, -0.231794,
		-0.642492, -0.5282, 0.798464, 0.548166, 0.619099, 0.646232, 3.212471, -0.609623,
		-0.768364, -1.220659, 0.923969, 1.693458, -0.170921, -1.260235, -1.236722, 0.975889,
		1.114881, 0.814731, -0.998265, 0.348242, 0.175029, 0.328033, 1.307143, 0.335393
	];
	const NOISE_WEAK = [
		2.036741, 0.202737, 0.867358, 1.893865, -4.371467, -0.959014, -1.411118, -1.916634,
		-0.825427, 4.484824, -2.597493, 2.904835, -5.048609, -1.004655, 0.488259, 1.758667,
		2.13368, 2.380042, -1.046175, -1.387055, 2.573928, -0.573913, -3.827059, -3.399862,
		-2.758357, 1.491482, 0.427277, 2.071456, -1.281758, 0.475619, 1.876771, -0.92804,
		1.370326, -1.985778, -1.089162, -1.145214, -3.587519, 1.460917, -1.408207, 0.037482,
		1.44224, 1.339594, 1.996155, -0.295456, -1.269895, -0.239155, -5.062003, -4.341337
	];
	const mk = (amp, noise) =>
		t48.map((ti, i) => 10 + amp * Math.cos((2 * Math.PI * (ti - 8)) / 24) + noise[i]);

	it('matches scipy on a strong rhythm (F and R² to 1e-9, p same order at 1e-15)', () => {
		const r = fitCosinorFixed(t48, mk(3, NOISE_STRONG), 24, 1, 0.05);
		expect(r.F_stat).toBeCloseTo(73.57991673022295, 9);
		expect(r.R2).toBeCloseTo(0.7658199469179766, 9);
		// Down at 1e-15 the JS 1−cdf loses relative precision; order of magnitude
		// is the honest pin (scipy uses sf directly).
		expect(r.pF).toBeGreaterThan(0);
		expect(r.pF).toBeLessThan(1e-13);
	});

	it('matches scipy on a weak rhythm (p to 1e-9 where precision is visible)', () => {
		const r = fitCosinorFixed(t48, mk(0.9, NOISE_WEAK), 24, 1, 0.05);
		expect(r.F_stat).toBeCloseTo(2.3424837144170088, 9);
		expect(r.pF).toBeCloseTo(0.10770077966803805, 9);
	});
});
