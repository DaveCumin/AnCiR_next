import { describe, it, expect, vi } from 'vitest';
import {
	phaseRandomise,
	aaftSurrogate,
	blockBootstrap,
	ar1Surrogate,
	shuffleSurrogate,
	makeSurrogate,
	surrogateTest,
	surrogateAdvice,
	SURROGATE_METHODS
} from './surrogates.js';
import { createSeededRNG } from './permutationTest.js';
import { computeFFT } from './fft.js';

const DT = 0.25;

function rhythm(n, periodHrs = 24, amp = 1, noise = 0, seed = 7) {
	const rng = createSeededRNG(seed);
	return Array.from(
		{ length: n },
		(_, i) => amp * Math.cos((2 * Math.PI * i * DT) / periodHrs) + noise * (rng() - 0.5)
	);
}

/** Lag-1 autocorrelation — the nuisance structure these surrogates exist to preserve. */
function lag1(y) {
	const mu = y.reduce((a, b) => a + b, 0) / y.length;
	let num = 0;
	let den = 0;
	for (let i = 1; i < y.length; i++) num += (y[i] - mu) * (y[i - 1] - mu);
	for (let i = 0; i < y.length; i++) den += (y[i] - mu) ** 2;
	return den > 0 ? num / den : 0;
}

/**
 * Peak spectral power INSIDE the circadian band — the quantity a rhythmicity
 * test actually uses.
 *
 * Deliberately band-limited. A global FFT max is the wrong statistic here: an
 * AR(1) fitted to a near-deterministic sinusoid has alpha ~ 0.998, and that red
 * noise piles its power at the LOWEST frequencies, so a global max would compare
 * a 24 h peak against a 200 h one and conclude nothing.
 */
function bandPower(y, loHrs = 18, hiHrs = 30) {
	const times = y.map((_, i) => i * DT);
	const { frequencies, magnitudes } = computeFFT(times, y);
	let best = 0;
	for (let i = 0; i < frequencies.length; i++) {
		const period = 1 / frequencies[i];
		if (period >= loHrs && period <= hiHrs && magnitudes[i] > best) best = magnitudes[i];
	}
	return best;
}

describe('phaseRandomise', () => {
	it('returns a REAL series (conjugate symmetry is enforced)', () => {
		const out = phaseRandomise(rhythm(512), createSeededRNG(1));
		expect(out).toHaveLength(512);
		expect(out.every(Number.isFinite)).toBe(true);
	});

	it('preserves the amplitude spectrum', () => {
		// The defining property: same power spectrum, different phases.
		const y = rhythm(1024, 24, 1, 0.3);
		const s = phaseRandomise(y, createSeededRNG(42));
		const py = bandPower(y);
		const ps = bandPower(s);
		expect(ps / py).toBeGreaterThan(0.7);
		expect(ps / py).toBeLessThan(1.4);
	});

	it('preserves the mean', () => {
		const y = rhythm(512, 24, 1, 0.2).map((v) => v + 50);
		const s = phaseRandomise(y, createSeededRNG(3));
		const avg = (a) => a.reduce((x, b) => x + b, 0) / a.length;
		expect(avg(s)).toBeCloseTo(avg(y), 6);
	});

	it('preserves autocorrelation far better than a plain shuffle', () => {
		// This is the whole reason the module exists.
		const y = rhythm(1024, 24, 1, 0.2);
		const target = lag1(y);
		const phase = lag1(phaseRandomise(y, createSeededRNG(9)));
		const shuffled = lag1(shuffleSurrogate(y, createSeededRNG(9)));
		expect(Math.abs(phase - target)).toBeLessThan(Math.abs(shuffled - target));
		expect(Math.abs(shuffled)).toBeLessThan(0.2); // shuffling destroys it
	});

	it('actually randomises (two seeds differ)', () => {
		const y = rhythm(256);
		const a = phaseRandomise(y, createSeededRNG(1));
		const b = phaseRandomise(y, createSeededRNG(2));
		expect(a).not.toEqual(b);
	});

	it('is reproducible from a seed', () => {
		const y = rhythm(256);
		expect(phaseRandomise(y, createSeededRNG(5))).toEqual(phaseRandomise(y, createSeededRNG(5)));
	});

	it('passes very short input through untouched', () => {
		expect(phaseRandomise([1, 2, 3], createSeededRNG(1))).toEqual([1, 2, 3]);
	});
});

