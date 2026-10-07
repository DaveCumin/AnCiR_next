// FIT-8: intradaily variability (IV) with missing epochs.
//
// IV is the mean squared successive difference over the variance (Witting, Kwa, Eikelenboom,
// Mirmiran and Swaab 1990, Biol Psychiatry 27:563-572; Van Someren et al. 1999, Chronobiol Int
// 16:505-518, p.509): IV = [sum (x_i - x_{i-1})^2 / (n - 1)] / [sum (x_i - mean)^2 / n].
// With no gaps there are n - 1 successive pairs. computeNPCRA summed the squared differences
// over the valid PAIRS only but still divided by n - 1, so every missing epoch removed up to
// two pairs from the numerator and none from its divisor: IV fell in proportion to the missing
// epochs. The numerator is now divided by the number of valid pairs.
import { describe, it, expect } from 'vitest';
import { computeNPCRA } from './npcra.js';

// Deterministic white noise (true IV is about 2).
function noise(len, seed = 987654321) {
	let s = seed;
	return Array.from({ length: len }, () => {
		s = (1103515245 * s + 12345) & 0x7fffffff;
		return s / 0x7fffffff;
	});
}

describe('computeNPCRA IV with missing epochs (FIT-8)', () => {
	it('matches the textbook formula on a small hand case with one interior gap', () => {
		// Epochs: 1, 3, missing, 2, 6 (hourly). Valid x: 1, 3, 2, 6 (n 4, mean 3).
		// Valid successive pairs: (1,3), (2,6): squared diffs 4 + 16 = 20 over 2 pairs = 10.
		// Variance (n divisor): (4 + 0 + 1 + 9) / 4 = 3.5. IV = 10 / 3.5.
		const r = computeNPCRA([0, 1, 2, 3, 4], [1, 3, null, 2, 6], { epochHours: 1, period: 24 });
		expect(r.IV).toBeCloseTo(10 / 3.5, 12);
	});

	it('is unchanged by the fix with no gaps: n * diffSS / ((n - 1) * SS)', () => {
		const t = Array.from({ length: 24 * 10 }, (_, i) => i);
		const y = noise(t.length);
		const r = computeNPCRA(t, y, { epochHours: 1, period: 24 });
		const mean = y.reduce((a, b) => a + b, 0) / y.length;
		const ss = y.reduce((a, v) => a + (v - mean) ** 2, 0);
		let d = 0;
		for (let i = 1; i < y.length; i++) d += (y[i] - y[i - 1]) ** 2;
		expect(r.IV).toBeCloseTo((y.length * d) / ((y.length - 1) * ss), 12);
	});

	it('is not biased low when a third of the epochs are missing', () => {
		const t = Array.from({ length: 24 * 30 }, (_, i) => i);
		const y = noise(t.length);
		const full = computeNPCRA(t, y, { epochHours: 1, period: 24 });
		const holed = y.map((v, i) => (i % 3 === 1 ? null : v));
		const r = computeNPCRA(t, holed, { epochHours: 1, period: 24 });
		// The old divisor gave about full.IV / 3 here (one pair in three survives).
		expect(r.IV).toBeGreaterThan(0.85 * full.IV);
		expect(r.IV).toBeLessThan(1.15 * full.IV);
	});

	it('reports the fraction of missing epochs', () => {
		const t = Array.from({ length: 100 }, (_, i) => i);
		const y = noise(100).map((v, i) => (i % 10 === 3 || i % 10 === 7 ? null : v));
		expect(computeNPCRA(t, y, {}).missingEpochFraction).toBeCloseTo(0.2, 12);
		expect(computeNPCRA(t, noise(100), {}).missingEpochFraction).toBe(0);
	});
});
