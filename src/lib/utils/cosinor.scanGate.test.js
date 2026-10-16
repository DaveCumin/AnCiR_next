// The free-period cosinor seeds its fit from a periodogram scan, and records longer than
// SCAN_MAX_POINTS (10,000) are averaged into bins for that scan only (cosinor.js). The fit
// itself always uses every point, so crossing the gate may change the starting guesses but
// must not change the answer: a record a few points either side of 10,000 gives the same
// fitted rhythm. Realistic data: one-minute samples with jitter, blank rows dropped (as the
// nodes drop them) in a run and singly, a dominant 24 h rhythm plus a 12 h harmonic and
// noise, so the scan has more than one peak to seed from.
import { describe, it, expect } from 'vitest';
import { fitCosineCurves } from './cosinor.js';

function record(n) {
	let s = 7;
	const rnd = () => {
		s = (s * 1103515245 + 12345) % 2147483648;
		return s / 2147483648 - 0.5;
	};
	const t = [];
	const y = [];
	for (let i = 0; i < n; i++) {
		if (i % 211 === 17 || (i >= 4000 && i < 4090)) continue; // blank rows, dropped
		const h = (i + 0.2 * rnd()) / 60;
		t.push(h);
		y.push(
			50 +
				20 * Math.cos((2 * Math.PI * (h - 14)) / 24) +
				6 * Math.cos((2 * Math.PI * h) / 12) +
				5 * rnd()
		);
	}
	return { t, y };
}

function fit(n, N) {
	const { t, y } = record(n);
	const r = fitCosineCurves(t, y, N, { minPeriod: 4, maxPeriod: 36 });
	const periods = r.parameters.cosines
		.map((c) => (2 * Math.PI) / c.frequency)
		.sort((a, b) => b - a);
	return { valid: t.length, periods, rSquared: r.rSquared };
}

describe('free-period cosinor on both sides of the 10,000-point scan gate', () => {
	for (const N of [1, 2]) {
		it(`${N} curve(s)`, { timeout: 120_000 }, () => {
			const below = fit(10_050, N);
			const above = fit(10_200, N);
			expect(below.valid).toBeLessThanOrEqual(10_000);
			expect(above.valid).toBeGreaterThan(10_000);
			const truth = N === 1 ? [24] : [24, 12];
			for (const r of [below, above]) {
				r.periods.forEach((p, k) => expect(Math.abs(p - truth[k])).toBeLessThan(0.05));
			}
			below.periods.forEach((p, k) => expect(Math.abs(p - above.periods[k])).toBeLessThan(0.02));
			expect(Math.abs(below.rSquared - above.rSquared)).toBeLessThan(0.01);
		});
	}
});
