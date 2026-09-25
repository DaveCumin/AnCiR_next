import { describe, it, expect } from 'vitest';
import { crossCorrelation } from './crossCorrelation.js';

// A triangle wave and the same wave shifted right by 2 samples (y leads x by 2).
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
