// Review findings SPEC-2 (gaps) and SPEC-3 (normalisation and padding) for computeFFT.
//
// SPEC-2: rows either side of a gap were treated as adjacent samples. Reviewer setup: 12 days
// hourly with days 5 to 7 missing read 24 h as 31.07 h; 30% of rows missing at random read
// 26.91 h with magnitude 0.52 for a true amplitude of 1.
// SPEC-3: the magnitude was 2|X|/n with n the PADDED length, so a pure amplitude-2 rhythm read
// 1.672 (N = 256), 1.612 (N = 240) and 0.974 (N = 264), and ten days hourly padded to 256
// reported 24 h as 23.27 h.
import { describe, it, expect } from 'vitest';
import { computeFFT, fftAnyLength, regridUniform, fftPeak } from './fft.js';

const cosine = (n, amp, period, dt = 1, phase = 0) => {
	const t = [];
	const y = [];
	for (let i = 0; i < n; i++) {
		t.push(i * dt);
		y.push(amp * Math.cos((2 * Math.PI * i * dt) / period + phase));
	}
	return { t, y };
};
const argmax = (a) => a.reduce((b, v, i) => (v > a[b] ? i : b), 0);
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe('SPEC-3: magnitude does not depend on record or padded length', () => {
	for (const N of [240, 264, 288]) {
		it(`a pure amplitude-2, 24 h cosine over ${N} hourly samples reports 24 h and 2`, () => {
			const { t, y } = cosine(N, 2, 24);
			const r = computeFFT(t, y);
			const k = argmax(r.magnitudes);
			expect(1 / r.frequencies[k]).toBeCloseTo(24, 6);
			expect(r.magnitudes[k]).toBeCloseTo(2, 6);
		});
	}

	it('256 hourly samples (24 h between bins): the refined peak reports 24 h and about 2', () => {
		const { t, y } = cosine(256, 2, 24);
		const p = fftPeak(computeFFT(t, y));
		expect(p.period).toBeCloseTo(24, 4);
		expect(p.magnitude).toBeCloseTo(2, 4);
	});

	it('an explicit fine freqStep interpolates without shrinking the magnitude', () => {
		const { t, y } = cosine(240, 2, 24);
		const r = computeFFT(t, y, 0.0005);
		const k = argmax(r.magnitudes);
		expect(r.magnitudes[k]).toBeGreaterThan(1.99);
		expect(r.magnitudes[k]).toBeLessThan(2.01);
		expect(1 / r.frequencies[k]).toBeGreaterThan(23.9);
		expect(1 / r.frequencies[k]).toBeLessThan(24.1);
		// freqStep is honoured as asked (no rounding up to a power of two).
		expect(r.frequencies[1] - r.frequencies[0]).toBeCloseTo(1 / Math.ceil(1 / 0.0005), 9);
	});

	it('reports the true resolution, 1 / record length, whatever the padding', () => {
		const { t, y } = cosine(240, 1, 24);
		expect(computeFFT(t, y).resolution).toBeCloseTo(1 / 240, 12);
		expect(computeFFT(t, y, 0.0005).resolution).toBeCloseTo(1 / 240, 12);
	});

	it('fftPeak refines an off-grid period and keeps the amplitude', () => {
		// 250 h of hourly data: 24.5 h is between bins 10 (25 h) and 11 (22.7 h).
		const { t, y } = cosine(250, 3, 24.5, 1, 0.7);
		const r = computeFFT(t, y);
		const p = fftPeak(r);
		expect(p.period).toBeCloseTo(24.5, 4);
		expect(p.magnitude).toBeCloseTo(3, 4);
		// On a bin the refinement keeps the exact answer (no pull from the mirror image).
		const onGrid = fftPeak(computeFFT(...Object.values(cosine(240, 2, 24))));
		expect(onGrid.period).toBeCloseTo(24, 6);
		expect(onGrid.magnitude).toBeCloseTo(2, 6);
		// A period range restricts the search.
		const p2 = fftPeak(r, { periodMin: 5, periodMax: 12 });
		expect(p2.period).toBeLessThanOrEqual(12);
	});
});

