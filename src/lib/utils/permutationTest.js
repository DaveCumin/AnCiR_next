// @ts-nocheck
/**
 * Permutation Testing Utility
 *
 * Provides reproducible permutation tests for curve fitting significance testing.
 * Uses @stdlib random for seeded, reproducible randomness.
 *
 * EXCHANGEABILITY. The default scheme ('shuffle') permutes individual y values, so its null
 * distribution is that of independent, exchangeable observations. Activity and most other
 * time series are autocorrelated, and then the shuffle null is too narrow: on AR(1) noise
 * with no rhythm (n = 240 hourly, 24 h cosinor, 300 records, 199 permutations) the shuffle
 * test rejected at 0.05 in 32% of records at phi = 0.5 and 38% at phi = 0.9, the same as
 * the F-test (review finding FIT-5, 2026-10-03; reproduced here at 1,000 records:
 * 0.332 and 0.374). It is NOT a remedy for autocorrelation.
 *
 * The 'block' scheme keeps short-range dependence: the series is cut, from a random
 * circular offset, into blocks one period long, each block is rotated circularly by a
 * random amount (which scrambles its phase relative to the rhythm) and the blocks are put
 * in a random order. Measured false-positive rates at alpha 0.05 (same design, 1,000
 * records): 0.042 at phi = 0, 0.046 at phi = 0.5, 0.015 at phi = 0.9; 300 records each:
 * 0.040 at n = 168 (phi 0.5), 0.000 at 15 min sampling (n = 960, phi 0.95). Power is
 * somewhat lower than the shuffle test's on independent data (amplitude 0.3 SD, phi 0:
 * 0.75 against 0.80; amplitude 0.5 SD, phi 0.5: 0.78, where the shuffle test's 0.98 is
 * not a valid comparison). permutationScheme.calibration.test.js re-runs a reduced version
 * of this simulation. residualAutocorrelationWarning flags records where the shuffle scheme
 * is not valid.
 */

import minstd from '@stdlib/random-base-minstd-shuffle';

const MINSTD_MAX = 2147483646;
const DEFAULT_PERMUTATION_SEED = 12345;

/**
 * Normalize a seed to valid MINSTD range
 * @param {number | string | undefined} seed
 * @returns {number}
 */
function normalizeSeed(seed) {
	const numericSeed = Math.trunc(Number(seed));
	if (!Number.isFinite(numericSeed)) {
		return 1;
	}
	return ((((numericSeed - 1) % MINSTD_MAX) + MINSTD_MAX) % MINSTD_MAX) + 1;
}

/**
 * Create a seeded random number generator
 * @param {number} seed - Seed for reproducibility
 * @returns {() => number} Function that returns random numbers in [0, 1)
 */
export function createSeededRNG(seed) {
	const normalizedSeed = normalizeSeed(seed);
	const prng = minstd.factory({ seed: normalizedSeed });
	return prng.normalized;
}

/**
 * Shuffle an array using Fisher-Yates with a seeded RNG
 * @param {number[]} arr - Array to shuffle
 * @param {() => number} rng - Seeded random number generator
 * @returns {number[]} Shuffled copy of array
 */
function shuffleArraySeeded(arr, rng) {
	const shuffled = [...arr];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}
	return shuffled;
}

/**
 * Circular one-period block permutation of `arr` (see the header): a random circular offset,
 * blocks of `blockLength` samples (the last may be shorter), each rotated by a random amount,
 * in a random order.
 * @param {number[]} arr
 * @param {number} blockLength  samples per block (>= 1)
 * @param {() => number} rng
 * @returns {number[]}
 */
export function blockPermuteSeeded(arr, blockLength, rng) {
	const n = arr.length;
	const L = Math.max(1, Math.min(n, Math.round(blockLength)));
	const off = Math.floor(rng() * L);
	const rolled = [...arr.slice(off), ...arr.slice(0, off)];
	const blocks = [];
	for (let b = 0; b * L < n; b++) {
		const blk = rolled.slice(b * L, (b + 1) * L);
		const r = Math.floor(rng() * blk.length);
		blocks.push([...blk.slice(r), ...blk.slice(0, r)]);
	}
	for (let i = blocks.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[blocks[i], blocks[j]] = [blocks[j], blocks[i]];
	}
	return blocks.flat();
}

/**
 * Lag-1 autocorrelation of a residual series (missing values skipped pairwise), or NaN
 * when fewer than 3 finite values.
 * @param {ArrayLike<number>} e
 * @returns {number}
 */
export function lag1Autocorrelation(e) {
	const v = [];
	for (const x of e ?? []) v.push(Number.isFinite(x) ? x : NaN);
	const fin = v.filter(Number.isFinite);
	if (fin.length < 3) return NaN;
	const m = fin.reduce((a, b) => a + b, 0) / fin.length;
	let num = 0;
	let den = 0;
	for (let i = 0; i < v.length; i++) {
		if (!Number.isFinite(v[i])) continue;
		den += (v[i] - m) ** 2;
		if (i + 1 < v.length && Number.isFinite(v[i + 1])) num += (v[i] - m) * (v[i + 1] - m);
	}
	return den > 0 ? num / den : NaN;
}

