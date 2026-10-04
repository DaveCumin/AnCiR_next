// @ts-nocheck
/**
 * Review finding FIT-5 (2026-10-03): on autocorrelated data with no rhythm the shuffle
 * permutation test rejected at 0.05 about as often as the cosinor F-test (32% at AR(1)
 * phi = 0.5, 38% at phi = 0.9). The block scheme (circular one-period blocks) must hold its
 * size there. This is a reduced, deterministic re-run of the simulation quoted in
 * permutationTest.js (1,000 records there; 150 here to keep the suite fast), through the
 * same code path the fit nodes use (fitPermutationPValue, fixed 24 h cosinor).
 */
import { describe, it, expect } from 'vitest';
import { fitPermutationPValue } from './fitFunction.js';
import {
	blockPermuteSeeded,
	lag1Autocorrelation,
	residualAutocorrelationWarning,
	autocorrelationThreshold,
	permutationTest,
	createSeededRNG
} from './permutationTest.js';
import { fitCosinorFixed } from './cosinor.js';

function lcg(seed) {
	let s = seed;
	const rnd = () => {
		s = (1103515245 * s + 12345) % 2147483648;
		return s / 2147483648;
	};
	const gauss = () => {
		const u = rnd() || 1e-12;
		const v = rnd();
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
	};
	return { rnd, gauss };
}

const OPTS = { useFixedPeriod: true, fixedPeriod: 24, nHarmonics: 1 };

/** Rejection rate at 0.05 over `nsim` AR(1) records (+ an optional 24 h cosine). */
function rejectionRate({ phi, amp = 0, scheme, nsim = 150, n = 240, seed = 777 }) {
	const { gauss } = lcg(seed);
	let rej = 0;
	for (let k = 0; k < nsim; k++) {
		const t = [];
		const y = [];
		let e = 0;
		for (let i = 0; i < n; i++) {
			e = phi * e + gauss();
			t.push(i);
			y.push(e + amp * Math.cos((2 * Math.PI * (i - 5)) / 24));
		}
		const r = fitPermutationPValue(t, y, 'cosinor', OPTS, {
			permuteTest: true,
			nPermutations: 99,
			permutationSeed: 1000 + k,
			permutationScheme: scheme
		});
		if (r.pValue < 0.05) rej++;
	}
	return rej / nsim;
}

describe('permutation schemes under AR(1) noise (FIT-5)', () => {
	it('the shuffle scheme is anticonservative at phi = 0.9; the block scheme is not', () => {
		const shuffle = rejectionRate({ phi: 0.9, scheme: 'shuffle' });
		const block = rejectionRate({ phi: 0.9, scheme: 'block' });
		expect(shuffle).toBeGreaterThan(0.25);
		expect(block).toBeLessThan(0.08);
	}, 60000);

	it('the block scheme holds its size on independent data and at phi = 0.5', () => {
		expect(rejectionRate({ phi: 0, scheme: 'block' })).toBeLessThan(0.1);
		expect(rejectionRate({ phi: 0.5, scheme: 'block' })).toBeLessThan(0.1);
	}, 60000);

	it('the block scheme still detects a real rhythm in autocorrelated noise', () => {
		// AR(1) phi 0.5 innovations SD 1 (marginal SD 1.15) plus a 24 h cosine of amplitude 1.
		expect(rejectionRate({ phi: 0.5, amp: 1, scheme: 'block', nsim: 60 })).toBeGreaterThan(0.9);
	}, 60000);
});

