// @ts-nocheck
// movinganalysis.js — pure compute for the MovingAnalysis table process, extracted
// from MovingAnalysis.svelte so the (heavy) windowed loop can run in the compute
// worker. Contains getStatKeys + computeStatsForWindow (verbatim) plus
// computeMovingWindows, which runs the per-y, per-window loop. No DOM/Svelte deps.
import { runPeriodogramCalculation } from './periodogram.js';
import { fitCosineCurves, fitCosinorFixed } from './cosinor.js';
import { computeFFT } from './fft.js';
import { computeAutocorrelation } from './correlogram.js';
import { fitRectangularWave } from './rectwave.js';
import { fitDoubleLogistic } from './doublelogistic.js';
import { fitTrend } from './trendfit.js';

export function getStatKeys(args) {
	if (args.analysis === 'periodogram') {
		return ['peak_period', 'peak_power'];
	}
	if (args.analysis === 'cosinor') {
		if (args.useFixedPeriod) {
			const keys = ['mesor'];
			const H = Math.max(1, args.nHarmonics ?? 1);
			for (let h = 1; h <= H; h++) {
				keys.push(`H${h}_amplitude`, `H${h}_acrophase`);
			}
			keys.push('r2', 'rmse', 'pvalue');
			return keys;
		}
		const keys = [];
		const N = Math.max(1, args.Ncurves ?? 1);
		for (let c = 1; c <= N; c++) {
			keys.push(`C${c}_period`, `C${c}_amplitude`, `C${c}_phase`);
		}
		keys.push('r2', 'rmse');
		return keys;
	}
	if (args.analysis === 'fft') {
		return ['peak_period', 'peak_frequency', 'peak_magnitude'];
	}
	if (args.analysis === 'correlogram') {
		return ['peak_lag', 'peak_correlation'];
	}
	if (args.analysis === 'rectfit') {
		return ['mesor', 'amplitude', 'period', 'acrophase', 'duty_cycle', 'kappa', 'r2', 'rmse'];
	}
	if (args.analysis === 'doublelogistic') {
		const keys = ['mesor', 'amplitude', 'onset', 'offset', 'k1', 'k2'];
		if (args.dlPeriodic) keys.push('period');
		keys.push('r2', 'rmse');
		return keys;
	}
	if (args.analysis === 'trend') {
		const model = args.trendModel ?? 'linear';
		if (model === 'linear') return ['slope', 'intercept', 'r2', 'rmse'];
		// y = a*exp(b*x)  or  y = a + b*log(x)
		if (model === 'exponential' || model === 'logarithmic') return ['a', 'b', 'r2', 'rmse'];
		if (model === 'polynomial') {
			const deg = Math.max(0, Math.floor(args.trendPolyDegree ?? 2));
			const keys = [];
			for (let i = 0; i <= deg; i++) keys.push(`c${i}`);
			keys.push('r2', 'rmse');
			return keys;
		}
	}
	return [];
}

