import { describe, it, expect } from 'vitest';
import { computeAutocorrelation } from './correlogram.js';

// Uniformly-sampled cosine.
function cosine(periodH, durationH, stepH) {
	const t = [];
	const y = [];
	for (let ti = 0; ti <= durationH; ti += stepH) {
		t.push(ti);
		y.push(Math.cos((2 * Math.PI * ti) / periodH));
	}
	return { t, y };
}

// Nearest-lag index to a target lag time.
function nearestLag(lags, target) {
	let best = 0;
	for (let i = 1; i < lags.length; i++) {
		if (Math.abs(lags[i] - target) < Math.abs(lags[best] - target)) best = i;
	}
	return best;
}

describe('computeAutocorrelation — guard clauses', () => {
	it('returns empty for empty input', () => {
		const r = computeAutocorrelation([], []);
		expect(r.lags).toEqual([]);
		expect(r.correlations).toEqual([]);
	});

	it('returns empty for a single sample', () => {
		expect(computeAutocorrelation([0], [1]).lags).toEqual([]);
	});

	it('returns empty for mismatched-length arrays', () => {
		expect(computeAutocorrelation([0, 1, 2], [0, 1]).lags).toEqual([]);
	});

	it('returns empty for null input', () => {
		expect(computeAutocorrelation(null, null).lags).toEqual([]);
	});

	it('returns empty when fewer than two valid (non-NaN) pairs remain', () => {
		const r = computeAutocorrelation([0, NaN, NaN, NaN], [1, NaN, NaN, NaN]);
		expect(r.lags).toEqual([]);
	});

	it('returns empty (no correlations) for a zero-variance signal', () => {
		const t = Array.from({ length: 20 }, (_, i) => i);
		const y = new Array(20).fill(5);
		const r = computeAutocorrelation(t, y);
		expect(r.correlations).toEqual([]);
	});

	it('returns empty when minLag >= maxLag', () => {
		const { t, y } = cosine(24, 96, 0.5);
		const r = computeAutocorrelation(t, y, null, 10, 20);
		expect(r.lags).toEqual([]);
	});
});

describe('computeAutocorrelation — known identities (uniform sampling)', () => {
	it('autocorrelation at lag 0 equals 1', () => {
		const { t, y } = cosine(24, 240, 0.5);
		const r = computeAutocorrelation(t, y);
		expect(r.lags[0]).toBe(0);
		expect(r.correlations[0]).toBeCloseTo(1, 6);
	});

	it('a 24h cosine autocorrelates to ~+1 at lag 24 and ~-1 at lag 12', () => {
		const { t, y } = cosine(24, 24 * 12, 0.5);
		const r = computeAutocorrelation(t, y);
		const i24 = nearestLag(r.lags, 24);
		const i12 = nearestLag(r.lags, 12);
		expect(r.correlations[i24]).toBeCloseTo(1, 1);
		expect(r.correlations[i12]).toBeCloseTo(-1, 1);
	});

	it('reports dt derived from the median spacing when binSize is null', () => {
		const { t, y } = cosine(24, 96, 0.5);
		expect(computeAutocorrelation(t, y).dt).toBeCloseTo(0.5, 10);
	});

	it('honours an explicit binSize as dt', () => {
		const { t, y } = cosine(24, 96, 0.5);
		expect(computeAutocorrelation(t, y, 1).dt).toBe(1);
	});

	it('drops lags below minLag', () => {
		const { t, y } = cosine(24, 240, 0.5);
		const r = computeAutocorrelation(t, y, null, null, 6);
		expect(Math.min(...r.lags)).toBeGreaterThanOrEqual(6);
	});

	it('caps the maximum lag at the requested maxLag', () => {
		const { t, y } = cosine(24, 240, 0.5);
		const r = computeAutocorrelation(t, y, null, 30);
		expect(Math.max(...r.lags)).toBeLessThanOrEqual(30);
	});

	it('correlations stay within [-1, 1] (up to tiny float slack)', () => {
		const { t, y } = cosine(24, 240, 0.5);
		const r = computeAutocorrelation(t, y);
		for (const c of r.correlations) {
			expect(c).toBeGreaterThanOrEqual(-1.01);
			expect(c).toBeLessThanOrEqual(1.01);
		}
	});
});

describe('computeAutocorrelation — non-uniform sampling path', () => {
	it('still detects periodicity with jittered sample times', () => {
		// Introduce non-uniform spacing > 10% deviation to trigger the time-pair path.
		const t = [];
		const y = [];
		let ti = 0;
		for (let i = 0; i < 400; i++) {
			t.push(ti);
			y.push(Math.cos((2 * Math.PI * ti) / 24));
			// alternate small/large steps so spacing is clearly non-uniform
			ti += i % 2 === 0 ? 0.3 : 0.8;
		}
		const r = computeAutocorrelation(t, y);
		expect(r.lags.length).toBeGreaterThan(0);
		const i24 = nearestLag(r.lags, 24);
		// Positive correlation near one period.
		expect(r.correlations[i24]).toBeGreaterThan(0.3);
	});
});

describe('computeAutocorrelation — degenerate / non-time X axis', () => {
	// A non-time / non-monotonic X (plain data wired into the time port) gives a
	// sample spacing dt <= 0 (or an explicit binSize of 0). Must return empty
	// cleanly rather than looping / producing garbage.
	it('does not throw and returns empty for all-equal times (dt = 0)', () => {
		let r;
		expect(() => (r = computeAutocorrelation([3, 3, 3, 3, 3], [1, 2, 3, 1, 2]))).not.toThrow();
		expect(r.lags).toEqual([]);
	});

	it('does not throw for decreasing (non-monotonic) times', () => {
		let r;
		expect(() => (r = computeAutocorrelation([5, 4, 3, 2, 1], [1, 2, 3, 4, 5]))).not.toThrow();
		expect(r.lags).toEqual([]);
	});

	it('returns empty for an explicit binSize of 0', () => {
		const r = computeAutocorrelation([0, 1, 2, 3, 4], [1, 2, 3, 4, 5], 0);
		expect(r.lags).toEqual([]);
	});
});
