import { describe, it, expect } from 'vitest';
import { computeFFT } from './fft.js';

// Build a uniformly-sampled signal: sum of cosines.
function makeSignal(components, durationH, stepH) {
	const t = [];
	const y = [];
	for (let ti = 0; ti <= durationH; ti += stepH) {
		t.push(ti);
		let v = 0;
		for (const { amp, periodH, phase = 0 } of components) {
			v += amp * Math.cos((2 * Math.PI * ti) / periodH + phase);
		}
		y.push(v);
	}
	return { t, y };
}

describe('computeFFT — guard clauses', () => {
	it('returns empty result for empty input', () => {
		const r = computeFFT([], []);
		expect(r.frequencies).toEqual([]);
		expect(r.magnitudes).toEqual([]);
		expect(r.phases).toEqual([]);
		expect(r.samplingRate).toBe(0);
		expect(r.nyquistFreq).toBe(0);
		expect(r.minPeriod).toBe(0);
	});

	it('returns empty result for a single sample', () => {
		expect(computeFFT([0], [1]).frequencies).toEqual([]);
	});

	it('returns empty result for mismatched-length arrays', () => {
		expect(computeFFT([0, 1, 2], [0, 1]).frequencies).toEqual([]);
	});

	it('returns empty result when null is passed', () => {
		expect(computeFFT(null, null).frequencies).toEqual([]);
		expect(computeFFT([0, 1], null).frequencies).toEqual([]);
	});

	it('returns empty result when every sample is NaN', () => {
		const r = computeFFT([NaN, NaN, NaN, NaN], [1, 2, 3, 4]);
		expect(r.frequencies).toEqual([]);
	});
});

describe('computeFFT — sampling metadata', () => {
	it('reports samplingRate, nyquistFreq and minPeriod consistent with dt', () => {
		const { t, y } = makeSignal([{ amp: 1, periodH: 24 }], 96, 0.5);
		const r = computeFFT(t, y);
		// dt = 0.5h → samplingRate = 2/hr, nyquist = 1/hr, minPeriod = 1h
		expect(r.samplingRate).toBeCloseTo(2, 10);
		expect(r.nyquistFreq).toBeCloseTo(1, 10);
		expect(r.minPeriod).toBeCloseTo(1, 10);
	});

	it('never returns a frequency above the Nyquist frequency', () => {
		const { t, y } = makeSignal([{ amp: 1, periodH: 24 }], 96, 0.5);
		const r = computeFFT(t, y);
		for (const f of r.frequencies) expect(f).toBeLessThanOrEqual(r.nyquistFreq);
	});
});

describe('computeFFT — spectral identities', () => {
	it('a pure cosine produces a single dominant peak at its frequency', () => {
		// Long record so the FFT bin resolution lands near 1/24.
		const periodH = 24;
		const { t, y } = makeSignal([{ amp: 3, periodH }], 24 * 40, 0.5);
		const r = computeFFT(t, y);

		const peakIdx = r.magnitudes.indexOf(Math.max(...r.magnitudes));
		const peakFreq = r.frequencies[peakIdx];
		// Recovered period within one FFT bin of 24h.
		expect(1 / peakFreq).toBeGreaterThan(22);
		expect(1 / peakFreq).toBeLessThan(26);

		// The peak should dominate: far larger than the median magnitude.
		const sorted = [...r.magnitudes].sort((a, b) => a - b);
		const median = sorted[Math.floor(sorted.length / 2)];
		expect(r.magnitudes[peakIdx]).toBeGreaterThan(median * 10);
	});

	it('separates two well-spaced frequency components into two peaks', () => {
		const { t, y } = makeSignal(
			[
				{ amp: 2, periodH: 24 },
				{ amp: 1, periodH: 8 }
			],
			24 * 40,
			0.25
		);
		const r = computeFFT(t, y);

		// Index of nearest frequency bin to a target period.
		const nearest = (periodH) => {
			const target = 1 / periodH;
			let best = 0;
			for (let i = 1; i < r.frequencies.length; i++) {
				if (Math.abs(r.frequencies[i] - target) < Math.abs(r.frequencies[best] - target)) best = i;
			}
			return best;
		};

		const i24 = nearest(24);
		const i8 = nearest(8);
		// Both components must carry meaningful energy, and the 24h (amp 2) bin
		// must be larger than the 8h (amp 1) bin.
		expect(r.magnitudes[i24]).toBeGreaterThan(0.5);
		expect(r.magnitudes[i8]).toBeGreaterThan(0.25);
		expect(r.magnitudes[i24]).toBeGreaterThan(r.magnitudes[i8]);
	});

	it('detrends a DC offset away (constant offset does not create a peak)', () => {
		const { t, y } = makeSignal([{ amp: 1, periodH: 24 }], 24 * 20, 0.5);
		const yOffset = y.map((v) => v + 1000);
		const r1 = computeFFT(t, y);
		const r2 = computeFFT(t, yOffset);
		// Mean removal means the spectra are essentially identical.
		for (let i = 0; i < r1.magnitudes.length; i++) {
			expect(r2.magnitudes[i]).toBeCloseTo(r1.magnitudes[i], 6);
		}
	});

	it('frequencies are strictly increasing', () => {
		const { t, y } = makeSignal([{ amp: 1, periodH: 24 }], 96, 0.5);
		const r = computeFFT(t, y);
		for (let i = 1; i < r.frequencies.length; i++) {
			expect(r.frequencies[i]).toBeGreaterThan(r.frequencies[i - 1]);
		}
	});

	it('honours an explicit freqStep by increasing transform resolution', () => {
		const { t, y } = makeSignal([{ amp: 1, periodH: 24 }], 96, 0.5);
		const coarse = computeFFT(t, y, null);
		const fine = computeFFT(t, y, 0.001);
		// A finer frequency step pads to a larger FFT → more frequency bins.
		expect(fine.frequencies.length).toBeGreaterThan(coarse.frequencies.length);
	});
});
