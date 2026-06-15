import { describe, it, expect } from 'vitest';
import {
	movingAverage,
	savitzkyGolay,
	loess,
	whittakerEilers,
	smoothArrays
} from './smoothing.js';

// Deterministic pseudo-random noise so "smoother lambda → smoother output"
// style tests are reproducible (the existing test uses Math.random()).
function seededNoise(n, seed = 1) {
	let s = seed;
	return Array.from({ length: n }, () => {
		s = (s * 1103515245 + 12345) % 2 ** 31;
		return s / 2 ** 31 - 0.5;
	});
}

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

	it('higher lambda is smoother — deterministic (seeded noise)', () => {
		const base = sineSignal(40, 1, 8);
		const noisy = base.map((v, i) => v + seededNoise(40, 7)[i]);
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

	it('reproduces a straight line (zero 2nd difference) exactly', () => {
		const y = Array.from({ length: 20 }, (_, i) => 2 * i + 1);
		const out = whittakerEilers(y, 1000, 2);
		// A line has no 2nd-difference penalty, so it passes through unchanged.
		for (let i = 0; i < y.length; i++) expect(out[i]).toBeCloseTo(y[i], 4);
	});
});

// ─── edge cases across all smoothers ──────────────────────────────────────────

describe('movingAverage — edge cases', () => {
	it('returns [] for an empty array', () => {
		expect(movingAverage([], 5, 'simple')).toEqual([]);
	});

	it('returns a single element unchanged', () => {
		expect(movingAverage([7], 5, 'simple')).toEqual([7]);
	});

	it('falls back to the original value when the whole window is invalid', () => {
		// Middle element has only NaN/null neighbours within the window.
		const y = [NaN, null, 5, null, NaN];
		const out = movingAverage(y, 1, 'simple'); // halfWindow 0 → just itself
		expect(out[2]).toBe(5);
	});

	it('unknown type behaves like a weighted branch (weightSum based)', () => {
		const y = new Array(10).fill(3);
		const out = movingAverage(y, 5, 'mystery');
		out.forEach((v) => expect(v).toBeCloseTo(3, 8));
	});

	it('preserves the array mean for a symmetric simple window on constant data', () => {
		const y = new Array(30).fill(4.2);
		const out = movingAverage(y, 7, 'simple');
		out.forEach((v) => expect(v).toBeCloseTo(4.2, 10));
	});
});

describe('savitzkyGolay — edge cases', () => {
	it('preserves a linear ramp on interior points', () => {
		const y = Array.from({ length: 20 }, (_, i) => 3 * i - 2);
		const out = savitzkyGolay(y, 5, 2);
		for (let i = 2; i < 18; i++) expect(out[i]).toBeCloseTo(y[i], 6);
	});

	it('leaves edge points (within halfWindow) untouched', () => {
		const y = Array.from({ length: 15 }, (_, i) => i * i);
		const out = savitzkyGolay(y, 5, 2);
		// halfWindow = 2 → first/last 2 entries are copied verbatim
		expect(out[0]).toBe(y[0]);
		expect(out[1]).toBe(y[1]);
		expect(out[out.length - 1]).toBe(y[y.length - 1]);
		expect(out[out.length - 2]).toBe(y[y.length - 2]);
	});
});

describe('loess — edge cases', () => {
	it('returns [] for empty input', () => {
		expect(loess([], [], 0.3)).toEqual([]);
	});

	it('handles a constant x (degenerate local fit) without NaN', () => {
		const x = new Array(10).fill(0);
		const y = Array.from({ length: 10 }, (_, i) => i);
		const out = loess(x, y, 0.5);
		expect(out.every((v) => Number.isFinite(v))).toBe(true);
	});

	it('recovers a flat line at a constant level', () => {
		const x = Array.from({ length: 15 }, (_, i) => i);
		const y = new Array(15).fill(9);
		loess(x, y, 0.3).forEach((v) => expect(v).toBeCloseTo(9, 6));
	});
});

describe('whittakerEilers — edge cases', () => {
	it('returns input unchanged for length 0', () => {
		expect(whittakerEilers([], 100, 2)).toEqual([]);
	});

	it('returns input unchanged for length 1 and 2', () => {
		expect(whittakerEilers([5], 100, 2)).toEqual([5]);
		expect(whittakerEilers([5, 6], 100, 2)).toEqual([5, 6]);
	});
});

describe('smoothArrays — dispatch', () => {
	const x = Array.from({ length: 20 }, (_, i) => i);
	const y = sineSignal(20, 1, 6);

	it('returns x_out unchanged and y_out same length for each smoother', () => {
		for (const type of ['moving', 'whittaker', 'savitzky', 'loess']) {
			const { x_out, y_out } = smoothArrays(x, y, type);
			expect(x_out).toBe(x);
			expect(y_out).toHaveLength(y.length);
		}
	});

	it('defaults to moving average for an unknown smoother type', () => {
		const out = smoothArrays(x, y, 'nonsense');
		const ref = movingAverage(y, 5, 'simple');
		expect(out.y_out).toEqual(ref);
	});

	it('passes whittaker options through', () => {
		const out = smoothArrays(x, y, 'whittaker', { whittakerLambda: 1000, whittakerOrder: 2 });
		const ref = whittakerEilers(y, 1000, 2);
		out.y_out.forEach((v, i) => expect(v).toBeCloseTo(ref[i], 10));
	});

	it('passes savitzky options through', () => {
		const out = smoothArrays(x, y, 'savitzky', { savitzkyWindowSize: 7, savitzkyPolyOrder: 3 });
		const ref = savitzkyGolay(y, 7, 3);
		expect(out.y_out).toEqual(ref);
	});

	it('passes loess bandwidth through', () => {
		const out = smoothArrays(x, y, 'loess', { loessBandwidth: 0.5 });
		const ref = loess(x, y, 0.5);
		expect(out.y_out).toEqual(ref);
	});
});
