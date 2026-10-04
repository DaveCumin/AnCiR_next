// @ts-nocheck
import {
	fitCosineCurves,
	fitCosinorFixed,
	evaluateCosinorAtPoints,
	FREE_PERIOD_DEFAULTS
} from '$lib/utils/cosinor.js';
import { fitRectangularWave, evaluateRectWaveAtPoints } from '$lib/utils/rectwave.js';
import { fitDoubleLogistic, evaluateDoubleLogisticAtPoints } from '$lib/utils/doublelogistic.js';
import {
	permutationTest,
	permutationTestAsync,
	recommendPermutations,
	lag1Autocorrelation
} from '$lib/utils/permutationTest.js';

export const FIT_FUNCTION_MODELS = ['cosinor', 'rectangular', 'doublelogistic'];

// Default permutation-test args, shared by the dedicated fit nodes (Cosinor,
// Rectangular wave, Double logistic) so they all expose the same controls/output.
export const PERMUTATION_DEFAULTS = {
	permuteTest: false,
	nPermutations: 999,
	permutationSeed: 12345,
	permutationStatistic: 'rSquared',
	// 'shuffle' permutes single values (assumes exchangeable observations); 'block' permutes
	// circular one-period blocks, which keeps short-range autocorrelation (permutationTest.js).
	permutationScheme: 'shuffle'
};

function fitCosinorModel(t, x, options = {}) {
	const useFixedPeriod = options.useFixedPeriod ?? false;
	if (useFixedPeriod) {
		const fixedPeriod = Number(options.fixedPeriod ?? 24);
		const nHarmonics = Math.max(1, Math.trunc(Number(options.nHarmonics ?? 1)));
		const alpha = Number(options.alpha ?? 0.05);
		const fixedResult = fitCosinorFixed(t, x, fixedPeriod, nHarmonics, alpha);
		if (!fixedResult) return null;
		return {
			model: 'cosinor',
			mode: 'fixed',
			parameters: {
				mode: 'fixed',
				period: fixedPeriod,
				M: fixedResult.M,
				harmonics: fixedResult.harmonics,
				alpha
			},
			fixedStats: fixedResult,
			fitted: fixedResult.fitted,
			rmse: fixedResult.RMSE,
			rSquared: fixedResult.R2,
			pValue: fixedResult.pF,
			significant: Number.isFinite(fixedResult.pF) ? fixedResult.pF < alpha : false
		};
	}

	const Ncurves = Math.max(1, Math.trunc(Number(options.Ncurves ?? 1)));
	// Bounded free period (see FREE_PERIOD_DEFAULTS in cosinor.js).
	const fitResult = fitCosineCurves(t, x, Ncurves, {
		minPeriod: options.minPeriod ?? FREE_PERIOD_DEFAULTS.minPeriod,
		maxPeriod: options.maxPeriod ?? FREE_PERIOD_DEFAULTS.maxPeriod
	});
	if (!fitResult) return null;
	return {
		model: 'cosinor',
		mode: 'free',
		parameters: {
			mode: 'free',
			Ncurves,
			...fitResult.parameters
		},
		fitted: fitResult.fitted,
		rmse: fitResult.rmse,
		rSquared: fitResult.rSquared,
		// converged / atBound / periodRange, for the node's warnings
		diagnostics: fitResult.diagnostics
	};
}

function fitRectangularModel(t, x, options = {}) {
	const fixOmega = options.fixOmega ?? false;
	const fixedPeriod = Number(options.fixedPeriod ?? 24);
	const fitResult = fitRectangularWave(t, x, {
		fixKappa: options.fixKappa ?? false,
		fixedKappa: options.fixedKappa ?? 5,
		fixOmega,
		// rectwave.js pins ω, not the period: derive it from fixedPeriod (as RectangularWave
		// and movinganalysis do), else a fixed-period fit silently ran at 24 h.
		fixedOmega: options.fixedOmega ?? (fixOmega ? (2 * Math.PI) / fixedPeriod : null),
		fixDutyCycle: options.fixDutyCycle ?? false,
		fixedDutyCycle: options.fixedDutyCycle ?? 0.5,
		maxIterations: options.maxIterations ?? 10000,
		tolerance: options.tolerance ?? 1e-6,
		numStarts: options.numStarts ?? 5,
		// Free-period range (rectwave.js defaults to FREE_PERIOD_DEFAULTS when absent).
		minPeriod: options.minPeriod ?? FREE_PERIOD_DEFAULTS.minPeriod,
		maxPeriod: options.maxPeriod ?? FREE_PERIOD_DEFAULTS.maxPeriod
	});
	if (!fitResult) return null;
	return {
		model: 'rectangular',
		parameters: fitResult.parameters,
		fitted: fitResult.fitted,
		rmse: fitResult.rmse,
		rSquared: fitResult.rSquared,
		period: fitResult.period,
		acrophase: fitResult.acrophase,
		rss: fitResult.rss,
		diagnostics: fitResult.diagnostics
	};
}