/**
 * The lag-1 residual autocorrelation above which the shuffle test (and an i.i.d. F-test) is
 * not trustworthy: 0.2, or 2/sqrt(n) when larger (so short records do not warn on noise).
 * At 0.2 the residuals of AR(1) noise with phi = 0.2 sit at the median, and a 24 h cosinor's
 * F-test then rejects a true null 13% (n = 72), 20% (n = 240) and 20% (n = 960) of the time
 * instead of 5% (4,000 simulated records each, AR(1) noise, 1 h sampling; review fix of
 * 2026-10-04).
 * @param {number} n
 */
export function autocorrelationThreshold(n) {
	return Math.max(0.2, n > 0 ? 2 / Math.sqrt(n) : Infinity);
}

/**
 * Plain-language warning when a fit's residuals are strongly autocorrelated, or null.
 * @param {ArrayLike<number>} residuals  observed minus fitted
 * @param {object} [opts]
 * @param {string} [opts.label]  e.g. '"activity"'
 * @param {string} [opts.test]   what the warning is about, e.g. 'The permutation p-value'
 * @param {boolean} [opts.plural] `test` names several p-values ("assume", not "assumes")
 * @param {string} [opts.remedy]  the closing advice; defaults to the block scheme or the
 *   Surrogate Test node, for nodes that offer the block scheme
 * @returns {string|null}
 */
export const DEFAULT_AUTOCORRELATION_REMEDY =
	'Use the block permutation scheme here, or test the rhythm with the Surrogate Test node (block or AR(1) surrogates).';

export function residualAutocorrelationWarning(
	residuals,
	{ label = '', test = 'The p-value', plural = false, remedy = DEFAULT_AUTOCORRELATION_REMEDY } = {}
) {
	const r1 = lag1Autocorrelation(residuals);
	const n = Array.from(residuals ?? []).filter(Number.isFinite).length;
	if (!Number.isFinite(r1) || r1 <= autocorrelationThreshold(n)) return null;
	const who = label ? ` for ${label}` : '';
	const verb = plural ? 'assume' : 'assumes';
	return `${test}${who} ${verb} independent (exchangeable) observations, but the residuals are strongly autocorrelated (lag-1 r = ${r1.toFixed(2)}). With autocorrelation this large, rhythm tests that assume independence report p below 0.05 for data with no rhythm far more often than 5% of the time. ${remedy}`;
}

/**
 * Compute a statistic from a fit result
 * @param {Object} fitResult - Result from a fit function
 * @param {string} statistic - 'rmse' | 'rSquared'
 * @returns {number}
 */
function getStatistic(fitResult, statistic) {
	if (statistic === 'rmse') return fitResult.rmse;
	if (statistic === 'rSquared') return fitResult.rSquared;
	return NaN;
}

/**
 * Permutation test for curve fitting
 *
 * Tests if a model fit is significantly better than random. Permutes y-values
 * while keeping x fixed, refits the model, and compares test statistics.
 *
 * @param {number[]} x - Predictor values (kept fixed)
 * @param {number[]} y - Response values (permuted)
 * @param {Function} fitFn - Function(x, y) => {rmse, rSquared, ...}
 * @param {Object} options - Options object
 * @param {string} options.statistic - Which statistic to test: 'rmse' or 'rSquared' (default: 'rSquared')
 * @param {number} options.nPermutations - Number of permutations (default: 999)
 * @param {number} options.seed - Seed for reproducible permutations (default: random)
 * @param {Function} options.onProgress - Callback(current, total) for progress updates
 * @param {'shuffle'|'block'} [options.scheme] - 'shuffle' (default; assumes exchangeable
 *   observations) or 'block' (circular one-period blocks; see the header)
 * @param {number} [options.blockLength] - samples per block for the 'block' scheme
 * @returns {Object} {pValue, observedStat, permutedStats, nPermutations, significant}
 */
export function permutationTest(x, y, fitFn, options = {}) {
	const {
		statistic = 'rSquared',
		nPermutations = 999,
		seed = DEFAULT_PERMUTATION_SEED,
		onProgress = null,
		scheme = 'shuffle',
		blockLength = null
	} = options;
	const permute = makePermuter(scheme, blockLength, y.length);
	if (!permute) return blockUnavailable(seed);

	// Fit original data
	let originalFit;
	try {
		originalFit = fitFn(x, y);
	} catch (e) {
		console.error('Permutation test: Failed to fit original data', e);
		return {
			pValue: NaN,
			observedStat: NaN,
			permutedStats: [],
			nPermutations: 0,
			significant: false,
			error: true
		};
	}

	const observedStat = getStatistic(originalFit, statistic);
	const isMinimizationStat = statistic === 'rmse';

	// Create seeded RNG for reproducibility
	const rng = createSeededRNG(seed);

	// Generate permutations
	const permutedStats = [];
	let failedFits = 0;

	for (let i = 0; i < nPermutations; i++) {
		// Permute y-values (shuffle or blocks) while keeping x fixed
		const yPermuted = permute(y, rng);

		try {
			const permutedFit = fitFn(x, yPermuted);
			const permutedStat = getStatistic(permutedFit, statistic);
			permutedStats.push(permutedStat);
		} catch {
			// Fit failed for this permutation — skip it (counted + warned below,
			// since skipped permutations shrink the p-value denominator)
			failedFits++;
		}

		if (onProgress) {
			onProgress(i + 1, nPermutations);
		}
	}
	if (failedFits > 0) {
		console.warn(
			`Permutation test: ${failedFits}/${nPermutations} permutation fits failed and were skipped`
		);
	}

	// Compute p-value
	// For minimization stats (rmse): count how many are <= observed
	// For maximization stats (r-squared): count how many are >= observed
	const extremeCount = permutedStats.filter((s) =>
		isMinimizationStat ? s <= observedStat : s >= observedStat
	).length;

	// Add 1 to avoid p = 0
	const pValue = (extremeCount + 1) / (permutedStats.length + 1);
	const significant = pValue < 0.05;

	return {
		pValue,
		observedStat,
		permutedStats,
		nPermutations: permutedStats.length,
		significant,
		seed, // Return seed for reproducibility
		error: false
	};
}