function computeStatsForWindow(tt, yy, args) {
	const stats = {};
	const keys = getStatKeys(args);
	for (const k of keys) stats[k] = NaN;
	if (tt.length < 3) return stats;

	if (args.analysis === 'periodogram') {
		const res = runPeriodogramCalculation({
			method: args.pgMethod ?? 'Lomb-Scargle',
			xData: tt,
			yData: yy,
			periodMin: args.periodMin,
			periodMax: args.periodMax,
			periodSteps: args.periodStep,
			binSize: args.pgBinSize ?? 0.25,
			chiSquaredAlpha: args.pgAlpha ?? 0.05
		});
		if (!res.y || res.y.length === 0) return stats;
		let bestIdx = 0;
		let bestPow = -Infinity;
		for (let i = 0; i < res.y.length; i++) {
			if (Number.isFinite(res.y[i]) && res.y[i] > bestPow) {
				bestPow = res.y[i];
				bestIdx = i;
			}
		}
		stats.peak_period = res.x[bestIdx];
		stats.peak_power = res.y[bestIdx];
		return stats;
	}

	if (args.analysis === 'cosinor') {
		if (args.useFixedPeriod) {
			const r = fitCosinorFixed(
				tt,
				yy,
				args.fixedPeriod ?? 24,
				Math.max(1, args.nHarmonics ?? 1),
				args.alpha ?? 0.05
			);
			if (!r) return stats;
			stats.mesor = r.M;
			for (let h = 0; h < r.harmonics.length; h++) {
				stats[`H${h + 1}_amplitude`] = r.harmonics[h].amplitude;
				stats[`H${h + 1}_acrophase`] = r.harmonics[h].acrophase_hrs;
			}
			stats.r2 = r.R2;
			stats.rmse = r.RMSE;
			stats.pvalue = r.pF;
			return stats;
		}
		const N = Math.max(1, args.Ncurves ?? 1);
		const r = fitCosineCurves(tt, yy, N);
		if (!r || !r.parameters?.cosines?.length) return stats;
		for (let c = 0; c < r.parameters.cosines.length; c++) {
			const cos = r.parameters.cosines[c];
			const period = cos.frequency ? (2 * Math.PI) / cos.frequency : NaN;
			stats[`C${c + 1}_period`] = period;
			stats[`C${c + 1}_amplitude`] = cos.amplitude;
			stats[`C${c + 1}_phase`] = cos.phase;
		}
		stats.r2 = r.rSquared;
		stats.rmse = r.rmse;
		return stats;
	}

	if (args.analysis === 'fft') {
		const freqStep = args.fftFreqStep > 0 ? args.fftFreqStep : null;
		const r = computeFFT(tt, yy, freqStep);
		if (!r.frequencies.length) return stats;
		let bestIdx = 0;
		for (let i = 1; i < r.magnitudes.length; i++) {
			if (r.magnitudes[i] > r.magnitudes[bestIdx]) bestIdx = i;
		}
		const freq = r.frequencies[bestIdx];
		stats.peak_frequency = freq;
		stats.peak_period = freq !== 0 ? 1 / freq : NaN;
		stats.peak_magnitude = r.magnitudes[bestIdx];
		return stats;
	}

	if (args.analysis === 'correlogram') {
		const minLag = args.corrMinLag > 0 ? args.corrMinLag : 0;
		const maxLag = args.corrMaxLag > 0 ? args.corrMaxLag : null;
		const r = computeAutocorrelation(tt, yy, null, maxLag, minLag);
		if (!r.lags?.length) return stats;
		// Skip lag 0 (always 1) when picking the peak; when minLag > 0, first entry is already valid
		let bestIdx = r.lags[0] === 0 ? 1 : 0;
		if (bestIdx >= r.correlations.length) return stats;
		for (let i = bestIdx + 1; i < r.correlations.length; i++) {
			if (r.correlations[i] > r.correlations[bestIdx]) bestIdx = i;
		}
		stats.peak_lag = r.lags[bestIdx];
		stats.peak_correlation = r.correlations[bestIdx];
		return stats;
	}

	if (args.analysis === 'rectfit') {
		const opts = {
			fixOmega: !!args.useFixedPeriod,
			fixedOmega: args.useFixedPeriod ? (2 * Math.PI) / (args.fixedPeriod ?? 24) : null,
			fixKappa: !!args.rwFixKappa,
			fixedKappa: args.rwFixedKappa ?? 5,
			fixDutyCycle: !!args.rwFixDutyCycle,
			fixedDutyCycle: args.rwFixedDutyCycle ?? 0.5
		};
		const r = fitRectangularWave(tt, yy, opts);
		if (!r) return stats;
		stats.mesor = r.parameters.M;
		stats.amplitude = r.parameters.A;
		stats.period = r.period;
		stats.acrophase = r.acrophase;
		stats.duty_cycle = r.parameters.dutyCycle;
		stats.kappa = r.parameters.kappa;
		stats.r2 = r.rSquared;
		stats.rmse = r.rmse;
		return stats;
	}

	if (args.analysis === 'doublelogistic') {
		const periodic = !!args.dlPeriodic;
		const opts = {
			periodic,
			fixK1: !!args.dlFixK1,
			fixedK1: args.dlFixedK1 ?? 0.5,
			fixK2: !!args.dlFixK2,
			fixedK2: args.dlFixedK2 ?? 0.5,
			fixPeriod: periodic && !!args.useFixedPeriod,
			fixedPeriod: args.fixedPeriod ?? 24
		};
		const r = fitDoubleLogistic(tt, yy, opts);
		if (!r) return stats;
		stats.mesor = r.parameters.M;
		stats.amplitude = r.parameters.A;
		stats.onset = r.parameters.t1;
		stats.offset = r.parameters.t2;
		stats.k1 = r.parameters.k1;
		stats.k2 = r.parameters.k2;
		if (periodic) stats.period = r.parameters.T;
		stats.r2 = r.rSquared;
		stats.rmse = r.rmse;
		return stats;
	}

	if (args.analysis === 'trend') {
		const model = args.trendModel ?? 'linear';
		const polyDegree = Math.max(0, Math.floor(args.trendPolyDegree ?? 2));

		// fitTrend's logarithmic branch takes log(x) and exponential branch
		// takes log(y); guard the windows where those would be NaN/-Infinity
		// so a single bad sample doesn't corrupt the whole fit.
		if (model === 'logarithmic' && tt.some((v) => !(v > 0))) return stats;
		if (model === 'exponential' && yy.some((v) => !(v > 0))) return stats;
		if (model === 'polynomial' && tt.length <= polyDegree) return stats;

		let r;
		try {
			r = fitTrend(tt, yy, model, polyDegree);
		} catch {
			return stats;
		}
		if (!r || !r.parameters) return stats;

		if (model === 'linear') {
			stats.slope = r.parameters.slope;
			stats.intercept = r.parameters.intercept;
		} else if (model === 'exponential' || model === 'logarithmic') {
			stats.a = r.parameters.a;
			stats.b = r.parameters.b;
		} else if (model === 'polynomial') {
			const coeffs = r.parameters.coeffs ?? [];
			for (let i = 0; i < coeffs.length; i++) stats[`c${i}`] = coeffs[i];
		}
		stats.r2 = r.rSquared;
		stats.rmse = r.rmse;
		return stats;
	}
	return stats;
}

