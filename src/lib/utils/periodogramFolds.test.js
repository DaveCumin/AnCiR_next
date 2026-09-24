import { describe, it, expect } from 'vitest';
import { runPeriodogramCalculation } from './periodogram.js';

// Fold-grid tests for the BINNED periodograms (Chi-squared and Enright), run
// through the REAL binData pipeline.
//
// Both statistics depend on the trial period only through the fold length
// nBins = round(P / binSize), so every trial period inside one bin width is the
// same test. They used to be returned as separate points with identical power,
// and argmax picked the FIRST of the tie: a noise-free 24.0 h cosine on hourly
// data with 1 h bins was reported as 23.5 h (a -binSize/2 bias), and the Sidak
// correction counted every duplicate as an extra comparison. Evidence:
// tools/benchmarks/paper/results/accuracy/E_issue_evidence.json (the paper's
// accuracy benchmark).

function cosine(periodH, days, dt) {
	const t = [];
	const y = [];
	const n = Math.round((days * 24) / dt);
	for (let i = 0; i < n; i++) {
		const h = i * dt;
		t.push(h);
		y.push(10 + 5 * Math.cos((2 * Math.PI * h) / periodH));
	}
	return { t, y };
}

function run(method, { tau, dt, binSize, step, periodMin = 18, periodMax = 30 }) {
	const { t, y } = cosine(tau, 14, dt);
	return runPeriodogramCalculation({
		method,
		xData: t,
		yData: y,
		binSize,
		periodMin,
		periodMax,
		periodSteps: step,
		chiSquaredAlpha: 0.05
	});
}

function peakPeriod(res) {
	let best = 0;
	for (let i = 1; i < res.y.length; i++) if (res.y[i] > res.y[best]) best = i;
	return res.x[best];
}

const METHODS = ['Chi-squared', 'Enright'];
// [sampling interval, binSize]
const GRIDS = [
	[1, 1],
	[0.25, 0.25],
	[0.25, 1]
];
const STEPS = [0.05, 0.1, 0.25, 0.5];

