// Unit tests for the Q-Q plot maths (utils/qq.js).
//
// Known quantile values are pinned against R's qnorm / scipy.stats.norm.ppf
// (which agree to well beyond the ~1.15e-9 accuracy of Acklam's
// approximation). The full qqPoints() computation is additionally pinned to
// scipy in the Python parity harness (tools/parity/fixtures.json,
// util-qq-points-normal).
import { describe, it, expect } from 'vitest';
import { normalQuantile, normalPdf, blomPositions, qqPoints, qqCorrelation } from './qq.js';

describe('normalQuantile', () => {
	it('matches known qnorm values to 1e-8', () => {
		expect(normalQuantile(0.5)).toBeCloseTo(0, 12);
		expect(normalQuantile(0.975)).toBeCloseTo(1.959963985, 8);
		expect(normalQuantile(0.025)).toBeCloseTo(-1.959963985, 8);
		expect(normalQuantile(0.95)).toBeCloseTo(1.644853627, 8);
		expect(normalQuantile(0.75)).toBeCloseTo(0.6744897502, 8);
		expect(normalQuantile(0.001)).toBeCloseTo(-3.090232306, 7);
		expect(normalQuantile(0.999)).toBeCloseTo(3.090232306, 7);
	});
	it('is antisymmetric about 0.5', () => {
		for (const p of [0.01, 0.1, 0.3, 0.45]) {
			expect(normalQuantile(p)).toBeCloseTo(-normalQuantile(1 - p), 9);
		}
	});
	it('handles the boundaries', () => {
		expect(normalQuantile(0)).toBe(-Infinity);
		expect(normalQuantile(1)).toBe(Infinity);
		expect(normalQuantile(NaN)).toBeNaN();
		expect(normalQuantile(null)).toBeNaN();
	});
});

describe('normalPdf', () => {
	it('matches dnorm', () => {
		expect(normalPdf(0)).toBeCloseTo(0.3989422804, 9);
		expect(normalPdf(1)).toBeCloseTo(0.2419707245, 9);
		expect(normalPdf(-1)).toBeCloseTo(0.2419707245, 9);
	});
});

describe('blomPositions', () => {
	it('computes (i - 3/8)/(n + 1/4)', () => {
		const p = blomPositions(5);
		expect(p).toHaveLength(5);
		expect(p[0]).toBeCloseTo(0.625 / 5.25, 12);
		expect(p[4]).toBeCloseTo(4.625 / 5.25, 12);
	});
	it('matches the Shapiro-Wilk m-value convention in normality.js', () => {
		// normality.js: m[i] = normalQuantile((i + 1 - 0.375) / (n + 0.25))
		const n = 10;
		const p = blomPositions(n);
		for (let i = 0; i < n; i++) expect(p[i]).toBeCloseTo((i + 1 - 0.375) / (n + 0.25), 12);
	});
	it('is symmetric: p_i + p_{n+1-i} = 1', () => {
		const p = blomPositions(7);
		for (let i = 0; i < 7; i++) expect(p[i] + p[6 - i]).toBeCloseTo(1, 12);
	});
});

