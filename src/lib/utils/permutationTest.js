// @ts-nocheck
/**
 * Permutation Testing Utility
 *
 * Provides reproducible permutation tests for curve fitting significance testing.
 * Uses @stdlib random for seeded, reproducible randomness.
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
 * @returns {Object} {pValue, observedStat, permutedStats, nPermutations, significant}
 */
export function permutationTest(x, y, fitFn, options = {}) {
	const {
		statistic = 'rSquared',
		nPermutations = 999,
		seed = DEFAULT_PERMUTATION_SEED,
		onProgress = null
	} = options;

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
		// Shuffle y-values while keeping x fixed
		const yPermuted = shuffleArraySeeded(y, rng);

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
		onProgress = null
	} = options;

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
			const yPermuted = shuffleArraySeeded(y, rng);

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
