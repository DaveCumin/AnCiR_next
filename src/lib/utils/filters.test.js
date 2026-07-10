import { describe, it, expect } from 'vitest';
import { fftFilter, fftInPlace, nextPow2 } from './filters.js';

// Project a series onto the pure sine at DFT bin k (length n) and return its
// amplitude, i.e. (2/n)·Σ y[i]·sin(2π k i / n). For a signal that is exactly a
// sin of unit amplitude at that bin this returns ~1; for a component that has
// been removed it returns ~0.
function sineAmplitude(y, k, n) {
	let s = 0;
	for (let i = 0; i < n; i++) s += y[i] * Math.sin((2 * Math.PI * k * i) / n);
	return (2 / n) * s;
}

const N = 64;
// Three pure tones on exact DFT bins so there is no spectral leakage:
//   k=8  → normalized freq 2·8/64  = 0.25 (low tone)
//   k=16 → normalized freq 2·16/64 = 0.50 (middle tone)
//   k=24 → normalized freq 2·24/64 = 0.75 (high tone)
const K_LOW = 8;
const K_MID = 16;
const K_HIGH = 24;
const tone = (k) => Array.from({ length: N }, (_, i) => Math.sin((2 * Math.PI * k * i) / N));
const add = (...arrs) => arrs[0].map((_, i) => arrs.reduce((s, a) => s + a[i], 0));

describe('nextPow2', () => {
	it('returns the next power of two >= n', () => {
		expect(nextPow2(1)).toBe(1);
		expect(nextPow2(2)).toBe(2);
		expect(nextPow2(3)).toBe(4);
		expect(nextPow2(64)).toBe(64);
		expect(nextPow2(65)).toBe(128);
		expect(nextPow2(1000)).toBe(1024);
	});
	it('clamps n <= 0 to 1', () => {
		expect(nextPow2(0)).toBe(1);
		expect(nextPow2(-5)).toBe(1);
	});
});

describe('fftInPlace round-trip', () => {
	it('forward then inverse recovers the original signal', () => {
		const re = [1, 2, 3, 4, 5, 6, 7, 8];
		const im = new Array(8).fill(0);
		const re0 = [...re];
		fftInPlace(re, im, false);
		fftInPlace(re, im, true);
		for (let i = 0; i < 8; i++) {
			expect(re[i]).toBeCloseTo(re0[i], 9);
			expect(im[i]).toBeCloseTo(0, 9);
		}
	});
	it('matches a naive DFT of a known signal', () => {
		// Pure cos at bin 1 of length 4 → spectrum has energy only at k=1 and k=3.
		const re = [1, 0, -1, 0];
		const im = [0, 0, 0, 0];
		fftInPlace(re, im, false);
		// DFT: X[0]=0, X[1]=2, X[2]=0, X[3]=2 (all real).
		expect(re[0]).toBeCloseTo(0, 9);
		expect(re[1]).toBeCloseTo(2, 9);
		expect(re[2]).toBeCloseTo(0, 9);
		expect(re[3]).toBeCloseTo(2, 9);
	});
});

describe('fftFilter — two/three-tone separation', () => {
	it('low-pass keeps the low tone and removes the high tone', () => {
		const y = add(tone(K_LOW), tone(K_HIGH));
		const out = fftFilter(y, { type: 'low', high: 0.5 });
		expect(sineAmplitude(out, K_LOW, N)).toBeCloseTo(1, 9);
		expect(sineAmplitude(out, K_HIGH, N)).toBeCloseTo(0, 9);
	});

	it('high-pass keeps the high tone and removes the low tone', () => {
		const y = add(tone(K_LOW), tone(K_HIGH));
		const out = fftFilter(y, { type: 'high', low: 0.5 });
		expect(sineAmplitude(out, K_HIGH, N)).toBeCloseTo(1, 9);
		expect(sineAmplitude(out, K_LOW, N)).toBeCloseTo(0, 9);
	});

	it('band-pass keeps the middle tone and removes both edges', () => {
		const y = add(tone(K_LOW), tone(K_MID), tone(K_HIGH));
		const out = fftFilter(y, { type: 'band', low: 0.4, high: 0.6 });
		expect(sineAmplitude(out, K_MID, N)).toBeCloseTo(1, 9);
		expect(sineAmplitude(out, K_LOW, N)).toBeCloseTo(0, 9);
		expect(sineAmplitude(out, K_HIGH, N)).toBeCloseTo(0, 9);
	});
});

describe('fftFilter — DC / mean handling', () => {
	it('low-pass that spans DC preserves the signal offset', () => {
		const offset = 5;
		const y = tone(K_LOW).map((v) => v + offset);
		const out = fftFilter(y, { type: 'low', high: 0.5 });
		const meanOut = out.reduce((s, v) => s + v, 0) / N;
		expect(meanOut).toBeCloseTo(offset, 9);
	});

	it('high-pass removes the DC offset (zero-mean output)', () => {
		const y = tone(K_HIGH).map((v) => v + 5);
		const out = fftFilter(y, { type: 'high', low: 0.5 });
		const meanOut = out.reduce((s, v) => s + v, 0) / N;
		expect(meanOut).toBeCloseTo(0, 9);
	});
});

describe('fftFilter — non-power-of-two length', () => {
	it('returns an array of the same length as the input', () => {
		const y = Array.from({ length: 50 }, (_, i) => Math.sin((2 * Math.PI * i) / 10));
		const out = fftFilter(y, { type: 'low', high: 0.6 });
		expect(out).toHaveLength(50);
		expect(out.every((v) => Number.isFinite(v))).toBe(true);
	});
});

describe('fftFilter — degenerate / missing inputs', () => {
	it('returns an empty array for empty input', () => {
		expect(fftFilter([], { type: 'low', high: 0.5 })).toEqual([]);
	});

	it('returns a numeric copy (missing → null) when fewer than 2 valid values', () => {
		expect(fftFilter([null, 3, NaN], { type: 'low', high: 0.5 })).toEqual([null, 3, null]);
	});

	it('preserves the length and re-emits missing entries as null', () => {
		const y = [...tone(K_LOW)];
		y[3] = null;
		y[10] = NaN;
		const out = fftFilter(y, { type: 'low', high: 0.5 });
		expect(out).toHaveLength(N);
		expect(out[3]).toBeNull();
		expect(out[10]).toBeNull();
	});

	it('a constant series low-passes to itself (only DC energy)', () => {
		const y = new Array(16).fill(7);
		const out = fftFilter(y, { type: 'low', high: 0.5 });
		out.forEach((v) => expect(v).toBeCloseTo(7, 9));
	});

	it('a constant series high-passes to zero', () => {
		const y = new Array(16).fill(7);
		const out = fftFilter(y, { type: 'high', low: 0.1 });
		out.forEach((v) => expect(v).toBeCloseTo(0, 9));
	});
});
