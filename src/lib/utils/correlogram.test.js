import { describe, it, expect } from 'vitest';
import { computeAutocorrelation, findAutocorrelationPeak } from './correlogram.js';

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

// ---------------------------------------------------------------------------
// Peak of the correlogram. See the convention comment on findAutocorrelationPeak
// in correlogram.js: this is the dominant PERIOD, so it is neither lag 0 (always
// exactly 1) nor the largest |r| (a rhythm is anti-correlated with itself at P/2)
// nor the plain maximum over non-zero lags (which drifts to 2P, 3P … because the
// long lags are normalised by ever fewer overlapping pairs).
// ---------------------------------------------------------------------------
describe('findAutocorrelationPeak', () => {
	it('reports the fundamental period of a clean 24 h rhythm, not lag 0', () => {
		const { t, y } = cosine(24, 24 * 8, 1);
		const r = computeAutocorrelation(t, y);
		expect(r.correlations[0]).toBeCloseTo(1, 12); // lag 0 is 1 by definition
		expect(r.peakLag).toBe(24);
		expect(r.peakCorrelation).toBeGreaterThan(0.99);
	});

	it('is not sign-blind: the r = -1 antiphase lag is not the peak', () => {
		// A textbook rhythmic correlogram: exactly -1 at half a period and +0.9 at
		// the period. The largest |r| away from lag 0 is the antiphase trough, and
		// the cross-correlation convention would report lag 12 with r = -1. That is
		// the same single rhythm seen upside down, so the peak here is lag 24.
		const lags = [0, 6, 12, 18, 24, 30];
		const corrs = [1, 0, -1, 0, 0.9, 0];
		const p = findAutocorrelationPeak(lags, corrs);
		expect(p).toMatchObject({ lag: 24, correlation: 0.9 });
		// The rejected candidate really is the strongest association present.
		expect(Math.abs(corrs[2])).toBeGreaterThan(Math.abs(p.correlation));
	});

	it('reads a real 24 h rhythm the same way', () => {
		const { t, y } = cosine(24, 24 * 8, 1);
		const r = computeAutocorrelation(t, y);
		expect(r.correlations[nearestLag(r.lags, 12)]).toBeLessThan(-0.99);
		expect(r.peakLag).toBe(24);
		expect(r.peakCorrelation).toBeGreaterThan(0.99);
	});

	it('picks the fundamental over a repeat whose correlation is numerically larger', () => {
		// 12 h rhythm, hourly, five days. The repeats at 24/36 h are computed from
		// fewer overlapping pairs and come out ABOVE the one at 12 h, so a plain
		// maximum over non-zero lags reports 36 h. The first positive lobe is 12 h.
		const { t, y } = cosine(12, 24 * 5 - 1, 1);
		const r = computeAutocorrelation(t, y);
		const at = (lag) => r.correlations[nearestLag(r.lags, lag)];
		expect(at(36)).toBeGreaterThan(at(12));
		expect(r.peakLag).toBe(12);
	});

	it('breaks an exact tie inside the lobe towards the smaller lag', () => {
		// A correlogram handed in directly, so the tie is exact rather than
		// approximate: lags 5 and 7 carry the identical correlation.
		const lags = [0, 1, 2, 3, 4, 5, 6, 7, 8];
		const corrs = [1, 0.5, -0.2, -0.6, -0.1, 0.8, 0.8, 0.8, -0.3];
		expect(findAutocorrelationPeak(lags, corrs)).toMatchObject({ lag: 5, correlation: 0.8 });
	});

	it('ignores a float-wobble win of a few ulps', () => {
		const lags = [0, 1, 2, 3, 4, 5];
		const corrs = [1, -0.5, 0.9, 0.9 + 1e-15, 0.9, -0.2];
		expect(findAutocorrelationPeak(lags, corrs).lag).toBe(2);
	});

	it('takes the largest non-zero-lag correlation when there is no lobe to read', () => {
		// A ramp: the correlogram decays monotonically and never comes back up, so
		// there is no first lobe. The honest answer is the strongest repeat present.
		const t = [];
		const y = [];
		for (let i = 0; i < 20; i++) {
			t.push(i);
			y.push(i);
		}
		const r = computeAutocorrelation(t, y);
		expect(r.peakLag).toBe(1);
		expect(r.peakCorrelation).toBeCloseTo(r.correlations[1], 12);
	});

	it('returns null when there is no non-zero lag to read', () => {
		expect(findAutocorrelationPeak([], [])).toBe(null);
		expect(findAutocorrelationPeak([0], [1])).toBe(null);
	});

	it('skips non-finite correlations', () => {
		expect(findAutocorrelationPeak([0, 1, 2, 3], [1, NaN, -0.5, 0.4])).toMatchObject({ lag: 3 });
	});
});