describe('block permutation mechanics', () => {
	it('is a permutation of the input (same multiset), reproducible from the seed', () => {
		const y = Array.from({ length: 50 }, (_, i) => i);
		const { rnd } = lcg(5);
		const a = blockPermuteSeeded(y, 12, rnd);
		expect([...a].sort((p, q) => p - q)).toEqual(y);
		expect(a).not.toEqual(y);
		const b = blockPermuteSeeded(y, 12, lcg(5).rnd);
		expect(b).toEqual(a);
	});

	it('keeps neighbours together inside blocks (most lag-1 pairs survive)', () => {
		const y = Array.from({ length: 240 }, (_, i) => i);
		const a = blockPermuteSeeded(y, 24, lcg(9).rnd);
		let kept = 0;
		for (let i = 1; i < a.length; i++) if (a[i] - a[i - 1] === 1) kept++;
		// At most two seams per block (its rotation and its boundary): >= 239 - 2 * 11.
		expect(kept).toBeGreaterThanOrEqual(239 - 22);
	});

	it('refuses a block scheme with fewer than two blocks (NaN p, with the reason)', () => {
		const t = Array.from({ length: 30 }, (_, i) => i);
		const y = t.map((v) => Math.cos((2 * Math.PI * v) / 24));
		const r = fitPermutationPValue(t, y, 'cosinor', OPTS, {
			permuteTest: true,
			nPermutations: 9,
			permutationScheme: 'block'
		});
		expect(r.pValue).toBeNaN();
		expect(r.unavailable).toMatch(/fewer than two 24 h blocks/);
		const p = permutationTest(t, y, () => ({ rSquared: 0 }), { scheme: 'block', blockLength: 1 });
		expect(p.pValue).toBeNaN();
	});

	it('the shuffle scheme is unchanged: the old seeded Fisher-Yates, value for value', () => {
		const t = Array.from({ length: 72 }, (_, i) => i);
		const { gauss } = lcg(3);
		const y = t.map((v) => Math.cos((2 * Math.PI * v) / 24) * 0.3 + gauss());
		const a = fitPermutationPValue(t, y, 'cosinor', OPTS, {
			permuteTest: true,
			nPermutations: 199
		});
		// The pre-scheme algorithm, written out: Fisher-Yates driven by the seeded MINSTD.
		const rng = createSeededRNG(12345);
		let extreme = 0;
		for (let k = 0; k < 199; k++) {
			const yp = [...y];
			for (let i = yp.length - 1; i > 0; i--) {
				const j = Math.floor(rng() * (i + 1));
				[yp[i], yp[j]] = [yp[j], yp[i]];
			}
			if (fitCosinorFixed(t, yp, 24, 1).R2 >= a.observedStat) extreme++;
		}
		expect(a.scheme).toBe('shuffle');
		expect(a.blockLength).toBeNull();
		expect(a.pValue).toBe((extreme + 1) / 200);
	});
});

describe('residual autocorrelation warning (FIT-5)', () => {
	it('lag-1 autocorrelation of a known series', () => {
		expect(lag1Autocorrelation([1, -1, 1, -1, 1, -1])).toBeCloseTo(-5 / 6, 12);
		expect(lag1Autocorrelation([1, 2])).toBeNaN();
	});

	it('threshold is 0.2, or 2/sqrt(n) for short records', () => {
		expect(autocorrelationThreshold(240)).toBe(0.2);
		expect(autocorrelationThreshold(25)).toBeCloseTo(0.4, 12);
	});

	it('warns on AR(1) phi 0.5 residuals, not on white noise, and points to the Surrogate Test', () => {
		const { gauss } = lcg(11);
		const white = Array.from({ length: 240 }, () => gauss());
		let e = 0;
		const red = Array.from({ length: 240 }, () => (e = 0.5 * e + gauss()));
		expect(residualAutocorrelationWarning(white)).toBeNull();
		const w = residualAutocorrelationWarning(red, {
			label: '"y"',
			test: 'The permutation p-value'
		});
		expect(w).toMatch(/^The permutation p-value for "y" assumes independent \(exchangeable\)/);
		expect(w).toMatch(/Surrogate Test/);
		expect(w).toMatch(/lag-1 r = 0\.[3-6]\d/);
	});

	it('fitPermutationPValue reports the observed residual lag-1 autocorrelation', () => {
		const { gauss } = lcg(13);
		const t = Array.from({ length: 120 }, (_, i) => i);
		let e = 0;
		const y = t.map(() => (e = 0.8 * e + gauss()));
		const r = fitPermutationPValue(t, y, 'cosinor', OPTS, { permuteTest: true, nPermutations: 9 });
		expect(r.residualLag1).toBeGreaterThan(0.5);
	});
});
