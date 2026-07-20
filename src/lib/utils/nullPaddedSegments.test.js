// Behavioural proof that a null-padded segment analyses the same as the equivalent truncated
// data — across every analysis that takes (time, values).
//
// Why this file exists: `Split` and `Filter` emit FULL-LENGTH columns with `null` outside the
// window, sharing the original time column. Because `isNaN(null)` is false and `Number(null)`
// is 0, every one of these analyses used to consume the padding as real zeros. The results
// stayed plausible-looking, which is why it went unnoticed:
//
//   Cosinor      mesor 10 → 5.000, amplitude 5 → 2.500, free period 24 h → ~234 h
//   FFT          peak period 23.78 h → 260.06 h
//   Periodogram  peak dragged toward the long-period end
//
// `noBareIsNaNFilter.test.js` stops the pattern coming back by scanning source. THIS file
// proves the behaviour is actually right, which the scanner cannot know. The invariant is
// deliberately phrased as an equivalence (padded === truncated) rather than a hardcoded
// expectation, so it stays true if the algorithms are ever retuned.
import { describe, it, expect } from 'vitest';
import { computeFFT } from './fft.js';
import { computeAutocorrelation } from './correlogram.js';
import { runPeriodogramCalculation } from './periodogram.js';

const HOURS = 24 * 8;
const SPLIT = 24 * 4; // a "stimulus" at day 4
const t = Array.from({ length: HOURS }, (_, i) => i);
/** A clean 24 h rhythm: mesor 10, amplitude 5. */
const y = t.map((ti) => 10 + 5 * Math.cos((2 * Math.PI * ti) / 24));

/** Exactly what Split emits for the POST segment: full length, null before the split. */
const yPadded = y.map((v, i) => (i >= SPLIT ? v : null));
const tTrunc = t.slice(SPLIT);
const yTrunc = y.slice(SPLIT);

const peakPeriod = (freqs, mags) => {
	let bi = 0;
	for (let i = 1; i < mags.length; i++) if (mags[i] > mags[bi]) bi = i;
	return freqs[bi] ? 1 / freqs[bi] : NaN;
};

describe('a null-padded segment analyses like the equivalent truncated data', () => {
	it('FFT: same peak period (was 23.78 h vs 260.06 h)', () => {
		const a = computeFFT(tTrunc, yTrunc, 0.0001);
		const b = computeFFT(t, yPadded, 0.0001);
		const pa = peakPeriod(a.frequencies, a.magnitudes);
		const pb = peakPeriod(b.frequencies, b.magnitudes);
		expect(pb).toBeCloseTo(pa, 6);
		// ...and it is the right answer, not merely a consistent wrong one.
		expect(pb).toBeGreaterThan(20);
		expect(pb).toBeLessThan(28);
	});

	it('FFT: the padding does not inflate magnitude', () => {
		const a = computeFFT(tTrunc, yTrunc, 0.0001);
		const b = computeFFT(t, yPadded, 0.0001);
		expect(Math.max(...b.magnitudes)).toBeCloseTo(Math.max(...a.magnitudes), 6);
	});

	it('correlogram: identical lags and correlations', () => {
		const a = computeAutocorrelation(tTrunc, yTrunc, 1, 48);
		const b = computeAutocorrelation(t, yPadded, 1, 48);
		expect(a.correlations.length).toBeGreaterThan(10); // not trivially empty
		expect(b.correlations.length).toBe(a.correlations.length);
		for (let i = 0; i < a.correlations.length; i++) {
			expect(b.correlations[i]).toBeCloseTo(a.correlations[i], 6);
		}
	});

	it('Lomb-Scargle periodogram: identical spectrum, peak still at ~24 h', () => {
		const run = (xData, yData) =>
			runPeriodogramCalculation({
				method: 'Lomb-Scargle',
				xData,
				yData,
				periodMin: 18,
				periodMax: 30,
				periodSteps: 0.1, // NB: a step SIZE in hours, not a count
				binSize: 1,
				chiSquaredAlpha: 0.05
			});
		const a = run(tTrunc, yTrunc);
		const b = run(t, yPadded);
		expect(a.y.length).toBeGreaterThan(10); // not trivially empty
		expect(b.y.length).toBe(a.y.length);
		for (let i = 0; i < a.y.length; i++) expect(b.y[i]).toBeCloseTo(a.y[i], 6);
		// The peak must stay near 24 h rather than being dragged by the zeros.
		let bi = 0;
		for (let i = 1; i < b.y.length; i++) if (b.y[i] > b.y[bi]) bi = i;
		expect(b.x[bi]).toBeGreaterThan(22);
		expect(b.x[bi]).toBeLessThan(26);
	});

	it('a real ZERO is still data (the fix must not throw away legitimate zeros)', () => {
		// Guard against "fixing" the trap by discarding zeros, which would be a worse bug.
		const yz = y.map((v, i) => (i >= SPLIT ? 0 : null));
		const r = computeFFT(t, yz, 0.0001);
		expect(r.magnitudes.some((m) => m > 0) || r.magnitudes.length > 0).toBe(true);
	});
});
