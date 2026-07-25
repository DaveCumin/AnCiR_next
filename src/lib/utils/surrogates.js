// @ts-nocheck
/**
 * Surrogate time series — resampling nulls that PRESERVE structure a plain
 * shuffle destroys.
 *
 * Why this exists: `utils/permutationTest.js` shuffles values, which destroys
 * autocorrelation. For a time series that makes the null far too easy to beat,
 * because real series are autocorrelated whether or not they are rhythmic.
 * These generators keep the nuisance structure and randomise only the part
 * being tested.
 *
 * ── Choosing one is a scientific decision, not a default ──────────────────
 *
 * Each answers a DIFFERENT question, and the wrong choice usually yields a
 * test with no power rather than an obviously wrong answer:
 *
 * - `phase` (FT surrogates, Theiler et al. 1992, Physica D 58:77-94)
 *   Randomises Fourier phases, keeps the amplitude spectrum. By
 *   Wiener-Khinchin this preserves the autocorrelation EXACTLY — which means
 *   it also preserves any periodicity. Right for: cross-correlation between
 *   two series, phase coupling, nonlinearity. **WRONG for "is there a 24 h
 *   rhythm"**, because the surrogate keeps the very peak being tested. That
 *   circularity is easy to miss; `surrogateAdvice()` below warns about it.
 *
 * - `aaft` (Amplitude Adjusted Fourier Transform, Theiler et al. 1992)
 *   As `phase`, but also preserves the marginal amplitude distribution. Use
 *   when the data are markedly non-Gaussian — activity counts are strongly
 *   skewed and zero-inflated, so this matters here.
 *
 * - `block` (moving-block bootstrap, Künsch 1989, Ann. Statist. 17:1217-1241)
 *   Resamples contiguous blocks. Preserves LOCAL structure without pinning the
 *   global spectrum, so it CAN test rhythmicity. Block length is the sensitive
 *   choice; for circadian data a whole number of cycles is the natural default.
 *
 * - `ar1` (red-noise, Torrence & Compo 1998 §4)
 *   Fits an AR(1) and simulates from it. The standard null for "is this
 *   spectral peak real", and the natural companion to the CWT node.
 *   CAVEAT, measured while building this: a smooth, near-deterministic rhythm
 *   has a lag-1 autocorrelation close to 1 (a 24 h wave sampled every 15 min
 *   gives alpha ~ 0.998), so the fitted AR(1) is very red and carries a lot of
 *   LOW-frequency power. Test a BAND-limited statistic (power near the period
 *   of interest), not a global spectral maximum, or the surrogate's long-period
 *   power will masquerade as a competitive peak and destroy the test's power.
 *
 * All generators take the seeded RNG from permutationTest.js, so a surrogate
 * run is reproducible from its seed.
 */
import { createSeededRNG } from './permutationTest.js';
import { fftInPlace, ifftInPlace, nextPowerOfTwo } from './fft.js';
import { mean } from '$lib/components/plotbits/helpers/wrangleData.js';

export const SURROGATE_METHODS = ['phase', 'aaft', 'block', 'ar1', 'shuffle'];

