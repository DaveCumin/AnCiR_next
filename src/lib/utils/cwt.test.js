import { describe, it, expect } from 'vitest';
import {
	cwt,
	cwtFromSeries,
	buildScales,
	globalWaveletSpectrum,
	waveletRidge,
	WAVELETS
} from './cwt.js';

const DT = 0.25; // 15-minute sampling, the usual actigraphy resolution

/** Uniformly sampled cosine of the given period. */
function sine(n, dt, periodHrs, amp = 1, phase = 0) {
	return Array.from(
		{ length: n },
		(_, i) => amp * Math.cos((2 * Math.PI * i * dt) / periodHrs + phase)
	);
}

/** Index of the maximum-power scale at one time point. */
function peakIndexAt(r, i) {
	let best = 0;
	for (let j = 1; j < r.power.length; j++) if (r.power[j][i] > r.power[best][i]) best = j;
	return best;
}

describe('buildScales', () => {
	it('is log2-spaced with the requested resolution', () => {
		const s = buildScales(DT, 1024, { dj: 0.25 });
		expect(s.length).toBeGreaterThan(4);
		for (let i = 1; i < s.length; i++) expect(s[i] / s[i - 1]).toBeCloseTo(2 ** 0.25, 10);
	});

	it('starts at 2*dt by default (the Nyquist-limited smallest scale)', () => {
		expect(buildScales(DT, 512)[0]).toBeCloseTo(2 * DT, 12);
	});

	it('honours an explicit s0 and step count', () => {
		const s = buildScales(DT, 512, { s0: 4, dj: 0.5, j1: 3 });
		expect(s).toHaveLength(4);
		expect(s[0]).toBeCloseTo(4, 12);
		expect(s[3]).toBeCloseTo(4 * 2 ** 1.5, 10);
	});
});

describe('cwt — recovers a known period', () => {
	// The defining property: for a pure sinusoid the maximum-power period, read
	// away from the cone of influence, is the sinusoid's period.
	it.each([12, 24, 36])(
		'finds a %i h rhythm at the midpoint (unrectified = the unbiased estimator)',
		(periodHrs) => {
			const n = 4096;
			const r = cwt(sine(n, DT, periodHrs), DT, { dj: 0.01, rectify: false });
			expect(r.valid).toBe(true);
			const found = r.periods[peakIndexAt(r, Math.floor(n / 2))];
			// Within half a percent — comfortably inside one 0.7% grid step.
			expect(Math.abs(found / periodHrs - 1)).toBeLessThan(0.005);
		}
	);

	it.each([12, 24, 36])(
		'finds a %i h rhythm under rectification too, with a small documented low bias',
		(periodHrs) => {
			// Dividing by scale tilts the response toward shorter scales, so the
			// argmax sits ~1-2% low. That is the price of cross-scale comparability;
			// callers estimating tau precisely should pass rectify: false.
			const n = 4096;
			const r = cwt(sine(n, DT, periodHrs), DT, { dj: 0.01 });
			const found = r.periods[peakIndexAt(r, Math.floor(n / 2))];
			expect(found).toBeLessThan(periodHrs); // biased low, not high
			expect(Math.abs(found / periodHrs - 1)).toBeLessThan(0.025);
		}
	);

	it('tracks a period that CHANGES over time (the whole point of a CWT)', () => {
		// Two concatenated halves: 24 h then 12 h. A Fourier spectrum would show
		// both and say nothing about when; the CWT must localise them.
		const half = 2048;
		const a = sine(half, DT, 24);
		const b = Array.from({ length: half }, (_, i) => Math.cos((2 * Math.PI * i * DT) / 12));
		const r = cwt([...a, ...b], DT, { dj: 0.02 });

		const early = r.periods[peakIndexAt(r, Math.floor(half * 0.5))];
		const late = r.periods[peakIndexAt(r, Math.floor(half * 1.5))];
		expect(Math.abs(early / 24 - 1)).toBeLessThan(0.05);
		expect(Math.abs(late / 12 - 1)).toBeLessThan(0.05);
	});

	it('separates two simultaneous rhythms into two peaks', () => {
		const n = 4096;
		const y = sine(n, DT, 24).map((v, i) => v + sine(n, DT, 8)[i]);
		const g = globalWaveletSpectrum(cwt(y, DT, { dj: 0.05 }).power);
		const r = cwt(y, DT, { dj: 0.05 });
		// Both target periods should be local maxima of the global spectrum.
		const near = (p) =>
			r.periods.reduce((b, v, i) => (Math.abs(v - p) < Math.abs(r.periods[b] - p) ? i : b), 0);
		const i24 = near(24);
		const i8 = near(8);
		expect(g[i24]).toBeGreaterThan(g[i24 - 3]);
		expect(g[i24]).toBeGreaterThan(g[i24 + 3]);
		expect(g[i8]).toBeGreaterThan(g[i8 - 3]);
		expect(g[i8]).toBeGreaterThan(g[i8 + 3]);
	});
});