describe.each(METHODS)('%s periodogram reports the fold period actually tested', (method) => {
	for (const [dt, binSize] of GRIDS) {
		for (const tau of [24.0, 24.3]) {
			// The nearest testable fold: the answer the statistic can actually give.
			const expected = Math.round(tau / binSize) * binSize;
			// A step coarser than binSize samples only some folds; covered below.
			it.each(STEPS.filter((step) => step <= binSize))(
				`tau ${tau} h, dt ${dt} h, bin ${binSize} h, step %s h -> peak at ${expected} h`,
				(step) => {
					const res = run(method, { tau, dt, binSize, step });
					expect(res.x.length).toBeGreaterThan(0);
					expect(peakPeriod(res)).toBeCloseTo(expected, 9);
				}
			);
		}
	}

	it('returns one point per distinct fold, each an integer multiple of binSize', () => {
		for (const [dt, binSize] of GRIDS) {
			for (const step of STEPS) {
				const res = run(method, { tau: 24, dt, binSize, step });
				for (let i = 0; i < res.x.length; i++) {
					const nBins = res.x[i] / binSize;
					expect(Math.abs(nBins - Math.round(nBins))).toBeLessThan(1e-9);
					if (i > 0) expect(res.x[i] - res.x[i - 1]).toBeGreaterThan(binSize / 2);
				}
			}
		}
	});

	it('keeps every fold period inside the requested range', () => {
		// round(23.4 / 1) = 23 and round(24.6 / 1) = 25 fall outside [23.4, 24.6];
		// only the 24-bin fold lies inside it.
		const res = run(method, {
			tau: 24,
			dt: 1,
			binSize: 1,
			step: 0.05,
			periodMin: 23.4,
			periodMax: 24.6
		});
		expect(res.x).toEqual([24]);
	});

	it('gives the same spectrum for any step at or below binSize', () => {
		const ref = run(method, { tau: 24.3, dt: 0.25, binSize: 1, step: 1 });
		for (const step of [0.05, 0.1, 0.25, 0.5]) {
			const res = run(method, { tau: 24.3, dt: 0.25, binSize: 1, step });
			expect(res.x).toEqual(ref.x);
			expect(res.y).toEqual(ref.y);
		}
	});

	it('still honours a step coarser than binSize (tests only the folds the grid hits)', () => {
		const res = run(method, { tau: 24, dt: 0.25, binSize: 0.25, step: 1 });
		expect(res.x).toEqual([18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
		// With 0.5 h steps at 0.25 h bins the 24.25 h fold is never sampled; the
		// nearest sampled fold to 24.3 h is 24.5 h, not 24.0 h.
		expect(peakPeriod(run(method, { tau: 24.3, dt: 0.25, binSize: 0.25, step: 0.5 }))).toBe(24.5);
	});
});

describe('Chi-squared Sidak correction counts distinct folds, not trial periods', () => {
	// 18..30 h at 1 h bins is 13 distinct folds whatever the step. Pinned against
	// scipy.stats.chi2.ppf((1 - 0.05) ** (1 / 13), 23) = 45.03294146024386 (df 23
	// for the fully occupied 24-bin fold). Counting the 241 trial periods of a
	// 0.05 h step instead would have drawn the line at a much higher quantile.
	it.each(STEPS)('threshold at 24 h uses M = 13 for step %s h', (step) => {
		const res = run('Chi-squared', { tau: 24, dt: 1, binSize: 1, step });
		expect(res.x.length).toBe(13);
		const i24 = res.x.findIndex((p) => Math.abs(p - 24) < 1e-9);
		expect(res.df[i24]).toBe(23);
		expect(res.threshold[i24]).toBeCloseTo(45.03294146024386, 6);
	});
});

describe('Chi-squared family-wise false-positive rate on white noise', () => {
	// mulberry32, the seeded generator the parity fixtures use.
	function mulberry32(seed) {
		return () => {
			seed |= 0;
			seed = (seed + 0x6d2b79f5) | 0;
			let v = Math.imul(seed ^ (seed >>> 15), 1 | seed);
			v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v;
			return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
		};
	}

	// Sidak over the distinct folds should hold the family-wise rate near, and
	// not above, the nominal 5%. Counting all 241 trial periods of a 0.05 h step
	// held it near 0.1% instead (a line far too high to detect weak rhythms).
	// Neighbouring folds are correlated, so somewhat under 5% is expected.
	it('is near but not above the nominal 5% at 1 h bins with a 0.05 h step', () => {
		const nRuns = 400;
		let hits = 0;
		for (let seed = 1; seed <= nRuns; seed++) {
			const rng = mulberry32(seed);
			const t = Array.from({ length: 336 }, (_, i) => i);
			const y = t.map(
				() => Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng())
			);
			const res = runPeriodogramCalculation({
				method: 'Chi-squared',
				xData: t,
				yData: y,
				binSize: 1,
				periodMin: 18,
				periodMax: 30,
				periodSteps: 0.05,
				chiSquaredAlpha: 0.05
			});
			if (res.y.some((v, i) => v > res.threshold[i])) hits++;
		}
		const fwer = hits / nRuns;
		expect(fwer).toBeGreaterThan(0.015);
		expect(fwer).toBeLessThanOrEqual(0.07);
	});
});

describe('Enright periodogram with missing values', () => {
	// A missing y (null) must leave its bin EMPTY, exactly as if the row were
	// absent. binData's isFinite(null) is true (Number(null) is 0), so a raw
	// null used to be averaged into its bin as a zero; the Periodogram plot
	// passes columns with nulls straight through. Chi-squared already filtered
	// with validPairs; Enright did not.
	it('treats a null y as a missing row, not as zero', () => {
		const { t, y } = cosine(24, 14, 1);
		const withNulls = y.map((v, i) => (i % 7 === 3 || (i >= 100 && i < 130) ? null : v));
		const keep = withNulls.map((v) => v !== null);
		const common = { method: 'Enright', binSize: 1, periodMin: 18, periodMax: 30, periodSteps: 1 };
		const a = runPeriodogramCalculation({ ...common, xData: t, yData: withNulls });
		const b = runPeriodogramCalculation({
			...common,
			xData: t.filter((_, i) => keep[i]),
			yData: y.filter((_, i) => keep[i])
		});
		expect(a.x).toEqual(b.x);
		expect(a.y).toEqual(b.y);
	});
});
