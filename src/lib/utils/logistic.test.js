import { describe, it, expect } from 'vitest';
import { logisticRegression } from './logistic.js';

// Reference values from statsmodels 0.14 sm.Logit on this exact (non-separable) dataset.
const X1 = [2, 4, 1, 3, 5, 2, 6, 3, 7, 1, 5, 4, 8, 2, 6, 3, 7, 5, 4, 9, 1, 6, 3, 8, 5, 2, 7, 4, 6, 3, 5, 8, 2, 7, 4, 6, 3, 9, 5, 7];
const X2 = [1, 3, 2, 5, 1, 4, 2, 6, 3, 5, 2, 7, 1, 4, 6, 3, 2, 8, 5, 1, 7, 3, 6, 2, 4, 8, 1, 5, 3, 7, 2, 6, 4, 1, 8, 3, 5, 2, 6, 4];
const Y = [1, 1, 0, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 1];

describe('logisticRegression (statsmodels Logit parity)', () => {
	const r = logisticRegression(Y, [X1, X2], ['x1', 'x2']);

	it('converges', () => {
		expect(r.converged).toBe(true);
		expect(r.n).toBe(40);
	});

	it('matches statsmodels coefficients and standard errors', () => {
		const [b0, b1, b2] = r.coefficients;
		expect(b0.name).toBe('(intercept)');
		expect(b0.coef).toBeCloseTo(-0.367621, 4);
		expect(b1.coef).toBeCloseTo(0.641579, 4);
		expect(b1.se).toBeCloseTo(0.251738, 4);
		expect(b2.coef).toBeCloseTo(-0.767925, 4);
		expect(b2.se).toBeCloseTo(0.292522, 4);
	});

	it('matches statsmodels Wald z, p-values and odds ratios', () => {
		const [, b1, b2] = r.coefficients;
		expect(b1.z).toBeCloseTo(2.5486, 3);
		expect(b1.pvalue).toBeCloseTo(0.010816, 4);
		expect(b1.oddsRatio).toBeCloseTo(1.899478, 4);
		expect(b2.pvalue).toBeCloseTo(0.00866, 4);
		expect(b2.oddsRatio).toBeCloseTo(0.463975, 4);
	});

	it('computes a 95% CI on the odds ratio that brackets the point estimate', () => {
		const b1 = r.coefficients[1];
		expect(b1.ciLow).toBeLessThan(b1.oddsRatio);
		expect(b1.ciHigh).toBeGreaterThan(b1.oddsRatio);
		// exp(0.641579 ± 1.96·0.251738)
		expect(b1.ciLow).toBeCloseTo(Math.exp(0.641579 - 1.959963984540054 * 0.251738), 4);
	});

	it('matches statsmodels log-likelihood, LR test and McFadden pseudo-R²', () => {
		expect(r.logLik).toBeCloseTo(-13.805282, 3);
		expect(r.lrChiSq).toBeCloseTo(27.440542, 3);
		expect(r.lrPvalue).toBeCloseTo(0.000001, 6);
		expect(r.pseudoR2).toBeCloseTo(0.498456, 4);
		expect(r.lrDf).toBe(2);
	});

	it('drops rows with a missing predictor or non-binary outcome', () => {
		const y = [...Y];
		const x1 = [...X1];
		x1[0] = NaN; // drop row 0
		y[1] = 2; // non-binary → drop row 1
		const r2 = logisticRegression(y, [x1, X2], ['x1', 'x2']);
		expect(r2.n).toBe(38);
	});

	it('flags non-convergence on perfectly separable data', () => {
		const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
		const ySep = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1];
		const r3 = logisticRegression(ySep, [x], ['x']);
		expect(r3.converged).toBe(false);
	});
});