describe('cwt — bias rectification', () => {
	// Liu et al. (2007): raw |W|^2 scales with s, so without rectification a long
	// period always outshines an equally strong short one.
	it('makes equal-amplitude rhythms at 12 h and 24 h comparable in power', () => {
		const n = 4096;
		const p12 = Math.max(...globalWaveletSpectrum(cwt(sine(n, DT, 12), DT).power));
		const p24 = Math.max(...globalWaveletSpectrum(cwt(sine(n, DT, 24), DT).power));
		expect(p24 / p12).toBeGreaterThan(0.5);
		expect(p24 / p12).toBeLessThan(2);
	});

	it('without rectification the longer period is roughly twice as strong', () => {
		const n = 4096;
		const opts = { rectify: false };
		const p12 = Math.max(...globalWaveletSpectrum(cwt(sine(n, DT, 12), DT, opts).power));
		const p24 = Math.max(...globalWaveletSpectrum(cwt(sine(n, DT, 24), DT, opts).power));
		expect(p24 / p12).toBeGreaterThan(1.5);
	});

	it('power scales with the square of amplitude', () => {
		const n = 2048;
		const p1 = Math.max(...globalWaveletSpectrum(cwt(sine(n, DT, 24, 1), DT).power));
		const p3 = Math.max(...globalWaveletSpectrum(cwt(sine(n, DT, 24, 3), DT).power));
		expect(p3 / p1).toBeCloseTo(9, 0);
	});

	it('a constant series carries essentially no power (the mean is removed)', () => {
		const r = cwt(new Array(512).fill(7), DT);
		expect(r.valid).toBe(true);
		expect(Math.max(...globalWaveletSpectrum(r.power))).toBeLessThan(1e-12);
	});
});

describe('cwt — cone of influence', () => {
	it('is zero at the edges and largest in the middle', () => {
		const n = 512;
		const { coi } = cwt(sine(n, DT, 24), DT);
		expect(coi[0]).toBeLessThan(1e-6);
		expect(coi[n - 1]).toBeLessThan(1e-6);
		expect(coi[Math.floor(n / 2)]).toBeGreaterThan(coi[10]);
	});

	it('grows linearly away from each edge', () => {
		const { coi } = cwt(sine(512, DT, 24), DT);
		expect(coi[20] / coi[10]).toBeCloseTo(2, 1);
	});

	it('is symmetric', () => {
		const n = 512;
		const { coi } = cwt(sine(n, DT, 24), DT);
		expect(coi[7]).toBeCloseTo(coi[n - 8], 10);
	});
});

describe('waveletRidge', () => {
	it('reports the dominant period per time point and skips the COI', () => {
		const n = 2048;
		const r = cwt(sine(n, DT, 24), DT, { dj: 0.02 });
		const { ridgePeriod, ridgePower } = waveletRidge(r);
		expect(ridgePeriod).toHaveLength(n);
		const mid = Math.floor(n / 2);
		expect(Math.abs(ridgePeriod[mid] / 24 - 1)).toBeLessThan(0.05);
		expect(ridgePower[mid]).toBeGreaterThan(0);
		// At the very edge the COI swallows every scale, so there is no honest answer.
		expect(Number.isNaN(ridgePeriod[0])).toBe(true);
	});

	it('follows a period change', () => {
		const half = 2048;
		const y = [
			...sine(half, DT, 24),
			...Array.from({ length: half }, (_, i) => Math.cos((2 * Math.PI * i * DT) / 12))
		];
		const r = cwt(y, DT, { dj: 0.02 });
		const { ridgePeriod } = waveletRidge(r);
		expect(ridgePeriod[Math.floor(half * 0.5)]).toBeGreaterThan(18);
		expect(ridgePeriod[Math.floor(half * 1.5)]).toBeLessThan(18);
	});

	it('is safe on an empty transform', () => {
		expect(waveletRidge({ periods: [], power: [], coi: [] })).toEqual({
			ridgePeriod: [],
			ridgePower: []
		});
	});
});

describe('globalWaveletSpectrum', () => {
	it('averages each scale over time', () => {
		expect(
			globalWaveletSpectrum([
				[1, 3],
				[10, 20]
			])
		).toEqual([2, 15]);
	});
	it('ignores non-finite cells', () => {
		expect(globalWaveletSpectrum([[2, NaN, 4]])).toEqual([3]);
	});
	it('is safe on empty input', () => {
		expect(globalWaveletSpectrum([])).toEqual([]);
		expect(globalWaveletSpectrum(null)).toEqual([]);
	});
});

