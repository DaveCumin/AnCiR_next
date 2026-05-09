// @ts-nocheck
import { fitCosineCurves, fitCosinorFixed, evaluateCosinorAtPoints } from '$lib/utils/cosinor.js';
import { fitRectangularWave, evaluateRectWaveAtPoints } from '$lib/utils/rectwave.js';
import { fitDoubleLogistic, evaluateDoubleLogisticAtPoints } from '$lib/utils/doublelogistic.js';

export const FIT_FUNCTION_MODELS = ['cosinor', 'rectangular', 'doublelogistic'];

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
	const fitResult = fitCosineCurves(t, x, Ncurves);
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
		rSquared: fitResult.rSquared
	};
}

function fitRectangularModel(t, x, options = {}) {
	const fitResult = fitRectangularWave(t, x, {
		fixKappa: options.fixKappa ?? false,
		fixedKappa: options.fixedKappa ?? 5,
		fixOmega: options.fixOmega ?? false,
		fixedOmega: options.fixedOmega ?? null,
		fixedPeriod: options.fixedPeriod ?? 24,
		fixDutyCycle: options.fixDutyCycle ?? false,
		fixedDutyCycle: options.fixedDutyCycle ?? 0.5,
		maxIterations: options.maxIterations ?? 10000,
		tolerance: options.tolerance ?? 1e-6,
		numStarts: options.numStarts ?? 5
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
		rss: fitResult.rss
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
		numStarts: options.numStarts ?? 5
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
		dutyCycle: fitResult.dutyCycle
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

export function getFitModelDisplayName(model) {
	if (model === 'cosinor') return 'Cosinor';
	if (model === 'rectangular') return 'Rectangular wave';
	if (model === 'doublelogistic') return 'Double logistic';
	return 'Fit';
}
