// @ts-nocheck
// The Fit waveform model PANEL ran its permutation test as
//   permutationTestAsync(tt, yy, (x, y) => computeSingleFit(x, y, args), ...)
// where computeSingleFit is an async function. Every "fit" was a Promise, so every
// statistic was undefined, no permuted statistic ever counted as extreme and the p was
// 1 / (n + 1) = 0.001 at 999 permutations: "significant" on pure noise, and a different p
// from the headless engine (MCP, doProcess) for the same session. The panel now calls
// fitPermutationPValueAsync, which shares fitPermutationPValue's preparation; these pin
// that the two agree, and that the block scheme and autoPermutations reach both.
import { describe, it, expect, vi } from 'vitest';
import {
	fitPermutationPValue,
	fitPermutationPValueAsync,
	resolvePermutationCount
} from './fitFunction.js';
import { permutationTestAsync, recommendPermutations } from './permutationTest.js';

function lcg(seed) {
	let s = seed;
	return () => {
		s = (1103515245 * s + 12345) % 2147483648;
		return s / 2147483648;
	};
}
const rnd = lcg(7);
const t = Array.from({ length: 96 }, (_, i) => i);
const noise = t.map(() => rnd() - 0.5);
const opts = { useFixedPeriod: true, fixedPeriod: 24, nHarmonics: 1, alpha: 0.05 };
const args = (over) => ({
	permuteTest: true,
	nPermutations: 99,
	permutationSeed: 3,
	permutationStatistic: 'rSquared',
	...over
});

describe('fitPermutationPValueAsync', () => {
	it('reproduces the old panel bug: an async fit function gives p = 1/(n+1)', async () => {
		const asyncFit = async (x, y) => ({ rSquared: 0, x, y });
		const r = await permutationTestAsync(t, noise, asyncFit, { nPermutations: 99, seed: 3 });
		expect(r.pValue).toBeCloseTo(0.01, 10); // the symptom the panel showed
	});

	it('agrees with the synchronous runner, shuffle scheme', async () => {
		const sync = fitPermutationPValue(t, noise, 'cosinor', opts, args());
		const asyncR = await fitPermutationPValueAsync(t, noise, 'cosinor', opts, args());
		expect(asyncR.pValue).toBe(sync.pValue);
		expect(asyncR.permutedStats).toEqual(sync.permutedStats);
		expect(asyncR.scheme).toBe('shuffle');
		// Pure noise is not "significant at p = 0.01".
		expect(asyncR.pValue).toBeGreaterThan(0.05);
	});

	it('agrees with the synchronous runner, block scheme, and reports the block length', async () => {
		const a = args({ permutationScheme: 'block' });
		const sync = fitPermutationPValue(t, noise, 'cosinor', opts, a);
		const asyncR = await fitPermutationPValueAsync(t, noise, 'cosinor', opts, a);
		expect(asyncR.scheme).toBe('block');
		expect(asyncR.blockLength).toBe(24);
		expect(asyncR.pValue).toBe(sync.pValue);
		expect(asyncR.permutedStats).toEqual(sync.permutedStats);
	});

	it('reports progress', async () => {
		const onProgress = vi.fn();
		await fitPermutationPValueAsync(t, noise, 'cosinor', opts, args(), { onProgress });
		expect(onProgress).toHaveBeenLastCalledWith(99, 99);
	});

	it('returns the same unavailable result as the sync runner when blocks do not fit', async () => {
		const short = t.slice(0, 40);
		const a = args({ permutationScheme: 'block' });
		const r = await fitPermutationPValueAsync(short, noise.slice(0, 40), 'cosinor', opts, a);
		expect(Number.isNaN(r.pValue)).toBe(true);
		expect(r.unavailable).toMatch(/fewer than two 24 h blocks/);
	});
});

describe('resolvePermutationCount', () => {
	it('uses the recommended count when autoPermutations is on (panel and engine alike)', () => {
		expect(resolvePermutationCount({ autoPermutations: true, nPermutations: 99 }, 30)).toBe(
			recommendPermutations(30)
		);
		expect(resolvePermutationCount({ autoPermutations: false, nPermutations: 99 }, 30)).toBe(99);
		expect(resolvePermutationCount({}, 30)).toBe(999);
	});

	it('the sync runner honours autoPermutations (it used to ignore it)', () => {
		const r = fitPermutationPValue(t.slice(0, 15), noise.slice(0, 15), 'cosinor', opts, {
			...args(),
			autoPermutations: true
		});
		expect(r.permutedStats.length).toBe(recommendPermutations(15));
	});
});
