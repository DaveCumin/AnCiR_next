// @ts-nocheck
/**
 * SPEC-U4 (2026-10-03 review, "possible issue, not confirmed"): the FFT's phase output (the
 * `phase` port of the Rhythmicity node's FFT mode, the FFT plot's phase curve, fftPeak's phase)
 * was never checked against a reference.
 *
 * Verdict: REFUTED (kept as a guard). The phases are numpy's: angle(fft(y - mean(y)))[k], to
 * 1e-12, at even and odd lengths, and they carry the cosine convention of the magnitude: a
 * series A cos(2 pi f (t - t0) + phi) reads phase phi at its bin, and fftPeak reads phi off the
 * bin too. The time origin is the FIRST SAMPLE of the gridded series, not t = 0 (documented
 * here because a reader could expect clock time): the same wave sampled from t = 100 h reads
 * phi + 2 pi f 100 h.
 */
import { describe, it, expect } from 'vitest';
import { computeFFT, fftPeak } from './fft.js';

// numpy default_rng(7).normal(size=72), rounded to 4 dp.
const Y72 = [
	0.0012, 0.2987, -0.2741, -0.8906, -0.4547, -0.9916, 0.0601, 1.3402, -0.4922, -0.6205, 0.4898,
	0.3569, 0.1054, -0.9305, -0.0293, 0.6953, -1.3442, -0.4576, -1.9012, -1.2895, -1.8417, -0.2351,
	-1.2674, 0.2713, 0.1568, -0.1869, -2.5168, -0.5387, -0.0485, 0.1133, -1.5301, -0.4778, -0.9785,
	-0.8088, 1.0609, -0.8075, -0.0325, 0.8844, -0.5836, -0.1117, 0.1105, 0.0638, -1.2251, 0.0761,
	1.3588, -1.5471, 0.8594, 0.1194, -0.6415, 2.0004, 0.7623, -1.1993, 0.0745, 0.5767, -0.1888,
	0.6829, -0.0665, 0.6672, 1.4385, -0.6757, 0.2031, -0.4633, 0.1273, -1.1872, -0.5793, -0.1962,
	0.8988, 1.1452, -1.3235, -0.7946, 0.6469, -1.9924
];
// numpy 2.4.6: z = y - y.mean(); X = np.fft.fft(z); [k, angle(X[k]), 2|X[k]|/N].
const NUMPY = {
	72: [
		[1, 1.4862670354872671, 0.3874627192186282],
		[2, -1.6842537446595929, 0.20854060507506209],
		[3, -2.3372704791699666, 0.19643999876194648],
		[7, -2.9349631675082035, 0.19371720304168172],
		[35, -1.048901482746351, 0.2734565078807578]
	],
	71: [
		[1, 1.3178795325484736, 0.4058326931628923],
		[2, -1.4991496851100043, 0.1935010962661201],
		[3, -2.2584726419802577, 0.16333741392425716],
		[7, 2.711219149693842, 0.13917751449310908],
		[34, 0.037112492654200496, 0.17408209341397363]
	]
};

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

describe('SPEC-U4: FFT phase against numpy and a known sinusoid', () => {
	it.each([[72], [71]])('N = %i: phases and magnitudes equal numpy fft', (N) => {
		const y = Y72.slice(0, N);
		const r = computeFFT(
			y.map((_, i) => i),
			y
		);
		for (const [k, ang, mag] of NUMPY[N]) {
			// Bin k is index k - 1 (DC is not returned).
			expect(r.frequencies[k - 1]).toBeCloseTo(k / N, 12);
			expect(r.phases[k - 1]).toBeCloseTo(ang, 12);
			expect(r.magnitudes[k - 1]).toBeCloseTo(mag, 12);
		}
	});

	it('A cos(2 pi t / 24 + phi) on a bin reads phase phi, at the bin and from fftPeak', () => {
		const phi = 0.7;
		const t = Array.from({ length: 240 }, (_, i) => i);
		const y = t.map((ti) => 2 * Math.cos((2 * Math.PI * ti) / 24 + phi) + 5);
		const r = computeFFT(t, y);
		const k = r.frequencies.findIndex((f) => Math.abs(1 / f - 24) < 1e-9);
		expect(r.phases[k]).toBeCloseTo(phi, 10);
		const pk = fftPeak(r);
		expect(pk.period).toBeCloseTo(24, 6);
		expect(pk.phase).toBeCloseTo(phi, 6);
	});

	it('off a bin (25.3 h in 240 h), fftPeak still reads the true phase', () => {
		const phi = -2.1;
		const t = Array.from({ length: 240 }, (_, i) => i);
		const y = t.map((ti) => Math.cos((2 * Math.PI * ti) / 25.3 + phi));
		const pk = fftPeak(computeFFT(t, y));
		expect(pk.period).toBeCloseTo(25.3, 3);
		expect(wrap(pk.phase - phi)).toBeCloseTo(0, 3);
	});

	it('the phase origin is the first sample, not t = 0', () => {
		const phi = 0.4;
		const t0 = 100;
		const t = Array.from({ length: 240 }, (_, i) => t0 + i);
		const y = t.map((ti) => Math.cos((2 * Math.PI * ti) / 24 + phi));
		const r = computeFFT(t, y);
		const k = r.frequencies.findIndex((f) => Math.abs(1 / f - 24) < 1e-9);
		expect(wrap(r.phases[k] - (phi + (2 * Math.PI * t0) / 24))).toBeCloseTo(0, 10);
	});
});