describe('aaftSurrogate', () => {
	it('preserves the marginal distribution EXACTLY', () => {
		// The point of AAFT over plain phase randomisation.
		const y = rhythm(512, 24, 1, 0.5).map((v) => Math.max(0, v) ** 2); // skewed, zero-inflated
		const s = aaftSurrogate(y, createSeededRNG(11));
		expect([...s].sort((a, b) => a - b)).toEqual([...y].sort((a, b) => a - b));
	});

	it('still keeps most of the autocorrelation', () => {
		const y = rhythm(1024, 24, 1, 0.2);
		const target = lag1(y);
		expect(Math.abs(lag1(aaftSurrogate(y, createSeededRNG(4))) - target)).toBeLessThan(0.35);
	});

	it('is reproducible and seed-sensitive', () => {
		const y = rhythm(256, 24, 1, 0.3);
		expect(aaftSurrogate(y, createSeededRNG(2))).toEqual(aaftSurrogate(y, createSeededRNG(2)));
		expect(aaftSurrogate(y, createSeededRNG(2))).not.toEqual(aaftSurrogate(y, createSeededRNG(3)));
	});
});

describe('blockBootstrap', () => {
	it('returns the original length', () => {
		expect(blockBootstrap(rhythm(500), createSeededRNG(1), 96)).toHaveLength(500);
	});

	it('only ever emits values drawn from the original series', () => {
		const y = rhythm(256, 24, 1, 0.4);
		const set = new Set(y);
		expect(blockBootstrap(y, createSeededRNG(1), 32).every((v) => set.has(v))).toBe(true);
	});

	it('preserves local structure — longer blocks keep more autocorrelation', () => {
		const y = rhythm(2048, 24, 1, 0.2);
		const target = Math.abs(lag1(y));
		const long = Math.abs(lag1(blockBootstrap(y, createSeededRNG(6), 192)));
		const short = Math.abs(lag1(blockBootstrap(y, createSeededRNG(6), 2)));
		expect(long).toBeGreaterThan(short);
		expect(long / target).toBeGreaterThan(0.5);
	});

	it('clamps a silly block length instead of hanging or throwing', () => {
		const y = rhythm(64);
		expect(blockBootstrap(y, createSeededRNG(1), 0)).toHaveLength(64);
		expect(blockBootstrap(y, createSeededRNG(1), 1e6)).toHaveLength(64);
		expect(blockBootstrap(y, createSeededRNG(1), NaN)).toHaveLength(64);
	});
});

describe('ar1Surrogate', () => {
	it('reproduces the lag-1 autocorrelation on average', () => {
		// Build a genuine AR(1) so there IS a well-defined alpha to recover.
		const rng = createSeededRNG(21);
		const n = 4000;
		const y = [0];
		for (let i = 1; i < n; i++) y.push(0.8 * y[i - 1] + (rng() - 0.5));
		const got = [];
		for (let k = 0; k < 12; k++) got.push(lag1(ar1Surrogate(y, createSeededRNG(100 + k))));
		const avg = got.reduce((a, b) => a + b, 0) / got.length;
		expect(avg).toBeGreaterThan(0.65);
		expect(avg).toBeLessThan(0.95);
	});

	it('roughly preserves mean and variance', () => {
		const rng = createSeededRNG(31);
		const y = Array.from({ length: 3000 }, () => 10 + (rng() - 0.5) * 4);
		const s = ar1Surrogate(y, createSeededRNG(32));
		const avg = (a) => a.reduce((x, b) => x + b, 0) / a.length;
		const varr = (a) => avg(a.map((v) => (v - avg(a)) ** 2));
		expect(avg(s)).toBeCloseTo(avg(y), 0);
		expect(varr(s) / varr(y)).toBeGreaterThan(0.6);
		expect(varr(s) / varr(y)).toBeLessThan(1.6);
	});

	it('destroys the RHYTHM while keeping the noise character', () => {
		// The property that makes ar1 a valid rhythmicity null.
		const y = rhythm(2048, 24, 5, 0.5);
		expect(bandPower(ar1Surrogate(y, createSeededRNG(8)))).toBeLessThan(bandPower(y) / 2);
	});

	it('is stable when the series is constant', () => {
		const s = ar1Surrogate(new Array(64).fill(5), createSeededRNG(1));
		expect(s).toHaveLength(64);
		expect(s.every(Number.isFinite)).toBe(true);
	});
});

describe('makeSurrogate', () => {
	it.each(SURROGATE_METHODS)('%s produces a finite series of the right length', (method) => {
		const y = rhythm(512, 24, 1, 0.3);
		const s = makeSurrogate(y, method, createSeededRNG(1), { blockLength: 96 });
		expect(s).toHaveLength(512);
		expect(s.every(Number.isFinite)).toBe(true);
	});

	it('throws on an unknown method', () => {
		expect(() => makeSurrogate([1, 2, 3, 4], 'iaaft', createSeededRNG(1))).toThrow(
			/unknown method/
		);
	});
});

