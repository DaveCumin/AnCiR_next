import { describe, it, expect } from 'vitest';
import { studentizedRangeSf, studentizedRangeQuantile, XGK, WGK, WG } from './studentizedRange.js';
import { pUpperFromF } from './fdist.js';

const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

describe('GK15 rule', () => {
	it('Gauss points and weights match numpy leggauss(7)', () => {
		// numpy.polynomial.legendre.leggauss(7), non-negative half
		const x = [0.9491079123427585, 0.7415311855993945, 0.4058451513773972, 0];
		const w = [0.1294849661688697, 0.27970539148927664, 0.3818300505051189, 0.4179591836734694];
		[1, 3, 5, 7].forEach((j, i) => expect(XGK[j]).toBeCloseTo(x[i], 15));
		w.forEach((v, i) => expect(WG[i]).toBeCloseTo(v, 15));
	});
	it('the 15-point Kronrod rule is exact to degree 22', () => {
		const nodes = [...XGK.slice(0, 7).map((v) => -v), 0, ...XGK.slice(0, 7).reverse()];
		const wts = [...WGK.slice(0, 7), WGK[7], ...WGK.slice(0, 7).reverse()];
		for (let d = 0; d <= 22; d++) {
			const got = nodes.reduce((acc, x, i) => acc + wts[i] * x ** d, 0);
			expect(got).toBeCloseTo(d % 2 ? 0 : 2 / (d + 1), 14);
		}
	});
});

describe('studentizedRangeSf', () => {
	// [q, k, df, scipy.stats.studentized_range.sf(q, k, df)] from scipy 1.18.0.
	const SCIPY_SF = [
		[3.5, 4, 20, 0.09495845054630203],
		[1, 3, 10, 0.7648908105787191],
		[0.3, 5, 7, 0.9994291667546327],
		[6, 3, 12, 0.0030270533851721737],
		[10, 4, 20, 4.17402901786712e-6],
		[8, 6, 1, 0.2472085734831354],
		[2, 3, 1, 0.5592884960320119],
		[4, 10, 2, 0.44237303522766225],
		[5, 4, 1000, 0.0024003123353758538],
		[4.5, 7, 33, 0.045011309615638484],
		[7, 5, 15, 0.0013996516485121901]
	];
	for (const [q, k, df, want] of SCIPY_SF) {
		it(`matches scipy at q = ${q}, k = ${k}, df = ${df}`, () => {
			expect(rel(studentizedRangeSf(q, k, df), want)).toBeLessThan(1e-9);
		});
	}

	it('df = Infinity is the range of k normals (scipy asymptotic form, df >= 1e5)', () => {
		expect(rel(studentizedRangeSf(5, 4, Infinity), 0.002300502938198834)).toBeLessThan(1e-9);
		expect(rel(studentizedRangeSf(3, 3, Infinity), 0.08554257165495793)).toBeLessThan(1e-9);
	});

	// For k = 2 the studentized range is sqrt(2) |T_df|, so P(Q > q) = 2 P(T > q / sqrt(2))
	// exactly. The t tail is known to full relative precision far below where
	// scipy's 1 - cdf can resolve the studentized range, so this pins tiny p.
	// [q, df, 2 * scipy.stats.t.sf(q / sqrt(2), df)]
	const K2 = [
		[15, 5, 0.00012880299149572522],
		[12, 3, 0.0034369455005616853],
		[60, 10, 1.2697255972684048e-12],
		[30, 40, 2.254506180780545e-23]
	];
	for (const [q, df, want] of K2) {
		it(`k = 2 equals the two-sided t tail (q = ${q}, df = ${df}, p = ${want.toExponential(2)})`, () => {
			expect(rel(studentizedRangeSf(q, 2, df), want)).toBeLessThan(1e-8);
			// and the same tail through the F(1, df) route the app already uses
			expect(rel(studentizedRangeSf(q, 2, df), pUpperFromF((q * q) / 2, 1, df))).toBeLessThan(1e-8);
		});
	}

	it('is monotone and stays positive deep in the tail for k > 2', () => {
		let prev = 1;
		for (const q of [5, 10, 20, 30, 40]) {
			const p = studentizedRangeSf(q, 4, 30);
			expect(p).toBeGreaterThan(0);
			expect(p).toBeLessThan(prev);
			prev = p;
		}
		// k means can only make the range larger: the tail grows with k.
		expect(studentizedRangeSf(30, 3, 40)).toBeGreaterThan(studentizedRangeSf(30, 2, 40));
		expect(studentizedRangeSf(30, 3, 40)).toBeLessThan(3 * studentizedRangeSf(30, 2, 40));
	});

	it('handles the edges', () => {
		expect(studentizedRangeSf(0, 3, 10)).toBe(1);
		expect(studentizedRangeSf(-1, 3, 10)).toBe(1);
		expect(studentizedRangeSf(Infinity, 3, 10)).toBe(0);
		expect(studentizedRangeSf(NaN, 3, 10)).toBeNaN();
		expect(studentizedRangeSf(2, 1, 10)).toBeNaN();
		expect(studentizedRangeSf(2, 3, 0)).toBeNaN();
	});

	it('remembers answers per (q, k, df), never across them', () => {
		// Each argument changed alone must give its own scipy value, also when the
		// neighbouring call has just been answered from memory.
		const cases = [
			[3.5, 4, 20, 0.09495845054630203],
			[3.5, 4, 1000, null],
			[3.5, 5, 20, null],
			[10, 4, 20, 4.17402901786712e-6]
		];
		const first = cases.map(([q, k, df]) => studentizedRangeSf(q, k, df));
		const again = cases.map(([q, k, df]) => studentizedRangeSf(q, k, df));
		expect(again).toEqual(first);
		expect(new Set(first).size).toBe(cases.length);
		expect(rel(first[0], cases[0][3])).toBeLessThan(1e-9);
		expect(rel(first[3], cases[3][3])).toBeLessThan(1e-9);
	});
});

describe('studentizedRangeQuantile', () => {
	// [p, k, df, scipy.stats.studentized_range.ppf(p, k, df)]
	const SCIPY_PPF = [
		[0.95, 4, 14, 4.110506357652341],
		[0.95, 3, 6, 4.339195476520314],
		[0.99, 5, 20, 5.293252519239433],
		[0.95, 2, 10, 3.1510641833294026],
		[0.9, 8, 40, 4.0985189989860356]
	];
	for (const [p, k, df, want] of SCIPY_PPF) {
		it(`matches scipy ppf(${p}, ${k}, ${df})`, () => {
			expect(rel(studentizedRangeQuantile(p, k, df), want)).toBeLessThan(1e-10);
		});
	}

	it('inverts the tail', () => {
		// 1 - 2^-30 is exact in binary, so the target tail is exactly 2^-30 (about 9.3e-10).
		const q = studentizedRangeQuantile(1 - 2 ** -30, 4, 25);
		expect(rel(studentizedRangeSf(q, 4, 25), 2 ** -30)).toBeLessThan(1e-9);
	});

	it('rejects invalid input', () => {
		expect(studentizedRangeQuantile(0, 3, 10)).toBeNaN();
		expect(studentizedRangeQuantile(1, 3, 10)).toBeNaN();
		expect(studentizedRangeQuantile(0.95, 1, 10)).toBeNaN();
	});
});