describe('SPEC-2: the FFT uses the series own grid and never joins across a gap', () => {
	it('refuses, with a reason, a 12-day hourly record missing three whole days (rows absent)', () => {
		const t = [];
		const y = [];
		for (let i = 0; i < 288; i++) {
			if (i >= 96 && i < 168) continue;
			t.push(i);
			y.push(Math.cos((2 * Math.PI * i) / 24));
		}
		const r = computeFFT(t, y);
		expect(r.frequencies).toEqual([]);
		expect(r.reason).toMatch(/gap/i);
		expect(r.reason).toMatch(/72/); // the gap length, in hours
	});

	it('refuses the same gap when the rows are present with missing values', () => {
		const t = [];
		const y = [];
		for (let i = 0; i < 288; i++) {
			t.push(i);
			y.push(i >= 96 && i < 168 ? null : Math.cos((2 * Math.PI * i) / 24));
		}
		const r = computeFFT(t, y);
		expect(r.frequencies).toEqual([]);
		expect(r.reason).toMatch(/gap/i);
	});

	it('refuses 30% of rows missing at random (the reviewer setup)', () => {
		const rr = rng(3);
		const t = [];
		const y = [];
		for (let i = 0; i < 288; i++) {
			if (rr() < 0.3) continue;
			t.push(i);
			y.push(Math.cos((2 * Math.PI * i) / 24));
		}
		const r = computeFFT(t, y);
		expect(r.frequencies).toEqual([]);
		expect(r.reason).toMatch(/missing/i);
	});

	it('fills a few isolated missing samples by linear interpolation and says so', () => {
		const t = [];
		const y = [];
		for (let i = 0; i < 288; i++) {
			if (i === 50 || i === 51 || i === 200) continue;
			t.push(i);
			y.push(Math.cos((2 * Math.PI * i) / 24));
		}
		const r = computeFFT(t, y);
		const k = argmax(r.magnitudes);
		expect(1 / r.frequencies[k]).toBeCloseTo(24, 6);
		expect(r.magnitudes[k]).toBeGreaterThan(0.98);
		expect(r.nFilled).toBe(3);
		expect(r.warnings.join(' ')).toMatch(/interpolat/i);
	});

	it('regridUniform puts samples on the median-interval grid and reports the longest gap', () => {
		const g = regridUniform([0, 1, 2, 5, 6], [0, 1, 2, 5, 6], {
			maxGapSamples: 2,
			maxMissingFraction: 1
		});
		expect(g.ok).toBe(true);
		expect(g.dt).toBe(1);
		expect(g.y).toEqual([0, 1, 2, 3, 4, 5, 6]);
		expect(g.nFilled).toBe(2);
		const bad = regridUniform([0, 1, 2, 6, 7], [0, 1, 2, 6, 7], {
			maxGapSamples: 2,
			maxMissingFraction: 1
		});
		expect(bad.ok).toBe(false);
		expect(bad.longestGap).toBe(3);
	});

	it('refuses samples that do not sit on a regular grid', () => {
		const t = [0, 1, 2, 3.5, 4, 5, 6, 7, 8, 9];
		const g = regridUniform(t, t);
		expect(g.ok).toBe(false);
		expect(g.reason).toMatch(/regular/i);
	});
});

describe('fftAnyLength (Bluestein for non-power-of-two lengths)', () => {
	for (const n of [3, 5, 12, 100, 513]) {
		it(`matches a direct DFT at n = ${n} and inverts`, () => {
			const r = rng(n);
			const x = Array.from({ length: n }, () => r() - 0.5);
			const re = Float64Array.from(x);
			const im = new Float64Array(n);
			fftAnyLength(re, im);
			for (const k of [0, 1, Math.floor(n / 2), n - 1]) {
				let sr = 0;
				let si = 0;
				for (let j = 0; j < n; j++) {
					sr += x[j] * Math.cos((-2 * Math.PI * k * j) / n);
					si += x[j] * Math.sin((-2 * Math.PI * k * j) / n);
				}
				expect(re[k]).toBeCloseTo(sr, 9);
				expect(im[k]).toBeCloseTo(si, 9);
			}
			fftAnyLength(re, im, true);
			for (let j = 0; j < n; j++) expect(re[j]).toBeCloseTo(x[j], 10);
		});
	}
});
