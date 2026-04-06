import { describe, it, expect } from 'vitest';
import { movingAverage, savitzkyGolay, loess, whittakerEilers } from './smoothing.js';

// Synthetic noisy signal: sine wave + small noise
function sineSignal(n = 100, amplitude = 1, period = 20) {
	return Array.from({ length: n }, (_, i) => amplitude * Math.sin((2 * Math.PI * i) / period));
}

// ─── movingAverage ───────────────────────────────────────────────────────────

describe('movingAverage — simple', () => {
	it('returns same length as input', () => {
		const y = sineSignal(50);
		expect(movingAverage(y, 5, 'simple')).toHaveLength(50);
	});

	it('smooths constant array to itself', () => {
		const y = new Array(20).fill(3);
		const out = movingAverage(y, 5, 'simple');
		out.forEach((v) => expect(v).toBeCloseTo(3, 10));
	});

	it('reduces peak amplitude of a noisy signal', () => {
		const noisy = sineSignal(100, 1, 10).map((v, i) => v + (i % 3 === 0 ? 2 : 0));
		const smoothed = movingAverage(noisy, 7, 'simple');
		const noisyRange = Math.max(...noisy) - Math.min(...noisy);
		const smoothedRange = Math.max(...smoothed) - Math.min(...smoothed);
		expect(smoothedRange).toBeLessThan(noisyRange);
	});

	it('skips null values without crashing', () => {
		const y = [1, 2, null, 4, 5];
		expect(() => movingAverage(y, 3, 'simple')).not.toThrow();
	});

	it('skips NaN values without crashing', () => {
		const y = [1, NaN, 3, 4, 5];
		const out = movingAverage(y, 3, 'simple');
		expect(out).toHaveLength(5);
	});
});

describe('movingAverage — weighted', () => {
	it('returns same length as input', () => {
		const y = sineSignal(30);
		expect(movingAverage(y, 5, 'weighted')).toHaveLength(30);
	});

	it('smooths constant array to itself', () => {
		const y = new Array(20).fill(7);
		const out = movingAverage(y, 5, 'weighted');
		out.forEach((v) => expect(v).toBeCloseTo(7, 8));
	});
});

describe('movingAverage — exponential', () => {
	it('returns same length as input', () => {
		const y = sineSignal(30);
		expect(movingAverage(y, 5, 'exponential')).toHaveLength(30);
	});

	it('smooths constant array to itself', () => {
		const y = new Array(20).fill(5);
		const out = movingAverage(y, 5, 'exponential');
		out.forEach((v) => expect(v).toBeCloseTo(5, 8));
	});
});

// ─── savitzkyGolay ───────────────────────────────────────────────────────────

describe('savitzkyGolay', () => {
	it('returns same length as input', () => {
		const y = sineSignal(50);
		expect(savitzkyGolay(y, 5, 2)).toHaveLength(50);
	});

	it('preserves a polynomial exactly (within filter window)', () => {
		// Quadratic y = i² — SG with polyOrder ≥ 2 should reproduce it exactly
		const y = Array.from({ length: 30 }, (_, i) => i * i);
		const out = savitzkyGolay(y, 5, 2);
		// Interior points (not edge-padded) should match
		for (let i = 3; i < 27; i++) {
			expect(out[i]).toBeCloseTo(y[i], 4);
		}
	});

	it('smooths constant array to itself', () => {
		const y = new Array(20).fill(4);
		const out = savitzkyGolay(y, 5, 2);
		// Edge points are copied unchanged, interior should be 4
		for (let i = 2; i < 18; i++) expect(out[i]).toBeCloseTo(4, 6);
	});

	it('increments even window size to make it odd', () => {
		const y = sineSignal(20);
		// windowSize=4 → effectively 5; result should still be length 20
		expect(savitzkyGolay(y, 4, 2)).toHaveLength(20);
	});
});

// ─── loess ───────────────────────────────────────────────────────────────────

describe('loess', () => {
	it('returns same length as input', () => {
		const x = Array.from({ length: 40 }, (_, i) => i);
		const y = sineSignal(40);
		expect(loess(x, y, 0.3)).toHaveLength(40);
	});

	it('smooths constant array to itself', () => {
		const x = Array.from({ length: 20 }, (_, i) => i);
		const y = new Array(20).fill(6);
		const out = loess(x, y, 0.4);
		out.forEach((v) => expect(v).toBeCloseTo(6, 5));
	});

	it('recovers a linear trend accurately', () => {
		// y = 2x + 1 — LOESS with enough bandwidth should fit it well
		const x = Array.from({ length: 30 }, (_, i) => i);
		const y = x.map((xi) => 2 * xi + 1);
		const out = loess(x, y, 0.5);
		for (let i = 3; i < 27; i++) expect(out[i]).toBeCloseTo(y[i], 1);
	});
});

// ─── whittakerEilers ─────────────────────────────────────────────────────────

describe('whittakerEilers', () => {
	it('returns same length as input', () => {
		const y = sineSignal(30);
		expect(whittakerEilers(y, 10, 2)).toHaveLength(30);
	});

	it('returns input unchanged for n < 3', () => {
		const y = [1, 2];
		expect(whittakerEilers(y, 100, 2)).toEqual([1, 2]);
	});

	it('smooths constant array to itself', () => {
		const y = new Array(15).fill(5);
		const out = whittakerEilers(y, 100, 2);
		out.forEach((v) => expect(v).toBeCloseTo(5, 4));
	});

	it('higher lambda produces smoother output (smaller 2nd differences)', () => {
		const noisy = sineSignal(40, 1, 8).map((v) => v + (Math.random() - 0.5) * 0.1);
		const lessSmooth = whittakerEilers(noisy, 1, 2);
		const moreSmooth = whittakerEilers(noisy, 1000, 2);

		function roughness(arr) {
			let sum = 0;
			for (let i = 1; i < arr.length - 1; i++)
				sum += Math.abs(arr[i + 1] - 2 * arr[i] + arr[i - 1]);
			return sum;
		}

		expect(roughness(moreSmooth)).toBeLessThan(roughness(lessSmooth));
	});
});