describe('qqPoints', () => {
	const sample = [2.1, -0.3, 1.4, 0.2, -1.1, 0.8, 0.05, 1.9, -0.7, 0.4, 1.2, -0.9];

	it('returns sorted sample against monotone theoretical quantiles', () => {
		const q = qqPoints(sample);
		expect(q.n).toBe(12);
		expect(q.dropped).toBe(0);
		expect(q.sample).toEqual([...sample].sort((a, b) => a - b));
		for (let i = 1; i < q.theoretical.length; i++) {
			expect(q.theoretical[i]).toBeGreaterThan(q.theoretical[i - 1]);
		}
		// Blom position endpoints
		expect(q.theoretical[0]).toBeCloseTo(normalQuantile(0.625 / 12.25), 12);
	});

	it('drops nulls and NaNs, counting them', () => {
		const q = qqPoints([1, null, 2, NaN, 3, undefined, 4]);
		expect(q.n).toBe(4);
		expect(q.dropped).toBe(3);
		expect(q.sample).toEqual([1, 2, 3, 4]);
	});

	it('keeps a genuine zero (?? vs || trap)', () => {
		const q = qqPoints([0, 1, 2]);
		expect(q.n).toBe(3);
		expect(q.sample[0]).toBe(0);
	});

	it('returns the empty shape below n = 3', () => {
		const q = qqPoints([1, 2]);
		expect(q.n).toBe(2);
		expect(q.theoretical).toEqual([]);
		expect(q.sample).toEqual([]);
		expect(q.line.slope).toBeNaN();
		expect(q.band.lo).toEqual([]);
	});

	it('quartile line passes exactly through both quartile points (R qqline)', () => {
		const q = qqPoints(sample);
		// type-7 quantiles of the sorted sample
		const sorted = [...sample].sort((a, b) => a - b);
		const quant = (p) => {
			const pos = p * (sorted.length - 1);
			const lo = Math.floor(pos);
			return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (pos - lo);
		};
		const zQ1 = normalQuantile(0.25);
		const zQ3 = normalQuantile(0.75);
		expect(q.line.intercept + q.line.slope * zQ1).toBeCloseTo(quant(0.25), 10);
		expect(q.line.intercept + q.line.slope * zQ3).toBeCloseTo(quant(0.75), 10);
	});

	it('line recovers location and scale for an exactly-normal grid', () => {
		// Build a "perfectly normal" sample: mu + sigma * qnorm(blom positions).
		const mu = 10;
		const sigma = 2.5;
		const values = blomPositions(101).map((p) => mu + sigma * normalQuantile(p));
		const q = qqPoints(values);
		expect(q.line.slope).toBeCloseTo(sigma, 1);
		expect(q.line.intercept).toBeCloseTo(mu, 1);
		// And every point lies (essentially) on the line. Not exact: the sample
		// quartiles are type-7 interpolations between grid points while the line's
		// z-quartiles are exact, so allow a small tolerance.
		for (let i = 0; i < q.n; i++) {
			const diff = Math.abs(q.sample[i] - (q.line.intercept + q.line.slope * q.theoretical[i]));
			expect(diff).toBeLessThan(0.15);
		}
	});

	it('band brackets the line, widens toward the tails, and widens with confidence', () => {
		const q95 = qqPoints(sample, { confidence: 0.95 });
		const q99 = qqPoints(sample, { confidence: 0.99 });
		const mid = Math.floor(q95.n / 2);
		for (let i = 0; i < q95.n; i++) {
			const fit = q95.line.intercept + q95.line.slope * q95.theoretical[i];
			expect(q95.band.lo[i]).toBeLessThan(fit);
			expect(q95.band.hi[i]).toBeGreaterThan(fit);
			// 99% band is strictly wider than 95%
			expect(q99.band.hi[i] - q99.band.lo[i]).toBeGreaterThan(q95.band.hi[i] - q95.band.lo[i]);
		}
		// tails wider than the middle
		const widthAt = (i) => q95.band.hi[i] - q95.band.lo[i];
		expect(widthAt(0)).toBeGreaterThan(widthAt(mid));
		expect(widthAt(q95.n - 1)).toBeGreaterThan(widthAt(mid));
	});

	it('pointwise band SE matches the car::qqPlot formula at a spot value', () => {
		const q = qqPoints(sample, { confidence: 0.95 });
		const i = 5;
		const p = (i + 1 - 0.375) / (q.n + 0.25);
		const z = q.theoretical[i];
		const se = (q.line.slope / normalPdf(z)) * Math.sqrt((p * (1 - p)) / q.n);
		const fit = q.line.intercept + q.line.slope * z;
		expect(q.band.hi[i]).toBeCloseTo(fit + 1.959963985 * se, 8);
		expect(q.band.lo[i]).toBeCloseTo(fit - 1.959963985 * se, 8);
	});

	it('constant data gives a flat line and a zero-width band, not NaNs', () => {
		const q = qqPoints([5, 5, 5, 5, 5]);
		expect(q.line.slope).toBe(0);
		expect(q.line.intercept).toBe(5);
		q.band.lo.forEach((v, i) => {
			expect(v).toBe(5);
			expect(q.band.hi[i]).toBe(5);
		});
	});
});

describe('qqCorrelation (probability-plot correlation, Blom positions)', () => {
	// A sample that IS an affine transform of the theoretical quantiles: build
	// values at mu + sigma * qnorm(blom positions). Sorting recovers exactly the
	// pairs (z_i, mu + sigma * z_i), so r = 1 to float precision.
	it('is 1 for perfectly normal quantile data', () => {
		const values = blomPositions(101).map((p) => 10 + 2.5 * normalQuantile(p));
		expect(qqPoints(values).r).toBeCloseTo(1, 12);
	});

	it('is invariant to location/scale and to input order', () => {
		const base = blomPositions(50).map((p) => normalQuantile(p));
		const shuffled = [...base].sort(() => 0.5 - Math.random());
		const scaled = shuffled.map((v) => -3 + 100 * v);
		expect(qqPoints(scaled).r).toBeCloseTo(qqPoints(base).r, 10);
	});

	it('is markedly below 1 for exponential data', () => {
		// Exponential quantiles at the Blom positions: strongly right-skewed.
		const values = blomPositions(101).map((p) => -Math.log(1 - p));
		const r = qqPoints(values).r;
		expect(r).toBeGreaterThan(0); // still monotone increasing
		expect(r).toBeLessThan(0.98); // but visibly curved
	});

	it('is markedly below 1 for bimodal data', () => {
		// Two tight clusters at ±3: the Q-Q picture is a step, not a line.
		const values = [];
		for (let i = 0; i < 50; i++) values.push(-3 + i * 0.001, 3 + i * 0.001);
		const r = qqPoints(values).r;
		expect(r).toBeGreaterThan(0);
		expect(r).toBeLessThan(0.95);
	});

	it('is null for constant data (zero variance)', () => {
		expect(qqPoints([5, 5, 5, 5, 5]).r).toBeNull();
		expect(qqCorrelation([-1, 0, 1], [2, 2, 2])).toBeNull();
	});

	it('is null below n = 3', () => {
		expect(qqPoints([1, 2]).r).toBeNull();
		expect(qqPoints([]).r).toBeNull();
		expect(qqCorrelation([-1, 1], [0, 2])).toBeNull();
		expect(qqCorrelation([], [])).toBeNull();
	});

	it('matches a hand-computed Pearson r on a small exact case', () => {
		// pairs (-1,0), (0,1), (1,3): r = cov/sqrt(varx*vary)
		// mx=0, my=4/3; sxy=3, sxx=2, syy=(16+1+25)/9=14/3 → r=3/sqrt(28/3)
		expect(qqCorrelation([-1, 0, 1], [0, 1, 3])).toBeCloseTo(3 / Math.sqrt(28 / 3), 12);
	});

	it('qqPoints computes r on the same Blom-position pairs it returns', () => {
		const sample = [2.1, -0.3, 1.4, 0.2, -1.1, 0.8, 0.05, 1.9, -0.7, 0.4, 1.2, -0.9];
		const q = qqPoints(sample);
		expect(q.r).toBeCloseTo(qqCorrelation(q.theoretical, q.sample), 14);
	});
});
