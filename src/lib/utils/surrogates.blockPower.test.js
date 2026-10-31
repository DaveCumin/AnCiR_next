// @ts-nocheck
/**
 * SPEC-U1 (2026-10-03 review, "possible issue, not confirmed"): the Surrogate Test node's
 * default null, a moving-block bootstrap with ONE-CYCLE (24 h) blocks, may lose power against
 * the AR(1) red-noise null on rhythmic records while holding its size.
 *
 * Verdict: CONFIRMED. Decision (David, 2026-11-01): new Surrogate Test nodes use 6 h blocks
 * (SurrogateTest.svelte NEW_NODE_BLOCK_HOURS); a saved node keeps the block it stored
 * (SurrogateTest.blockDefault.svelte.test.js). The block-PERMUTATION scheme of the fit nodes is a
 * different construction and keeps one-period blocks (permutationScheme.calibration.test.js).
 * Why it happens: a 24 h block always holds one whole cycle of
 * the rhythm, so every bootstrap series is a chain of complete cycles with random phases. Its
 * band power keeps part of the rhythm (incoherent sum) and the null distribution is pushed up
 * towards the observed statistic.
 *
 * The simulation runs the node's own statistic (peak FFT magnitude in the 20 to 28 h band,
 * bandPowerStatistic in SurrogateTest.svelte) through surrogateTest, on 10-day hourly records:
 * AR(1) noise (phi 0.5, innovation SD 1) plus a 24 h cosine.
 *
 * Fast run (always): 60 records x 49 surrogates per cell. Full run, with the numbers quoted in
 * the report: SURROGATE_POWER_FULL=1 pnpm vitest run src/lib/utils/surrogates.blockPower.test.js
 * (400 records x 199 surrogates per cell; results are printed to stderr).
 */
import { describe, it, expect } from 'vitest';
import { surrogateTest } from './surrogates.js';
import { computeFFT } from './fft.js';

const FULL = !!process.env.SURROGATE_POWER_FULL;
const NREC = FULL ? 400 : 60;
const NSUR = FULL ? 199 : 49;

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
	return { gauss };
}

/** The node's statistic: the largest FFT magnitude with period in [20, 28] h. */
function bandPower(times) {
	return (y) => {
		const { frequencies, magnitudes } = computeFFT(times, y);
		let best = 0;
		for (let i = 0; i < frequencies.length; i++) {
			const p = 1 / frequencies[i];
			if (p >= 20 && p <= 28 && magnitudes[i] > best) best = magnitudes[i];
		}
		return best;
	};
}

/** Rejection rate at 0.05 over NREC records (seeded: one stream per cell). */
function rejectionRate({ method, amp, blockLength = 24, phi = 0.5, n = 240, seed = 4242 }) {
	const { gauss } = lcg(seed);
	const t = Array.from({ length: n }, (_, i) => i);
	const stat = bandPower(t);
	let rej = 0;
	for (let k = 0; k < NREC; k++) {
		let e = 0;
		const y = t.map((ti) => {
			e = phi * e + gauss();
			return e + amp * Math.cos((2 * Math.PI * (ti - 5)) / 24);
		});
		const r = surrogateTest(y, stat, { method, nSurrogates: NSUR, seed: 1000 + k, blockLength });
		if (r.pValue < 0.05) rej++;
	}
	return rej / NREC;
}

function report(label, v) {
	process.stderr.write(`SPEC-U1 ${label}: ${v.toFixed(3)}\n`);
}

describe('SPEC-U1: one-cycle block bootstrap against the AR(1) null', () => {
	it('size: both nulls hold (or undershoot) 5% on AR(1) noise with no rhythm', () => {
		const block = rejectionRate({ method: 'block', amp: 0 });
		const ar1 = rejectionRate({ method: 'ar1', amp: 0 });
		report('size block24', block);
		report('size ar1', ar1);
		// Full run: 0.005 (block) and 0.013 (AR(1)); both are conservative, the block null most.
		expect(block).toBeLessThan(0.12);
		expect(ar1).toBeLessThan(0.12);
	}, 120000);

	it('power: the 24 h block null rejects a real rhythm far less often than the AR(1) null', () => {
		// Amplitude 0.6 (marginal noise SD 1.15).
		const block = rejectionRate({ method: 'block', amp: 0.6 });
		const ar1 = rejectionRate({ method: 'ar1', amp: 0.6 });
		report('power block24 amp0.6', block);
		report('power ar1 amp0.6', ar1);
		// Full run: 0.492 against 0.677 (fast run 0.400 against 0.567).
		expect(ar1 - block).toBeGreaterThan(0.1);
	}, 120000);

	it('a quarter-cycle (6 h) block holds size better and has more power than a 24 h block', () => {
		// Full run: size 0.043 against 0.005, power 0.775 against 0.492.
		const quarter = rejectionRate({ method: 'block', amp: 0.6, blockLength: 6 });
		const cycle = rejectionRate({ method: 'block', amp: 0.6 });
		report('power block6 amp0.6 (fast cell)', quarter);
		expect(quarter - cycle).toBeGreaterThan(0.1);
	}, 120000);

	it.runIf(FULL)(
		'full run: block lengths other than one cycle (for the recommendation)',
		() => {
			for (const L of [6, 12, 36, 48]) {
				report(`size block${L}`, rejectionRate({ method: 'block', amp: 0, blockLength: L }));
				report(
					`power block${L} amp0.6`,
					rejectionRate({ method: 'block', amp: 0.6, blockLength: L })
				);
			}
			for (const phi of [0.8]) {
				report(`size ar1 phi${phi}`, rejectionRate({ method: 'ar1', amp: 0, phi }));
				report(`size block24 phi${phi}`, rejectionRate({ method: 'block', amp: 0, phi }));
				report(
					`size block6 phi${phi}`,
					rejectionRate({ method: 'block', amp: 0, phi, blockLength: 6 })
				);
			}
		},
		1800000
	);
});