// Run the windowed analysis for every y-series. `ys` is an array of yData arrays
// (parallel to the table process's yIN order); returns an array of per-stat
// objects (each { statKey: number[] over windows }), parallel to `ys`. Mirrors
// the original in-component loop exactly so behaviour is unchanged.
export function computeMovingWindows({ tAll, ys, starts, windowSize, statKeys, args }) {
	const isInvalid = (v) => v == null || isNaN(v);
	const out = [];
	for (const yData of ys) {
		const perStat = {};
		for (const k of statKeys) perStat[k] = new Array(starts.length).fill(NaN);
		for (let w = 0; w < starts.length; w++) {
			const wStart = starts[w];
			const wEnd = wStart + windowSize;
			const tt = [];
			const yy = [];
			for (let i = 0; i < tAll.length; i++) {
				const ti = tAll[i];
				const yi = yData[i];
				if (isInvalid(ti) || isInvalid(yi)) continue;
				if (ti >= wStart && ti < wEnd) { tt.push(ti); yy.push(yi); }
			}
			if (tt.length < 3) continue;
			const s = computeStatsForWindow(tt, yy, args);
			for (const k of statKeys) {
				if (Number.isFinite(s[k])) perStat[k][w] = s[k];
			}
		}
		out.push(perStat);
	}
	return out;
}
