// The correlogram's normalisation option, and the lag step on rounded times.
//
// AnCiR's correlogram divides each lag's sum of products by the pairs behind that lag (N - k
// on evenly spaced data). The standard sample ACF (R acf, MATLAB autocorr; Chatfield, The
// Analysis of Time Series, Sect. 4.1) divides by N, so its peaks are lower by (N - k) / N.
// Both are conventions; 'biased' is there to compare with published tools.
import { describe, it, expect } from 'vitest';
import { computeAutocorrelation, correlogramBand } from './correlogram.js';

const x5 = [2, 4, 6, 5, 3];
const t5 = [0, 1, 2, 3, 4];

describe('computeAutocorrelation normalization', () => {
	it("'biased' is R's acf, by hand: x = 2, 4, 6, 5, 3", () => {
		// mean 4, deviations -2, 0, 2, 1, -1, c0 = 10 / 5 = 2.
		// lag 1: (0 + 0 + 2 - 1) / 5 / 2 = 0.1; lag 2: (-4 + 0 - 2) / 5 / 2 = -0.6;
		// lag 3: (-2 + 0) / 5 / 2 = -0.2; lag 4: 2 / 5 / 2 = 0.2.
		// R 4.x: acf(c(2,4,6,5,3), lag.max = 4, plot = FALSE) gives 1.0 0.1 -0.6 -0.2 0.2.
		const r = computeAutocorrelation(t5, x5, null, 4, 0, { normalization: 'biased' });
		expect(r.lags).toEqual([0, 1, 2, 3, 4]);
		const want = [1, 0.1, -0.6, -0.2, 0.2];
		r.correlations.forEach((v, i) => expect(v).toBeCloseTo(want[i], 14));
		expect(r.normalization).toBe('biased');
	});

	it("the default 'pairs' divides by the N - k pairs instead (unchanged)", () => {
		const r = computeAutocorrelation(t5, x5, null, 4, 0);
		const want = [1, 0.125, -1, -0.5, 1];
		r.correlations.forEach((v, i) => expect(v).toBeCloseTo(want[i], 14));
		expect(r.normalization).toBe('pairs');
		// Unknown values fall back to the default.
		expect(computeAutocorrelation(t5, x5, null, 4, 0, { normalization: 'x' }).correlations).toEqual(
			r.correlations
		);
	});

	it("matches R's acf on a 48-point rhythmic series", () => {
		// x = round(cos(2 pi i / 24) + 0.3 sin(1.3 i), 4), i = 0..47;
		// acf(x, lag.max = 24, plot = FALSE) in R 4.x.
		const x = Array.from({ length: 48 }, (_, i) =>
			Number((Math.cos((2 * Math.PI * i) / 24) + 0.3 * Math.sin(i * 1.3)).toFixed(4))
		);
		const t = x.map((_, i) => i);
		const r = computeAutocorrelation(t, x, null, 24, 0, { normalization: 'biased' });
		expect(r.correlations[1]).toBeCloseTo(0.8826445681934437, 4);
		expect(r.correlations[12]).toBeCloseTo(-0.7496533444441179, 4);
		expect(r.correlations[24]).toBeCloseTo(0.4990456256820399, 4);
		// 'pairs' = 'biased' * N / (N - k).
		const p = computeAutocorrelation(t, x, null, 24, 0);
		for (let k = 1; k <= 24; k++) {
			expect(p.correlations[k]).toBeCloseTo((r.correlations[k] * 48) / (48 - k), 12);
		}
	});

	it("Bartlett's band is the same whichever normalisation is shown", () => {
		const x = Array.from({ length: 60 }, (_, i) => Math.sin(i / 3) + 0.1 * Math.cos(i * 2.1));
		const t = x.map((_, i) => i);
		const a = correlogramBand(computeAutocorrelation(t, x, null, 20, 0), { method: 'bartlett' });
		const b = correlogramBand(
			computeAutocorrelation(t, x, null, 20, 0, { normalization: 'biased' }),
			{ method: 'bartlett' }
		);
		a.upper.forEach((v, i) =>
			Number.isNaN(v) ? expect(b.upper[i]).toBeNaN() : expect(b.upper[i]).toBeCloseTo(v, 12)
		);
	});
});

describe('correlogram lag step on rounded times', () => {
	it('10-min data stored to 4 dp has lags at exactly k / 6 h, not k * 0.1667 h', () => {
		const t = Array.from({ length: 7 * 144 }, (_, k) => Math.round((k / 6) * 1e4) / 1e4);
		const y = t.map((h) => Math.cos((2 * Math.PI * h) / 24));
		const r = computeAutocorrelation(t, y, null, 168, 0);
		expect(r.dt).toBeCloseTo(1 / 6, 7);
		const k144 = r.lags.findIndex((l) => Math.abs(l - 24) < 0.05);
		expect(r.lags[k144]).toBeCloseTo(24, 5);
		// The last lag (1007 steps) is 167.8333 h; the rounded step put it at 167.867 h.
		expect(r.lags[r.lags.length - 1]).toBeCloseTo(1007 / 6, 4);
	});

	it('an explicit bin size is used as given', () => {
		const r = computeAutocorrelation(t5, x5, 1, 4, 0);
		expect(r.dt).toBe(1);
	});
});
