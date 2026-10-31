// @ts-nocheck
/**
 * SPEC-U3 (2026-10-03 review, "possible issue, not confirmed"): the chi-squared periodogram is
 * very conservative on short records (family-wise false-positive rate about 0.002 on 3 days of
 * white noise against a nominal 0.05).
 *
 * Verdict: CONFIRMED. Decision (David, 2026-11-01): the test is not changed; the Periodogram
 * plot, Rhythmicity Analysis and Moving Analysis warn when the record (or window) holds fewer
 * than 7 cycles of the longest period tested (utils/chiSquaredShortRecord.js, where the
 * threshold is justified). Two causes, measured separately:
 *
 *  1. The statistic is Qp = N x SS_between / SS_total of a one-way layout (the fold columns are
 *     the groups; Sokolove and Bushell 1978, J. Theor. Biol. 72:131-160). For i.i.d. normal
 *     data SS_between / SS_total is EXACTLY Beta((P - 1) / 2, (N - P) / 2), the one-way ANOVA
 *     identity behind scipy.stats.f_oneway, so Qp is bounded by N and its tail is lighter than
 *     the chi-square(P - 1) the app refers it to. Pinned below: Qp from the app equals
 *     N R^2 from scipy's F to 1e-9, and scipy gives the exact pointwise size of the app's
 *     chi-square 0.05 cut-off at P = 24 h: 0.0221 (3 days), 0.0344 (5), 0.0392 (7), 0.0427
 *     (10), 0.0449 (14).
 *  2. The Sidak line then divides alpha by about 13 folds (18 to 30 h, 1 h bins), so at 3 days
 *     each fold's real level is 0.00013 (scipy beta.sf) against the nominal 0.0039.
 */
import { describe, it, expect } from 'vitest';
import { runPeriodogramCalculation } from './periodogram.js';

// numpy default_rng(7).normal(size=72), rounded to 4 dp.
const Y72 = [
	0.0012, 0.2987, -0.2741, -0.8906, -0.4547, -0.9916, 0.0601, 1.3402, -0.4922, -0.6205, 0.4898,
	0.3569, 0.1054, -0.9305, -0.0293, 0.6953, -1.3442, -0.4576, -1.9012, -1.2895, -1.8417, -0.2351,
	-1.2674, 0.2713, 0.1568, -0.1869, -2.5168, -0.5387, -0.0485, 0.1133, -1.5301, -0.4778, -0.9785,
	-0.8088, 1.0609, -0.8075, -0.0325, 0.8844, -0.5836, -0.1117, 0.1105, 0.0638, -1.2251, 0.0761,
	1.3588, -1.5471, 0.8594, 0.1194, -0.6415, 2.0004, 0.7623, -1.1993, 0.0745, 0.5767, -0.1888,
	0.6829, -0.0665, 0.6672, 1.4385, -0.6757, 0.2031, -0.4633, 0.1273, -1.1872, -0.5793, -0.1962,
	0.8988, 1.1452, -1.3235, -0.7946, 0.6469, -1.9924
];
// scipy 1.x: f_oneway over the 24 fold columns, F = 0.7649749121535093 (p 0.7539),
// so N R^2 = 19.31259392161322 and chi2.sf(19.3126, 23) = 0.6829395151670345.
const SCIPY_QP = 19.31259392161322;
const SCIPY_CHI2_P = 0.6829395151670345;

const GRID = {
	method: 'Chi-squared',
	binSize: 1,
	periodMin: 18,
	periodMax: 30,
	periodSteps: 1,
	chiSquaredAlpha: 0.05
};

function mulberry32(seed) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let v = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v;
		return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
	};
}

function whiteNoise(rng, n) {
	return Array.from({ length: n }, () => {
		const u = Math.max(rng(), 1e-12);
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
	});
}

/** Family-wise and 24 h-pointwise rejection rates on white noise of `days` hourly days. */
function rates(days, nrec, seed) {
	const rng = mulberry32(seed);
	const n = 24 * days;
	const t = Array.from({ length: n }, (_, i) => i);
	let fw = 0;
	let point = 0;
	for (let r = 0; r < nrec; r++) {
		const res = runPeriodogramCalculation({ ...GRID, xData: t, yData: whiteNoise(rng, n) });
		if (res.y.some((q, i) => q > res.threshold[i])) fw++;
		const i24 = res.x.findIndex((p) => Math.abs(p - 24) < 1e-9);
		if (res.pvalue[i24] < 0.05) point++;
	}
	return { fw: fw / nrec, point: point / nrec };
}

describe('SPEC-U3: chi-squared periodogram size on short records', () => {
	it('Qp is N x SS_between / SS_total, the one-way ANOVA R^2 (scipy f_oneway reference)', () => {
		const t = Y72.map((_, i) => i);
		const res = runPeriodogramCalculation({ ...GRID, xData: t, yData: Y72 });
		const i = res.x.findIndex((p) => Math.abs(p - 24) < 1e-9);
		expect(res.df[i]).toBe(23);
		expect(res.y[i]).toBeCloseTo(SCIPY_QP, 9);
		expect(res.pvalue[i]).toBeCloseTo(SCIPY_CHI2_P, 9);
	});

	it('3 days of white noise: pointwise size ~0.022 at 24 h and family-wise ~0.002, not 0.05', () => {
		const { fw, point } = rates(3, 3000, 20261028);
		process.stderr.write(
			`SPEC-U3 3 days: pointwise(24 h) ${point.toFixed(4)}, family-wise ${fw.toFixed(4)}\n`
		);
		expect(point).toBeGreaterThan(0.012);
		expect(point).toBeLessThan(0.034);
		expect(fw).toBeLessThan(0.01);
	});

	it('14 days: closer to nominal pointwise, still conservative family-wise', () => {
		const { fw, point } = rates(14, 1500, 77);
		process.stderr.write(
			`SPEC-U3 14 days: pointwise(24 h) ${point.toFixed(4)}, family-wise ${fw.toFixed(4)}\n`
		);
		expect(point).toBeGreaterThan(0.03);
		expect(point).toBeLessThan(0.06);
		expect(fw).toBeLessThan(0.04);
	});
});