describe('surrogateTest', () => {
	it('detects a strong rhythm against a block-bootstrap null', () => {
		const y = rhythm(2048, 24, 5, 1);
		const r = surrogateTest(y, bandPower, {
			method: 'block',
			nSurrogates: 199,
			blockLength: 96,
			seed: 1
		});
		expect(r.valid).toBe(true);
		expect(r.pValue).toBeLessThan(0.05);
		expect(r.nSurrogates).toBe(199);
	});

	it('does NOT flag pure noise as rhythmic', () => {
		const rng = createSeededRNG(77);
		const noise = Array.from({ length: 2048 }, () => rng() - 0.5);
		const r = surrogateTest(noise, bandPower, {
			method: 'block',
			nSurrogates: 199,
			blockLength: 96,
			seed: 2
		});
		expect(r.pValue).toBeGreaterThan(0.05);
	});

	it('demonstrates the circularity: phase surrogates cannot detect a rhythm', () => {
		// Phase randomisation preserves the spectrum, so the null already
		// contains the rhythm and the test has essentially no power. This is the
		// trap surrogateAdvice() warns about, pinned here as a regression test.
		const y = rhythm(2048, 24, 5, 1);
		const block = surrogateTest(y, bandPower, {
			method: 'block',
			nSurrogates: 199,
			blockLength: 96,
			seed: 3
		});
		const phase = surrogateTest(y, bandPower, { method: 'phase', nSurrogates: 199, seed: 3 });
		expect(block.pValue).toBeLessThan(0.05);
		expect(phase.pValue).toBeGreaterThan(block.pValue);
	});

	it('never returns p = 0', () => {
		const y = rhythm(1024, 24, 100, 0.1);
		const r = surrogateTest(y, bandPower, { method: 'ar1', nSurrogates: 99, seed: 4 });
		expect(r.pValue).toBeGreaterThan(0);
		expect(r.pValue).toBeCloseTo(1 / 100, 10);
	});

	it('is reproducible from its seed', () => {
		const y = rhythm(512, 24, 2, 1);
		const opts = { method: 'ar1', nSurrogates: 49, seed: 99 };
		expect(surrogateTest(y, bandPower, opts).pValue).toBe(surrogateTest(y, bandPower, opts).pValue);
	});

	it('supports a lower-tail test', () => {
		const y = rhythm(1024, 24, 5, 0.5);
		const upper = surrogateTest(y, bandPower, { method: 'ar1', nSurrogates: 99, seed: 5 });
		const lower = surrogateTest(y, bandPower, {
			method: 'ar1',
			nSurrogates: 99,
			seed: 5,
			lowerTail: true
		});
		expect(upper.pValue).toBeLessThan(lower.pValue);
	});

	it('reports progress', () => {
		const onProgress = vi.fn();
		surrogateTest(rhythm(256), bandPower, { nSurrogates: 10, seed: 1, onProgress });
		expect(onProgress).toHaveBeenCalledTimes(10);
		expect(onProgress).toHaveBeenLastCalledWith(10, 10);
	});

	it('survives a statistic that throws on surrogates', () => {
		let calls = 0;
		const flaky = (y) => {
			calls++;
			if (calls > 1 && calls % 2 === 0) throw new Error('nope');
			return y[0];
		};
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const r = surrogateTest(rhythm(256), flaky, { nSurrogates: 20, seed: 1 });
		expect(r.valid).toBe(true);
		expect(r.nSurrogates).toBeLessThan(20);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it('fails cleanly on unusable input', () => {
		expect(surrogateTest([1, 2, 3], bandPower).valid).toBe(false);
		expect(surrogateTest(rhythm(256), bandPower, { method: 'iaaft' }).reason).toMatch(/unknown/);
		expect(surrogateTest(rhythm(256), () => NaN).reason).toMatch(/not finite/);
		expect(
			surrogateTest(rhythm(256), () => {
				throw new Error('x');
			}).reason
		).toMatch(/threw/);
	});
});

describe('surrogateAdvice', () => {
	it('warns about the phase/rhythmicity circularity', () => {
		expect(surrogateAdvice('phase', 'rhythmicity')).toMatch(/little or no power/);
		expect(surrogateAdvice('aaft', 'rhythmicity')).toMatch(/little or no power/);
	});

	it('warns that plain shuffling is anti-conservative', () => {
		expect(surrogateAdvice('shuffle', 'rhythmicity')).toMatch(/anti-conservative/);
	});

	it('warns that ar1 says nothing about association', () => {
		expect(surrogateAdvice('ar1', 'association')).toMatch(/two series/);
	});

	it('is silent for sound pairings', () => {
		expect(surrogateAdvice('block', 'rhythmicity')).toBe('');
		expect(surrogateAdvice('ar1', 'rhythmicity')).toBe('');
		expect(surrogateAdvice('phase', 'association')).toBe('');
	});
});
