import { describe, it, expect } from 'vitest';
import {
	fitCurveModel,
	evaluateCurveModelAtPoints,
	getFitModelDisplayName,
	FIT_FUNCTION_MODELS
} from './fitFunction.js';

// Synthetic cosine: 2·cos(2π/24·t + 0.5) + 5
function cosineData(step = 0.5, duration = 96) {
	const t = [];
	const x = [];
	for (let ti = 0; ti <= duration; ti += step) {
		t.push(ti);
		x.push(2 * Math.cos((2 * Math.PI * ti) / 24 + 0.5) + 5);
	}
	return { t, x };
}

describe('FIT_FUNCTION_MODELS', () => {
	it('lists the three supported models', () => {
		expect(FIT_FUNCTION_MODELS).toEqual(['cosinor', 'rectangular', 'doublelogistic']);
	});
});

describe('getFitModelDisplayName', () => {
	it('maps each model id to a human label', () => {
		expect(getFitModelDisplayName('cosinor')).toBe('Cosinor');
		expect(getFitModelDisplayName('rectangular')).toBe('Rectangular wave');
		expect(getFitModelDisplayName('doublelogistic')).toBe('Double logistic');
	});

	it('falls back to "Fit" for an unknown model', () => {
		expect(getFitModelDisplayName('mystery')).toBe('Fit');
	});
});

describe('fitCurveModel — dispatch', () => {
	it('returns null for an unknown model', () => {
		const { t, x } = cosineData();
		expect(fitCurveModel(t, x, 'unknown')).toBeNull();
	});

	it('fits the free cosinor model and reports mode "free"', () => {
		const { t, x } = cosineData();
		const r = fitCurveModel(t, x, 'cosinor', { Ncurves: 1 });
		expect(r.model).toBe('cosinor');
		expect(r.mode).toBe('free');
		expect(r.rSquared).toBeGreaterThan(0.99);
	});

	it('fits the fixed-period cosinor model and reports mode "fixed"', () => {
		const { t, x } = cosineData();
		const r = fitCurveModel(t, x, 'cosinor', { useFixedPeriod: true, fixedPeriod: 24 });
		expect(r.model).toBe('cosinor');
		expect(r.mode).toBe('fixed');
		expect(r.parameters.period).toBe(24);
		expect(r.parameters.M).toBeCloseTo(5, 1);
		expect(r.rSquared).toBeGreaterThan(0.99);
		// pF is upper-tail; strong signal → significant
		expect(r.significant).toBe(true);
	});

	it('fits the rectangular model', () => {
		// square wave period 24
		const t = [];
		const x = [];
		for (let ti = 0; ti <= 96; ti += 0.5) {
			t.push(ti);
			x.push(ti % 24 < 12 ? 1 : -1);
		}
		const r = fitCurveModel(t, x, 'rectangular', { numStarts: 5 });
		expect(r.model).toBe('rectangular');
		expect(r.rSquared).toBeGreaterThan(0.95);
		expect(r.period).toBeGreaterThan(22);
		expect(r.period).toBeLessThan(26);
	});

	it('fits the double-logistic model', () => {
		const t = [];
		const x = [];
		for (let ti = 0; ti <= 96; ti += 0.5) {
			t.push(ti);
			const phase = ti % 24;
			x.push(phase > 6 && phase < 14 ? 1 : 0);
		}
		const r = fitCurveModel(t, x, 'doublelogistic', { periodic: true, numStarts: 5 });
		expect(r.model).toBe('doublelogistic');
		expect(r.rSquared).toBeGreaterThan(0.95);
	});
});

describe('evaluateCurveModelAtPoints', () => {
	it('returns [] when tPoints is not an array', () => {
		expect(evaluateCurveModelAtPoints({}, 'cosinor', null)).toEqual([]);
	});

	it('returns NaN per point when the fit result has no parameters', () => {
		const out = evaluateCurveModelAtPoints({}, 'cosinor', [0, 1, 2]);
		expect(out.every((v) => Number.isNaN(v))).toBe(true);
	});

	it('evaluates a free cosinor fit at new points', () => {
		const { t, x } = cosineData();
		const fit = fitCurveModel(t, x, 'cosinor', { Ncurves: 1 });
		const pts = [0, 6, 12, 24];
		const out = evaluateCurveModelAtPoints(fit, 'cosinor', pts);
		for (let i = 0; i < pts.length; i++) {
			const trueVal = 2 * Math.cos((2 * Math.PI * pts[i]) / 24 + 0.5) + 5;
			expect(out[i]).toBeCloseTo(trueVal, 1);
		}
	});

	it('evaluates a fixed cosinor fit consistently with its own fitted array', () => {
		const { t, x } = cosineData();
		const fit = fitCurveModel(t, x, 'cosinor', { useFixedPeriod: true, fixedPeriod: 24 });
		const out = evaluateCurveModelAtPoints(fit, 'cosinor', t);
		for (let i = 0; i < t.length; i++) {
			expect(out[i]).toBeCloseTo(fit.fitted[i], 6);
		}
	});

	it('returns NaN per point for an unknown model', () => {
		const out = evaluateCurveModelAtPoints({ parameters: {} }, 'unknown', [1, 2, 3]);
		expect(out.every((v) => Number.isNaN(v))).toBe(true);
	});
});