/**
 * Async permutation test with progress tracking (non-blocking)
 *
 * Processes permutations in batches to avoid blocking the UI.
 * Identical to permutationTest() but yields to event loop between batches.
 *
 * @param {number[]} x - Predictor values (kept fixed)
 * @param {number[]} y - Response values (permuted)
 * @param {Function} fitFn - Function(x, y) => {rmse, rSquared, ...}
 * @param {Object} options - Options object (see permutationTest)
 * @param {number} options.batchSize - Permutations per batch before yielding (default: 50)
 * @returns {Promise<Object>} Promise resolving to {pValue, observedStat, ...}
 */
export async function permutationTestAsync(x, y, fitFn, options = {}) {
	const {
		statistic = 'rSquared',
		nPermutations = 999,
		seed = DEFAULT_PERMUTATION_SEED,
		batchSize = 50,
		onProgress = null,
		scheme = 'shuffle',
		blockLength = null
	} = options;
	const permute = makePermuter(scheme, blockLength, y.length);
	if (!permute) return blockUnavailable(seed);

	// Fit original data
	let originalFit;
	try {
		originalFit = fitFn(x, y);
	} catch (e) {
		console.error('Permutation test: Failed to fit original data', e);
		return {
			pValue: NaN,
			observedStat: NaN,
			permutedStats: [],
			nPermutations: 0,
			significant: false,
			error: true
		};
	}

	const observedStat = getStatistic(originalFit, statistic);
	const isMinimizationStat = statistic === 'rmse';

	// Create seeded RNG for reproducibility
	const rng = createSeededRNG(seed);

	// Generate permutations in batches
	const permutedStats = [];
	let failedFits = 0;

	for (let batch = 0; batch < nPermutations; batch += batchSize) {
		const batchEnd = Math.min(batch + batchSize, nPermutations);

		for (let i = batch; i < batchEnd; i++) {
			const yPermuted = permute(y, rng);

			try {
				const permutedFit = fitFn(x, yPermuted);
				const permutedStat = getStatistic(permutedFit, statistic);
				permutedStats.push(permutedStat);
			} catch {
				// Fit failed for this permutation — skip it (counted + warned below)
				failedFits++;
			}

			if (onProgress) {
				onProgress(i + 1, nPermutations);
			}
		}

		// Yield to event loop to allow UI updates
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	if (failedFits > 0) {
		console.warn(
			`Permutation test: ${failedFits}/${nPermutations} permutation fits failed and were skipped`
		);
	}

	// Compute p-value
	const extremeCount = permutedStats.filter((s) =>
		isMinimizationStat ? s <= observedStat : s >= observedStat
	).length;

	const pValue = (extremeCount + 1) / (permutedStats.length + 1);
	const significant = pValue < 0.05;

	return {
		pValue,
		observedStat,
		permutedStats,
		nPermutations: permutedStats.length,
		significant,
		seed,
		error: false
	};
}

/**
 * The permutation function for a scheme, or null when the block scheme cannot run (no
 * block length, or fewer than two blocks in the series).
 */
function makePermuter(scheme, blockLength, n) {
	if (scheme !== 'block') return (arr, rng) => shuffleArraySeeded(arr, rng);
	const L = Math.round(Number(blockLength));
	if (!(L >= 2) || 2 * L > n) return null;
	return (arr, rng) => blockPermuteSeeded(arr, L, rng);
}

function blockUnavailable(seed) {
	return {
		pValue: NaN,
		observedStat: NaN,
		permutedStats: [],
		nPermutations: 0,
		significant: false,
		seed,
		error: true,
		reason: 'block'
	};
}

/**
 * Recommend number of permutations based on sample size
 * For sparse data, fewer permutations are needed for valid inference
 * @param {number} n - Sample size
 * @returns {number} Recommended number of permutations
 */
export function recommendPermutations(n) {
	if (n < 10) return 199; // Very sparse
	if (n < 20) return 499; // Sparse
	if (n < 50) return 999; // Moderate
	return 9999; // Dense
}
