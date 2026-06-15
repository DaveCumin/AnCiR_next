import { describe, it, expect } from 'vitest';
import {
	permutationTest,
	permutationTestAsync,
	createSeededRNG,
	recommendPermutations
} from './permutationTest.js';

// Trivial linear fit returning rSquared / rmse, used as the fitFn.
function linearFit(x, y) {
	const n = x.length;
	let sx = 0,
		sy = 0,
		sxy = 0,
		sxx = 0;
	for (let i = 0; i < n; i++) {
		sx += x[i];
		sy += y[i];
		sxy += x[i] * y[i];
		sxx += x[i] * x[i];
	}
	const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
	const intercept = (sy - slope * sx) / n;
	const meanY = sy / n;
	let ssTot = 0,
		ssRes = 0;
	for (let i = 0; i < n; i++) {
		const pred = slope * x[i] + intercept;
		ssTot += (y[i] - meanY) ** 2;
		ssRes += (y[i] - pred) ** 2;
	}
	const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;
	return { rSquared, rmse: Math.sqrt(ssRes / n) };
}

describe('createSeededRNG', () => {
	it('produces values in [0, 1)', () => {
		const rng = createSeededRNG(123);
		for (let i = 0; i < 100; i++) {
			const v = rng();
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
	});

	it('is deterministic for a given seed', () => {
		const a = createSeededRNG(42);
		const b = createSeededRNG(42);
		const seqA = Array.from({ length: 20 }, () => a());
		const seqB = Array.from({ length: 20 }, () => b());
		expect(seqA).toEqual(seqB);
	});

	it('produces different streams for different seeds', () => {
		const a = createSeededRNG(1);
		const b = createSeededRNG(2);
		const seqA = Array.from({ length: 20 }, () => a());
		const seqB = Array.from({ length: 20 }, () => b());
		expect(seqA).not.toEqual(seqB);
	});

	it('normalises non-finite and string seeds without throwing', () => {
		expect(() => createSeededRNG(undefined)).not.toThrow();
		expect(() => createSeededRNG('not a number')).not.toThrow();
		expect(() => createSeededRNG(NaN)).not.toThrow();
		const rng = createSeededRNG(NaN);
		expect(rng()).toBeGreaterThanOrEqual(0);
	});
});

describe('recommendPermutations', () => {
	it('returns more permutations for larger samples', () => {
		expect(recommendPermutations(5)).toBe(199);
		expect(recommendPermutations(15)).toBe(499);
		expect(recommendPermutations(30)).toBe(999);
		expect(recommendPermutations(100)).toBe(9999);
	});

	it('is monotonically non-decreasing in n', () => {
		let prev = 0;
		for (const n of [1, 9, 10, 19, 20, 49, 50, 1000]) {
			const r = recommendPermutations(n);
			expect(r).toBeGreaterThanOrEqual(prev);
			prev = r;
		}
	});
});

describe('permutationTest', () => {
	const x = Array.from({ length: 12 }, (_, i) => i);
	const yStrong = x.map((xi) => 2 * xi + 1); // perfect linear trend

	it('flags a strong trend as significant', () => {
		const r = permutationTest(x, yStrong, linearFit, { seed: 1, nPermutations: 199 });
		expect(r.observedStat).toBeCloseTo(1, 6);
		expect(r.pValue).toBeLessThan(0.05);
		expect(r.significant).toBe(true);
		expect(r.error).toBe(false);
	});

	it('is reproducible for a fixed seed', () => {
		const a = permutationTest(x, yStrong, linearFit, { seed: 99, nPermutations: 199 });
		const b = permutationTest(x, yStrong, linearFit, { seed: 99, nPermutations: 199 });
		expect(a.pValue).toBe(b.pValue);
		expect(a.permutedStats).toEqual(b.permutedStats);
	});

	it('p-value is always in (0, 1] (never exactly zero)', () => {
		const r = permutationTest(x, yStrong, linearFit, { seed: 3, nPermutations: 50 });
		expect(r.pValue).toBeGreaterThan(0);
		expect(r.pValue).toBeLessThanOrEqual(1);
		// (extremeCount + 1) / (n + 1): minimum is 1/(50+1)
		expect(r.pValue).toBeGreaterThanOrEqual(1 / (r.nPermutations + 1));
	});

	it('returns a non-significant p-value for pure noise with a fixed seed', () => {
		const rng = createSeededRNG(2024);
		const yNoise = x.map(() => rng());
		const r = permutationTest(x, yNoise, linearFit, { seed: 11, nPermutations: 499 });
		expect(r.pValue).toBeGreaterThan(0.05);
		expect(r.significant).toBe(false);
	});

	it('handles the rmse (minimisation) statistic', () => {
		const r = permutationTest(x, yStrong, linearFit, {
			statistic: 'rmse',
			seed: 5,
			nPermutations: 199
		});
		// Observed rmse ≈ 0 for a perfect fit; permuted fits are worse → significant.
		expect(r.observedStat).toBeCloseTo(0, 6);
		expect(r.pValue).toBeLessThan(0.05);
	});

	it('returns an error result when the original fit throws', () => {
		const throwingFit = () => {
			throw new Error('boom');
		};
		const r = permutationTest(x, yStrong, throwingFit, { seed: 1, nPermutations: 10 });
		expect(r.error).toBe(true);
		expect(r.pValue).toBeNaN();
		expect(r.significant).toBe(false);
	});

	it('skips permutations whose fit throws but still returns a result', () => {
		let call = 0;
		const flakyFit = (xp, yp) => {
			call++;
			if (call > 1 && call % 2 === 0) throw new Error('skip me');
			return linearFit(xp, yp);
		};
		const r = permutationTest(x, yStrong, flakyFit, { seed: 1, nPermutations: 20 });
		expect(r.error).toBe(false);
		// Some permutations were skipped, so the effective count is below the request.
		expect(r.nPermutations).toBeLessThan(20);
	});
});

describe('permutationTestAsync', () => {
	const x = Array.from({ length: 12 }, (_, i) => i);
	const yStrong = x.map((xi) => 2 * xi + 1);

	it('matches the synchronous version for the same seed and inputs', async () => {
		const sync = permutationTest(x, yStrong, linearFit, { seed: 77, nPermutations: 99 });
		const asyncR = await permutationTestAsync(x, yStrong, linearFit, {
			seed: 77,
			nPermutations: 99
		});
		expect(asyncR.pValue).toBe(sync.pValue);
		expect(asyncR.permutedStats).toEqual(sync.permutedStats);
	});

	it('invokes the onProgress callback up to nPermutations times', async () => {
		let last = 0;
		await permutationTestAsync(x, yStrong, linearFit, {
			seed: 1,
			nPermutations: 30,
			batchSize: 10,
			onProgress: (cur, total) => {
				last = cur;
				expect(total).toBe(30);
			}
		});
		expect(last).toBe(30);
	});
});