/** Standard normal deviates via Box-Muller, driven by the seeded RNG. */
function gaussian(rng) {
	let u = 0;
	while (u === 0) u = rng();
	const v = rng();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Finite values only, as plain numbers. */
function cleanValues(values) {
	return (values ?? [])
		.filter((v) => v != null && v !== '' && Number.isFinite(Number(v)))
		.map(Number);
}

/**
 * Phase-randomised (FT) surrogate. Preserves the amplitude spectrum exactly,
 * hence the autocorrelation; randomises phases.
 *
 * Conjugate symmetry is enforced so the inverse transform is real: phase(-f)
 * = -phase(f), with the DC and Nyquist bins left real. Skipping that is the
 * classic bug — it yields a complex "series" whose real part has the wrong
 * spectrum.
 */
export function phaseRandomise(values, rng) {
	const y = cleanValues(values);
	const n = y.length;
	if (n < 4) return [...y];

	const nPad = nextPowerOfTwo(n);
	const re = new Float64Array(nPad);
	const im = new Float64Array(nPad);
	const mu = mean(y);
	for (let i = 0; i < n; i++) re[i] = y[i] - mu;
	fftInPlace(re, im);

	const half = nPad / 2;
	for (let k = 1; k < half; k++) {
		const phi = 2 * Math.PI * rng();
		const mag = Math.hypot(re[k], im[k]);
		const nk = nPad - k;
		re[k] = mag * Math.cos(phi);
		im[k] = mag * Math.sin(phi);
		re[nk] = re[k];
		im[nk] = -im[k]; // conjugate symmetry keeps the result real
	}
	// DC and Nyquist have no free phase; randomising them would make the output complex.
	im[0] = 0;
	if (half < nPad) im[half] = 0;

	ifftInPlace(re, im);
	const out = new Array(n);
	for (let i = 0; i < n; i++) out[i] = re[i] + mu;
	return out;
}

/**
 * AAFT surrogate: phase-randomise, then map the result back onto the original
 * values by rank. Preserves both the spectrum (approximately) and the marginal
 * distribution (exactly).
 */
export function aaftSurrogate(values, rng) {
	const y = cleanValues(values);
	const n = y.length;
	if (n < 4) return [...y];

	// Rank-map the data onto Gaussian deviates, phase-randomise there, then
	// rank-map back. Working in the Gaussian domain is what makes the spectrum
	// of the returned series close to the original's despite the final remap.
	const gauss = Array.from({ length: n }, () => gaussian(rng)).sort((a, b) => a - b);
	const orderByValue = y.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
	const gaussianised = new Array(n);
	orderByValue.forEach((e, rank) => (gaussianised[e.i] = gauss[rank]));

	const randomised = phaseRandomise(gaussianised, rng);

	const sortedOriginal = [...y].sort((a, b) => a - b);
	const orderBySurrogate = randomised.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
	const out = new Array(n);
	orderBySurrogate.forEach((e, rank) => (out[e.i] = sortedOriginal[rank]));
	return out;
}

/**
 * Moving-block bootstrap. Blocks are drawn with replacement from all possible
 * starting positions and concatenated until the original length is reached.
 *
 * @param {number} blockLength in SAMPLES
 */
export function blockBootstrap(values, rng, blockLength) {
	const y = cleanValues(values);
	const n = y.length;
	if (n < 4) return [...y];
	const L = Math.max(1, Math.min(n, Math.floor(blockLength) || 1));
	const maxStart = n - L;
	const out = [];
	while (out.length < n) {
		const start = Math.floor(rng() * (maxStart + 1));
		for (let i = 0; i < L && out.length < n; i++) out.push(y[start + i]);
	}
	return out;
}

/**
 * Fit an AR(1) by lag-1 autocorrelation and simulate a red-noise series with
 * the same mean, variance and lag-1 structure (Torrence & Compo 1998 §4).
 */
export function ar1Surrogate(values, rng) {
	const y = cleanValues(values);
	const n = y.length;
	if (n < 4) return [...y];

	const mu = mean(y);
	const dev = y.map((v) => v - mu);
	let num = 0;
	let den = 0;
	for (let i = 1; i < n; i++) num += dev[i] * dev[i - 1];
	for (let i = 0; i < n; i++) den += dev[i] * dev[i];
	// Clamp strictly inside the unit circle: |alpha| >= 1 is non-stationary and
	// would make the simulated series diverge.
	const alpha = den > 0 ? Math.max(-0.999, Math.min(0.999, num / den)) : 0;
	const variance = den / n;
	const innovationSd = Math.sqrt(Math.max(0, variance * (1 - alpha * alpha)));

	const out = new Array(n);
	// Start from the stationary distribution so there is no burn-in transient.
	let prev = Math.sqrt(variance) * gaussian(rng);
	for (let i = 0; i < n; i++) {
		prev = alpha * prev + innovationSd * gaussian(rng);
		out[i] = prev + mu;
	}
	return out;
}

/** Plain permutation — kept so the anti-conservative null can be compared against. */
export function shuffleSurrogate(values, rng) {
	const out = cleanValues(values);
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/**
 * Generate one surrogate by name.
 *
 * @param {number[]} values
 * @param {string} method one of SURROGATE_METHODS
 * @param {() => number} rng seeded RNG
 * @param {object} [opts] `{ blockLength }` for the block bootstrap
 */
export function makeSurrogate(values, method, rng, opts = {}) {
	switch (method) {
		case 'phase':
			return phaseRandomise(values, rng);
		case 'aaft':
			return aaftSurrogate(values, rng);
		case 'block':
			return blockBootstrap(values, rng, opts.blockLength ?? 24);
		case 'ar1':
			return ar1Surrogate(values, rng);
		case 'shuffle':
			return shuffleSurrogate(values, rng);
		default:
			throw new Error(`makeSurrogate: unknown method "${method}"`);
	}
}

/**
 * Empirical p-value for a statistic against a surrogate null.
 *
 * @param {number[]} values          observed series
 * @param {(y:number[]) => number} statFn  statistic to test (larger = more extreme by default)
 * @param {object} [options]
 * @param {string} [options.method='block']
 * @param {number} [options.nSurrogates=999]
 * @param {number} [options.seed=12345]
 * @param {number} [options.blockLength=24]
 * @param {boolean} [options.lowerTail=false] test for unusually SMALL statistics
 * @param {(i:number,total:number)=>void} [options.onProgress]
 * @returns {{pValue:number, observed:number, surrogateStats:number[], nSurrogates:number,
 *            method:string, seed:number, significant:boolean, valid:boolean, reason:string}}
 */
export function surrogateTest(values, statFn, options = {}) {
	const {
		method = 'block',
		nSurrogates = 999,
		seed = 12345,
		blockLength = 24,
		lowerTail = false,
		onProgress = null
	} = options;

	const y = cleanValues(values);
	const fail = (reason) => ({
		pValue: NaN,
		observed: NaN,
		surrogateStats: [],
		nSurrogates: 0,
		method,
		seed,
		significant: false,
		valid: false,
		reason
	});

	if (y.length < 8) return fail('need at least 8 finite samples');
	if (!SURROGATE_METHODS.includes(method)) return fail(`unknown method "${method}"`);

	let observed;
	try {
		observed = Number(statFn(y));
	} catch {
		return fail('the statistic threw on the observed series');
	}
	if (!Number.isFinite(observed)) return fail('the statistic is not finite on the observed series');

	const rng = createSeededRNG(seed);
	const surrogateStats = [];
	let failures = 0;
	for (let i = 0; i < nSurrogates; i++) {
		try {
			const s = Number(statFn(makeSurrogate(y, method, rng, { blockLength })));
			if (Number.isFinite(s)) surrogateStats.push(s);
			else failures++;
		} catch {
			failures++;
		}
		onProgress?.(i + 1, nSurrogates);
	}
	if (failures > 0) {
		console.warn(`surrogateTest: ${failures}/${nSurrogates} surrogates failed and were skipped`);
	}
	if (surrogateStats.length === 0) return fail('every surrogate failed');

	const extreme = surrogateStats.filter((s) => (lowerTail ? s <= observed : s >= observed)).length;
	// (k + 1) / (m + 1) — the same convention as permutationTest, so p is never 0.
	const pValue = (extreme + 1) / (surrogateStats.length + 1);

	return {
		pValue,
		observed,
		surrogateStats,
		nSurrogates: surrogateStats.length,
		method,
		seed,
		significant: pValue < 0.05,
		valid: true,
		reason: ''
	};
}

/**
 * Warn when the chosen surrogate cannot answer the question being asked.
 *
 * The circularity worth catching: phase/AAFT surrogates preserve the amplitude
 * spectrum, so testing "is there a rhythm" against them tests a null that
 * already contains the rhythm.
 *
 * @param {string} method
 * @param {string} question 'rhythmicity' | 'association' | 'nonlinearity'
 * @returns {string} empty when the pairing is sound
 */
export function surrogateAdvice(method, question) {
	if ((method === 'phase' || method === 'aaft') && question === 'rhythmicity') {
		return (
			`${method} surrogates preserve the amplitude spectrum, so they also preserve the very ` +
			'periodicity you are testing for. This test will have little or no power. Use a block ' +
			'bootstrap or an AR(1) red-noise null for rhythmicity.'
		);
	}
	if (method === 'shuffle') {
		return (
			'Plain shuffling destroys autocorrelation, so the null is far easier to beat than a real ' +
			'time series. Expect anti-conservative (too small) p-values. Prefer block or ar1.'
		);
	}
	if (method === 'ar1' && question === 'association') {
		return (
			'An AR(1) null models one series in isolation; it says nothing about the dependence ' +
			'between two series. Use phase or aaft surrogates for association questions.'
		);
	}
	return '';
}
