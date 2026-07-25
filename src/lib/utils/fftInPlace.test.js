import { describe, it, expect } from 'vitest';
import { fftInPlace, ifftInPlace, nextPowerOfTwo, computeFFT } from './fft.js';

/** Naive O(n^2) DFT — the independent reference the fast transform is checked against. */
function naiveDFT(re, im, inverse = false) {
	const n = re.length;
	const outRe = new Float64Array(n);
	const outIm = new Float64Array(n);
	const sign = inverse ? 1 : -1;
	for (let k = 0; k < n; k++) {
		let sRe = 0;
		let sIm = 0;
		for (let t = 0; t < n; t++) {
			const ang = (sign * 2 * Math.PI * k * t) / n;
			const c = Math.cos(ang);
			const s = Math.sin(ang);
			sRe += re[t] * c - im[t] * s;
			sIm += re[t] * s + im[t] * c;
		}
		outRe[k] = inverse ? sRe / n : sRe;
		outIm[k] = inverse ? sIm / n : sIm;
	}
	return { re: outRe, im: outIm };
}

describe('nextPowerOfTwo', () => {
	it('returns the smallest power of two at or above n', () => {
		expect(nextPowerOfTwo(1)).toBe(1);
		expect(nextPowerOfTwo(2)).toBe(2);
		expect(nextPowerOfTwo(3)).toBe(4);
		expect(nextPowerOfTwo(1000)).toBe(1024);
		expect(nextPowerOfTwo(1024)).toBe(1024);
	});

	it('is defensive about degenerate input', () => {
		expect(nextPowerOfTwo(0)).toBe(1);
		expect(nextPowerOfTwo(-5)).toBe(1);
		expect(nextPowerOfTwo(NaN)).toBe(1);
	});
});

describe('fftInPlace', () => {
	it('matches a naive DFT on a real signal', () => {
		const n = 32;
		const re = new Float64Array(n);
		const im = new Float64Array(n);
		for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 3 * i) / n) + 0.5 * i;
		const ref = naiveDFT(re, im);

		fftInPlace(re, im);
		for (let k = 0; k < n; k++) {
			expect(re[k]).toBeCloseTo(ref.re[k], 8);
			expect(im[k]).toBeCloseTo(ref.im[k], 8);
		}
	});

	it('matches a naive DFT on a complex signal', () => {
		const n = 16;
		const re = new Float64Array(n);
		const im = new Float64Array(n);
		for (let i = 0; i < n; i++) {
			re[i] = Math.cos(i) * 2;
			im[i] = Math.sin(i * 0.7);
		}
		const ref = naiveDFT(re, im);

		fftInPlace(re, im);
		for (let k = 0; k < n; k++) {
			expect(re[k]).toBeCloseTo(ref.re[k], 8);
			expect(im[k]).toBeCloseTo(ref.im[k], 8);
		}
	});

	it('puts a pure cosine in exactly one bin (and its mirror)', () => {
		const n = 64;
		const freqBin = 5;
		const re = new Float64Array(n);
		const im = new Float64Array(n);
		for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * freqBin * i) / n);

		fftInPlace(re, im);
		const mag = Array.from({ length: n }, (_, k) => Math.hypot(re[k], im[k]));
		// A length-n cosine of unit amplitude → n/2 in each of the two mirrored bins.
		expect(mag[freqBin]).toBeCloseTo(n / 2, 6);
		expect(mag[n - freqBin]).toBeCloseTo(n / 2, 6);
		for (let k = 0; k < n; k++) {
			if (k !== freqBin && k !== n - freqBin) expect(mag[k]).toBeLessThan(1e-9);
		}
	});

	it('a DC signal lands entirely in bin 0', () => {
		const n = 8;
		const re = new Float64Array(n).fill(3);
		const im = new Float64Array(n);
		fftInPlace(re, im);
		expect(re[0]).toBeCloseTo(24, 10);
		for (let k = 1; k < n; k++) expect(Math.hypot(re[k], im[k])).toBeLessThan(1e-9);
	});
});

describe('ifftInPlace', () => {
	it('round-trips a signal back to itself', () => {
		const n = 64;
		const original = Array.from({ length: n }, (_, i) => Math.sin(i / 3) * 10 + i * 0.25);
		const re = Float64Array.from(original);
		const im = new Float64Array(n);

		fftInPlace(re, im);
		ifftInPlace(re, im);

		for (let i = 0; i < n; i++) {
			expect(re[i]).toBeCloseTo(original[i], 8);
			expect(im[i]).toBeCloseTo(0, 8);
		}
	});

	it('matches a naive inverse DFT', () => {
		const n = 16;
		const re = Float64Array.from({ length: n }, (_, i) => i % 5);
		const im = Float64Array.from({ length: n }, (_, i) => (i % 3) - 1);
		const ref = naiveDFT(re, im, true);

		ifftInPlace(re, im);
		for (let k = 0; k < n; k++) {
			expect(re[k]).toBeCloseTo(ref.re[k], 8);
			expect(im[k]).toBeCloseTo(ref.im[k], 8);
		}
	});
});

describe('fftInPlace — guards', () => {
	it('throws on a non-power-of-two length', () => {
		expect(() => fftInPlace(new Float64Array(6), new Float64Array(6))).toThrow(/power of two/);
	});

	it('throws when re and im differ in length', () => {
		expect(() => fftInPlace(new Float64Array(8), new Float64Array(4))).toThrow(/same length/);
	});

	it('is a no-op below two samples rather than throwing', () => {
		expect(() => fftInPlace(new Float64Array(1), new Float64Array(1))).not.toThrow();
		expect(() => fftInPlace(new Float64Array(0), new Float64Array(0))).not.toThrow();
	});
});

describe('computeFFT still agrees with the new primitive', () => {
	// Guards the refactor: the public magnitude-spectrum path must be unchanged.
	it('finds the same dominant period as before for a 24 h rhythm', () => {
		// dt = 24/64 h over 256 samples (already a power of two, so no zero-padding):
		// 96 h span = exactly 4 cycles, and 1/24 falls exactly on bin k = 4. Choosing a
		// span that straddles bins would test the FFT's frequency resolution, not the
		// refactor.
		const dt = 24 / 64;
		const times = Array.from({ length: 256 }, (_, i) => i * dt);
		const values = times.map((t) => Math.cos((2 * Math.PI * t) / 24));
		const { frequencies, magnitudes } = computeFFT(times, values);
		let peak = 0;
		for (let i = 1; i < magnitudes.length; i++) if (magnitudes[i] > magnitudes[peak]) peak = i;
		expect(1 / frequencies[peak]).toBeCloseTo(24, 0);
	});
});