function fitDoubleLogisticModel(t, x, options = {}) {
	const periodic = options.periodic ?? true;
	const fitResult = fitDoubleLogistic(t, x, {
		periodic,
		fixK1: options.fixK1 ?? false,
		fixedK1: options.fixedK1 ?? 0.5,
		fixK2: options.fixK2 ?? false,
		fixedK2: options.fixedK2 ?? 0.5,
		fixPeriod: options.fixPeriod ?? false,
		fixedPeriod: options.fixedPeriod ?? 24,
		maxIterations: options.maxIterations ?? 10000,
		tolerance: options.tolerance ?? 1e-6,
		numStarts: options.numStarts ?? 5,
		minPeriod: options.minPeriod ?? FREE_PERIOD_DEFAULTS.minPeriod,
		maxPeriod: options.maxPeriod ?? FREE_PERIOD_DEFAULTS.maxPeriod
	});
	if (!fitResult) return null;
	return {
		model: 'doublelogistic',
		periodic,
		parameters: fitResult.parameters,
		fitted: fitResult.fitted,
		rmse: fitResult.rmse,
		rSquared: fitResult.rSquared,
		rss: fitResult.rss,
		duration: fitResult.duration,
		onsetPhase: fitResult.onsetPhase,
		offsetPhase: fitResult.offsetPhase,
		dutyCycle: fitResult.dutyCycle,
		diagnostics: fitResult.diagnostics
	};
}

export function fitCurveModel(t, x, model, options = {}) {
	if (model === 'cosinor') return fitCosinorModel(t, x, options);
	if (model === 'rectangular') return fitRectangularModel(t, x, options);
	if (model === 'doublelogistic') return fitDoubleLogisticModel(t, x, options);
	return null;
}

export function evaluateCurveModelAtPoints(fitResult, model, tPoints) {
	if (!Array.isArray(tPoints)) return [];
	if (!fitResult?.parameters) return tPoints.map(() => NaN);

	if (model === 'cosinor') {
		if (fitResult.mode === 'fixed') {
			const { period, M, harmonics } = fitResult.parameters;
			const omega = (2 * Math.PI) / period;
			return tPoints.map((t) => {
				let val = M;
				for (let k = 0; k < (harmonics ?? []).length; k++) {
					const h = harmonics[k];
					const harmonicIndex = h.k ?? k + 1;
					val +=
						h.beta * Math.cos(harmonicIndex * omega * t) +
						h.gamma * Math.sin(harmonicIndex * omega * t);
				}
				return val;
			});
		}
		return evaluateCosinorAtPoints(fitResult.parameters, tPoints);
	}

	if (model === 'rectangular') {
		return evaluateRectWaveAtPoints(fitResult.parameters, tPoints);
	}

	if (model === 'doublelogistic') {
		return evaluateDoubleLogisticAtPoints(
			fitResult.parameters,
			fitResult.periodic ?? true,
			tPoints
		);
	}

	return tPoints.map(() => NaN);
}

/**
 * The period (hours) a fitted model repeats with, for the block permutation's block length:
 * the fixed period when the model fixes it, else the fitted one. NaN when there is none.
 */
export function fitModelPeriod(fit, model, options = {}) {
	if (model === 'cosinor') {
		if (options.useFixedPeriod) return Number(options.fixedPeriod ?? 24);
		const ws = (fit?.parameters?.cosines ?? []).map((c) => c.frequency).filter((w) => w > 0);
		// Several cosines: the block must hold the longest cycle.
		return ws.length ? (2 * Math.PI) / Math.min(...ws) : NaN;
	}
	if (model === 'rectangular') {
		if (options.fixOmega) return Number(options.fixedPeriod ?? 24);
		return Number(fit?.period);
	}
	if (model === 'doublelogistic') {
		if (!(options.periodic ?? true)) return NaN;
		if (options.fixPeriod) return Number(options.fixedPeriod ?? 24);
		return Number(fit?.parameters?.T);
	}
	return NaN;
}

function medianSpacing(tt) {
	const d = [];
	for (let i = 1; i < tt.length; i++) {
		const v = tt[i] - tt[i - 1];
		if (v > 0) d.push(v);
	}
	if (!d.length) return NaN;
	d.sort((a, b) => a - b);
	const m = d.length >> 1;
	return d.length % 2 ? d[m] : (d[m - 1] + d[m]) / 2;
}

