import { describe, it, expect } from 'vitest';
import { crossCorrelation, fitAR } from './crossCorrelation.js';

// A triangle wave and the same wave shifted right by 2 samples: Y[t] = X[t - 2], so X LEADS
// and Y follows 2 samples later (the peak is at lag +2).
const X = [0, 1, 2, 1, 0, -1, -2, -1, 0, 1, 2, 1, 0, -1, -2, -1, 0, 1, 2, 1];
const Y = [2, 1, 0, 1, 2, 1, 0, -1, -2, -1, 0, 1, 2, 1, 0, -1, -2, -1, 0, 1];

describe('crossCorrelation', () => {
	it('reports symmetric lags from -maxLag to +maxLag', () => {
		const c = crossCorrelation(X, Y, { maxLag: 4 });
		expect(c.lags).toEqual([-4, -3, -2, -1, 0, 1, 2, 3, 4]);
		expect(c.r).toHaveLength(9);
	});

	it('matches numpy per-lag Pearson (r values)', () => {
		const c = crossCorrelation(X, Y, { maxLag: 4 });
		const expected = [-0.08754, -0.54797, -0.68421, -0.43798, 0.0411, 0.65199, 1.0, 0.65397, 0.0];
		c.r.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 4));
	});

	it('locates the lag of peak correlation', () => {
		const c = crossCorrelation(X, Y, { maxLag: 4 });
		expect(c.peakLag).toBe(2);
		expect(c.peakR).toBeCloseTo(1, 6);
	});

	it('is exactly 1 at lag 0 for a series against itself', () => {
		const c = crossCorrelation(X, X, { maxLag: 3 });
		const zero = c.lags.indexOf(0);
		expect(c.r[zero]).toBeCloseTo(1, 9);
		expect(c.peakLag).toBe(0);
	});

	// X is a triangle wave of period 8, so against itself r is exactly -1 at lag -4
	// AND +1 at lag 0. An argmax over |r| that keeps the FIRST winner reported the
	// anti-phase lag; the peak must be lag 0, r = +1.
	it('reports lag 0 and r = +1 for a periodic series against itself', () => {
		const c = crossCorrelation(X, X, { maxLag: 4 });
		expect(c.r[c.lags.indexOf(-4)]).toBeCloseTo(-1, 9);
		expect(c.peakLag).toBe(0);
		expect(c.peakR).toBeCloseTo(1, 9);
	});

	// A 24-sample-period sine against itself: r at lag -24 is 1 + 2e-16, i.e. it
	// BEATS lag 0 on a raw `>` comparison through floating-point noise alone.
	it('does not let floating-point noise at a repeat lag beat lag 0', () => {
		const sine = Array.from({ length: 120 }, (_, i) => Math.sin((2 * Math.PI * i) / 24));
		const c = crossCorrelation(sine, sine);
		expect(c.peakLag).toBe(0);
		expect(c.peakR).toBeCloseTo(1, 9);
	});

	// The strongest association really is negative and nothing ties it: report it,
	// sign and all, rather than the strongest POSITIVE correlation.
	it('reports a genuinely negative strongest correlation, at its own lag', () => {
		const inverted = X.map((v) => -v);
		// Y2 = -X shifted right by 2, so lag 2 gives exactly -1 and no lag gives +1.
		const c = crossCorrelation(X, [...inverted.slice(-2), ...inverted.slice(0, -2)], {
			maxLag: 3
		});
		expect(c.peakLag).toBe(2);
		expect(c.peakR).toBeCloseTo(-1, 9);
	});

	// Two lags tie on |r| and on sign; the nearer-to-zero lag is the honest answer.
	it('breaks a tie on the smallest absolute lag', () => {
		const c = crossCorrelation(X, X, { maxLag: 8 });
		// +-8 is a full period of the triangle wave, so r = +1 there too.
		expect(c.r[c.lags.indexOf(8)]).toBeCloseTo(1, 9);
		expect(c.peakLag).toBe(0);
	});

	it('defaults maxLag to a quarter of the shorter series', () => {
		const c = crossCorrelation(X, Y); // n=20 → cap 5
		expect(Math.max(...c.lags)).toBe(5);
		expect(Math.min(...c.lags)).toBe(-5);
	});

	it('supports the spearman method', () => {
		const c = crossCorrelation(X, Y, { maxLag: 2, method: 'spearman' });
		expect(c.r).toHaveLength(5);
		expect(Number.isFinite(c.peakR)).toBe(true);
	});
});