describe('cwt — wavelet families', () => {
	it.each(WAVELETS)('%s recovers a 24 h rhythm', (wavelet) => {
		const n = 4096;
		const r = cwt(sine(n, DT, 24), DT, { wavelet, dj: 0.02 });
		expect(r.valid).toBe(true);
		const found = r.periods[peakIndexAt(r, Math.floor(n / 2))];
		// Paul and DOG are broader in frequency than Morlet, so allow more slack.
		expect(Math.abs(found / 24 - 1)).toBeLessThan(0.15);
	});

	it('rejects an unknown wavelet rather than silently defaulting', () => {
		const r = cwt(sine(512, DT, 24), DT, { wavelet: 'daubechies' });
		expect(r.valid).toBe(false);
		expect(r.reason).toMatch(/unknown wavelet/);
	});
});

describe('cwt — guards', () => {
	it('needs at least four samples', () => {
		const r = cwt([1, 2, 3], DT);
		expect(r.valid).toBe(false);
		expect(r.reason).toMatch(/at least 4/);
	});

	it('rejects a non-positive or non-finite dt', () => {
		expect(cwt(sine(64, DT, 24), 0).valid).toBe(false);
		expect(cwt(sine(64, DT, 24), -1).valid).toBe(false);
		expect(cwt(sine(64, DT, 24), NaN).valid).toBe(false);
	});

	it('rejects non-array input without throwing', () => {
		expect(cwt(null, DT).valid).toBe(false);
		expect(cwt(undefined, DT).valid).toBe(false);
	});

	it('needs four FINITE samples, not just four entries', () => {
		const r = cwt([1, NaN, NaN, NaN, NaN, 2], DT);
		expect(r.valid).toBe(false);
		expect(r.reason).toMatch(/finite/);
	});

	it('reports when no scale survives the period range', () => {
		const r = cwt(sine(512, DT, 24), DT, { periodRange: [1e6, 2e6] });
		expect(r.valid).toBe(false);
		expect(r.reason).toMatch(/period range/);
	});

	it('restricts the output to a requested period range', () => {
		const r = cwt(sine(2048, DT, 24), DT, { periodRange: [20, 28] });
		expect(r.valid).toBe(true);
		expect(Math.min(...r.periods)).toBeGreaterThanOrEqual(20);
		expect(Math.max(...r.periods)).toBeLessThanOrEqual(28);
	});

	it('tolerates gaps (NaNs) without throwing', () => {
		const y = sine(1024, DT, 24);
		for (let i = 300; i < 340; i++) y[i] = NaN;
		const r = cwt(y, DT, { dj: 0.05 });
		expect(r.valid).toBe(true);
		expect(r.power.every((row) => row.every(Number.isFinite))).toBe(true);
	});
});

describe('cwtFromSeries', () => {
	it('derives dt from the timestamps', () => {
		const n = 1024;
		const times = Array.from({ length: n }, (_, i) => i * DT);
		const r = cwtFromSeries(times, sine(n, DT, 24), { dj: 0.02 });
		expect(r.valid).toBe(true);
		expect(r.dt).toBeCloseTo(DT, 10);
		expect(r.times).toHaveLength(n);
		const found = r.periods[peakIndexAt(r, Math.floor(n / 2))];
		expect(Math.abs(found / 24 - 1)).toBeLessThan(0.05);
	});

	it('REFUSES unevenly sampled data instead of computing nonsense', () => {
		// The trap this guard exists for: the CWT assumes uniform dt, and
		// irregular timestamps violate it silently rather than erroring.
		const times = [0, 0.25, 0.5, 2.0, 2.25, 5.0, 5.25, 5.5, 9, 9.25];
		const r = cwtFromSeries(times, sine(10, DT, 24));
		expect(r.valid).toBe(false);
		expect(r.reason).toMatch(/not uniform/);
	});

	it('accepts small jitter within the tolerance', () => {
		const n = 512;
		const times = Array.from({ length: n }, (_, i) => i * DT + (i % 2 ? 1e-4 : 0));
		expect(cwtFromSeries(times, sine(n, DT, 24)).valid).toBe(true);
	});

	it('rejects a non-increasing time axis', () => {
		const times = Array.from({ length: 64 }, (_, i) => -i * DT);
		const r = cwtFromSeries(times, sine(64, DT, 24));
		expect(r.valid).toBe(false);
		expect(r.reason).toMatch(/not increasing/);
	});

	it('rejects mismatched or too-short input', () => {
		expect(cwtFromSeries([1, 2, 3], [1, 2]).valid).toBe(false);
		expect(cwtFromSeries(null, null).valid).toBe(false);
	});
});