/**
 * Permutation-test p-value for a fit of `model` (with `options`) on (tt, yy).
 * Uses fitCurveModel as the fit, so the observed and permuted statistics are
 * computed the same way.
 *
 * `args.permutationScheme` picks 'shuffle' (default; single values, which assumes the
 * observations are exchangeable) or 'block' (circular blocks one model period long, see
 * permutationTest.js). The block length is the model's period (fitModelPeriod) divided by
 * the median sampling interval; with no period, or fewer than two blocks in the record, the
 * block test cannot run and pValue is NaN with `unavailable` saying why.
 *
 * Returns { pValue, significant, observedStat, permutedStats, statistic, scheme,
 * blockLength, residualLag1, unavailable } — the whole null distribution, not just its tail
 * probability, so the nodes can show and export it, and the lag-1 autocorrelation of the
 * observed fit's residuals so they can warn when the shuffle scheme is not valid.
 * `permutedStats` is empty and pValue NaN when the test is disabled or there are too few
 * points.
 */
export function fitPermutationPValue(tt, yy, model, options, args) {
	const prep = preparePermutation(tt, yy, model, options, args);
	if (prep.done) return prep.done;
	return finishPermutation(prep, permutationTest(tt, yy, prep.fitFn, prep.testOptions));
}

/**
 * fitPermutationPValue, but yielding to the event loop between batches and reporting
 * progress, for the Fit waveform model panel. Same preparation, statistic, scheme, block
 * length and seed, so the panel and the headless engine report the same p for the same
 * session. (The panel used to call permutationTestAsync with an ASYNC fit function: every
 * statistic came back undefined and every p was 1 / (n + 1), "significant" whatever the
 * data.)
 * @param {{onProgress?: (current: number, total: number) => void}} [hooks]
 */
export async function fitPermutationPValueAsync(tt, yy, model, options, args, hooks = {}) {
	const prep = preparePermutation(tt, yy, model, options, args);
	if (prep.done) return prep.done;
	const res = await permutationTestAsync(tt, yy, prep.fitFn, {
		...prep.testOptions,
		onProgress: hooks.onProgress ?? null
	});
	return finishPermutation(prep, res);
}

/**
 * The permutation count a node asks for: `recommendPermutations(n)` when
 * `args.autoPermutations` is on (Fit waveform model, Fit trend), else `args.nPermutations`.
 */
export function resolvePermutationCount(args, n) {
	if (args?.autoPermutations) return recommendPermutations(n);
	return Math.max(1, Math.trunc(Number(args?.nPermutations ?? 999)));
}

/**
 * Everything both runners share: the disabled/too-short and block-unavailable early
 * returns (`done`), the observed fit's residual lag-1 autocorrelation, the block length,
 * and the options passed to permutationTest(Async).
 */
function preparePermutation(tt, yy, model, options, args) {
	const statistic = args?.permutationStatistic ?? 'rSquared';
	const scheme = args?.permutationScheme === 'block' ? 'block' : 'shuffle';
	const n = Array.isArray(tt) ? tt.length : 0;
	const off = (extra = {}) => ({
		pValue: NaN,
		significant: false,
		observedStat: NaN,
		permutedStats: [],
		statistic,
		scheme,
		blockLength: null,
		residualLag1: NaN,
		unavailable: null,
		...extra
	});
	if (!args?.permuteTest || n < 4) return { done: off() };
	// The observed fit, once, for its residual autocorrelation and (block scheme) its period.
	let observed = null;
	try {
		observed = fitCurveModel(tt, yy, model, options);
	} catch {
		observed = null;
	}
	const residualLag1 = observed?.fitted
		? lag1Autocorrelation(yy.map((v, i) => v - observed.fitted[i]))
		: NaN;
	let blockLength = null;
	if (scheme === 'block') {
		const period = fitModelPeriod(observed, model, options);
		const dt = medianSpacing(tt);
		blockLength = Number.isFinite(period) && dt > 0 ? Math.round(period / dt) : null;
		if (!(blockLength >= 2) || 2 * blockLength > n) {
			return {
				done: off({
					residualLag1,
					blockLength,
					unavailable: Number.isFinite(period)
						? `the record holds fewer than two ${Number(period.toFixed(2))} h blocks`
						: 'the model has no period to set the block length'
				})
			};
		}
	}
	return {
		done: null,
		statistic,
		scheme,
		blockLength,
		residualLag1,
		fitFn: (x, y) => fitCurveModel(x, y, model, options),
		testOptions: {
			statistic,
			nPermutations: resolvePermutationCount(args, n),
			seed: args.permutationSeed ?? 12345,
			scheme,
			blockLength
		}
	};
}

function finishPermutation(prep, res) {
	return {
		pValue: res.pValue,
		significant: res.significant,
		observedStat: res.observedStat,
		permutedStats: res.permutedStats ?? [],
		statistic: prep.statistic,
		scheme: prep.scheme,
		blockLength: prep.blockLength,
		residualLag1: prep.residualLag1,
		unavailable: null
	};
}

export function getFitModelDisplayName(model) {
	if (model === 'cosinor') return 'Cosinor';
	if (model === 'rectangular') return 'Rectangular wave';
	if (model === 'doublelogistic') return 'Double logistic';
	return 'Fit';
}