// Seeded uniform RNG (mulberry32) and Box-Muller normals for the simulations below.
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
function gauss(r) {
	let u = 0;
	while (u === 0) u = r();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}
function ar1(r, n, phi) {
	let p = gauss(r) / Math.sqrt(1 - phi * phi);
	return Array.from({ length: n }, () => (p = phi * p + gauss(r)));
}

describe('SPEC-1: lag sign with a known delay, both directions', () => {
	const r = rng(1);
	const A = Array.from({ length: 200 }, () => gauss(r));
	const shift = (x, d) => x.map((_, t) => (t - d >= 0 && t - d < x.length ? x[t - d] : 0));

	it('B[t] = A[t - 3] (A leads by 3) peaks at lag +3', () => {
		const c = crossCorrelation(A, shift(A, 3), { maxLag: 10 });
		expect(c.peakLag).toBe(3);
		expect(c.peakR).toBeCloseTo(1, 1);
	});

	it('B[t] = A[t + 3] (B leads by 3) peaks at lag -3', () => {
		const c = crossCorrelation(A, shift(A, -3), { maxLag: 10 });
		expect(c.peakLag).toBe(-3);
	});
});

describe('STAT-7 / SPEC-12: per-lag p-values on independent autocorrelated series', () => {
	it('fitAR matches R ar(method = "yule-walker") (order by AIC, coefficients, variance)', () => {
		// The series below was written out and fitted in R 4 with
		// ar(x, method = "yule-walker"): order 11 and these coefficients; the innovation
		// variance is R's var.pred rescaled to divide by n (R uses n - order - 1).
		const r = rng(5);
		const x = [];
		let p = 0;
		let q = 0;
		for (let i = 0; i < 240; i++) {
			const e = gauss(r);
			x.push(0.6 * p - 0.3 * q + e + 2 * Math.cos((2 * Math.PI * i) / 24));
			q = p;
			p = e + 0.6 * p - 0.3 * q;
		}
		const f = fitAR(x);
		expect(f.order).toBe(11);
		const R = [
			0.75133229, -0.48039196, 0.4899788, -0.25724347, 0.23914067, -0.10885448, -0.04439998,
			0.03251768, -0.11582447, -0.0044537, -0.24116487
		];
		f.coef.forEach((c, i) => expect(c).toBeCloseTo(R[i], 7));
		expect(f.variance).toBeCloseTo(1.07306, 4);
	});

	it('holds the lag-0 and family-wise false-positive rates near 5% at AR(1) phi = 0.9', () => {
		// Reviewer setup (STAT-7): independent AR(1) pairs, n = 168, 85 lags. Before the
		// prewhitening the lag-0 rate was 0.509 and some lag was "significant" in 100%.
		const REPS = 400;
		let lag0 = 0;
		let fw = 0;
		for (let s = 0; s < REPS; s++) {
			const r = rng(1000 + s);
			const c = crossCorrelation(ar1(r, 168, 0.9), ar1(r, 168, 0.9), { maxLag: 42 });
			expect(c.nLags).toBe(85);
			if (c.pvalue[c.lags.indexOf(0)] < 0.05) lag0++;
			if (c.familywiseP < 0.05) fw++;
		}
		// Binomial(400, 0.05) has sd 0.011, so 0.08 is about 3 sd above nominal.
		expect(lag0 / REPS).toBeLessThan(0.08);
		expect(fw / REPS).toBeLessThan(0.08);
		expect(fw / REPS).toBeGreaterThan(0.02);
	});

	it('still detects a real delay through the prewhitening', () => {
		const r = rng(3);
		const A = ar1(r, 240, 0.9);
		const B = A.map((_, t) => (t >= 4 ? A[t - 4] : 0) + 2 * gauss(r));
		const c = crossCorrelation(A, B, { maxLag: 24 });
		expect(c.minPLag).toBe(4);
		expect(c.familywiseP).toBeLessThan(1e-6);
		expect(c.pwPeakLag).toBe(4);
	});

	it('leaves white noise unfiltered (AR order 0) so p equals the raw test', () => {
		const r = rng(11);
		const a = Array.from({ length: 300 }, () => gauss(r));
		const b = Array.from({ length: 300 }, () => gauss(r));
		const c = crossCorrelation(a, b, { maxLag: 5 });
		if (c.arOrder === 0) expect(c.pwR).toEqual(c.r);
		expect(Number.isFinite(c.familywiseP)).toBe(true);
	});
});
