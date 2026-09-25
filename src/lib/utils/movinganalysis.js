// @ts-nocheck
// movinganalysis.js — pure compute for the MovingAnalysis table process, extracted
// from MovingAnalysis.svelte so the (heavy) windowed loop can run in the compute
// worker. Contains getStatKeys + computeStatsForWindow (verbatim) plus
// computeMovingWindows, which runs the per-y, per-window loop. No DOM/Svelte deps.
import { runPeriodogramCalculation } from './periodogram.js';
import { fitCosineCurves, fitCosinorFixed } from './cosinor.js';
import { computeFFT } from './fft.js';
import { computeAutocorrelation, findAutocorrelationPeak } from './correlogram.js';
import { fitRectangularWave } from './rectwave.js';
import { fitDoubleLogistic } from './doublelogistic.js';
// fitTrendSync, NOT fitTrend: fitTrend is `async` (it awaits an optional
// permutation test) so it always returns a Promise. This loop is synchronous,
// and reading `.parameters` off a Promise gave undefined — every 'trend'
// window silently returned empty stats.
import { fitTrendSync } from './trendfit.js';
import { computeNPCRA } from './npcra.js';
import { wrapToPeriod } from './cosinorAddons.js';
// Descriptive per-window stats (analysis === 'summary'). mean/sampleStd are the
// SAMPLE-denominator family DescribeData uses; quantileType7 is the shared
// house quantile (R/numpy default) so percentile(50) === median everywhere.
import { mean as sampleMean, sampleStd, quantileType7 } from './sampleStats.js';
// House missing-value rule (v72.28): blank strings are missing data, not zeros.
import { isInvalidValue } from './stats.js';

export function getStatKeys(args) {
	if (args.analysis === 'periodogram') {
		return ['peak_period', 'peak_power'];
	}
	// Windowed descriptive statistics: rolling mean, SD and percentile. Fixed
	// key names on purpose — a key derived from the percentile value (p30, p50…)
	// would rename the output column on every parameter tweak and orphan
	// downstream wiring (the reuse-on-replace rule matches by stat suffix).
	if (args.analysis === 'summary') {
		return ['mean', 'sd', 'percentile'];
	}
	// Nonparametric circadian rhythm analysis per window: interdaily stability,
	// intradaily variability, relative amplitude and the L5/M10 windows. Rolling
	// IS/IV is the standard way to watch rhythm fragmentation develop over time.
	if (args.analysis === 'npcra') {
		return ['IS', 'IV', 'RA', 'L5', 'M10', 'M10onset'];
	}
	if (args.analysis === 'cosinor') {
		if (args.useFixedPeriod) {
			// rel_amplitude = amplitude / MESOR. Reported separately because the raw
			// amplitude confounds "the rhythm got weaker" with "the whole signal got
			// smaller"; the ratio is what stays comparable across animals and windows.
			const keys = ['mesor'];
			const H = Math.max(1, args.nHarmonics ?? 1);
			for (let h = 1; h <= H; h++) {
				keys.push(`H${h}_amplitude`, `H${h}_acrophase`);
			}
			keys.push('rel_amplitude', 'r2', 'rmse', 'pvalue');
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

	if (args.analysis === 'summary') {
		// yy is already validity-filtered by computeMovingWindows (isInvalidValue),
		// so these run on clean numbers. SD is the SAMPLE deviation (n-1), matching
		// DescribeData; percentile is the shared type-7 quantile, so 50 === median.
		const pct = Number(args.summaryPercentile ?? 50);
		stats.mean = sampleMean(yy);
		stats.sd = sampleStd(yy);
		stats.percentile = quantileType7(yy, (Number.isFinite(pct) ? pct : 50) / 100);
		return stats;
	}

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

	if (args.analysis === 'npcra') {
		// computeNPCRA resamples onto its own epoch grid internally, so it only
		// needs the window's raw (t, y). A 7-day window at 5-minute resolution is
		// ~2000 samples, which it bins down before doing any work.
		const r = computeNPCRA(tt, yy, {
			epochHours: args.npcraEpochHours ?? 1,
			period: args.npcraPeriod ?? 24,
			mWindow: args.npcraMWindow ?? 10,
			lWindow: args.npcraLWindow ?? 5
		});
		if (!r) return stats;
		stats.IS = r.IS;
		stats.IV = r.IV;
		stats.RA = r.RA;
		stats.L5 = r.L5;
		stats.M10 = r.M10;
		stats.M10onset = r.M10onset;
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
			const periodUsed = args.fixedPeriod ?? 24;
			for (let h = 0; h < r.harmonics.length; h++) {
				const k = h + 1;
				stats[`H${k}_amplitude`] = r.harmonics[h].amplitude;
				// fitCosinorFixed returns the CLASSICAL acrophase; the peak time is
				// wrap(-acrophase_hrs). The standalone Cosinor node already converts
				// (Cosinor.svelte, "convert here to the same peak-time convention"),
				// and this path did NOT — so a rhythm peaking at 08:00 was reported
				// as 16:00, disagreeing with the Cosinor node on the same data.
				// Caught by the util-movingwindows-cosinor-relamp parity fixture.
				stats[`H${k}_acrophase`] = wrapToPeriod(-r.harmonics[h].acrophase_hrs, periodUsed / k);
			}
			// Guard the ratio: a MESOR at or near zero (a mean-centred or
			// zero-baseline signal) makes amplitude/MESOR meaningless or infinite.
			const mesor = r.M;
			const amp1 = r.harmonics[0]?.amplitude;
			stats.rel_amplitude =
				Number.isFinite(mesor) && Math.abs(mesor) > 1e-12 && Number.isFinite(amp1)
					? amp1 / mesor
					: NaN;
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
		// Dominant period, not lag 0 and not the largest |r|. See findAutocorrelationPeak.
		const peak = findAutocorrelationPeak(r.lags, r.correlations);
		if (!peak) return stats;
		stats.peak_lag = peak.lag;
		stats.peak_correlation = peak.correlation;
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

		// fitTrendSync's logarithmic branch takes log(x) and exponential branch
		// takes log(y); guard the windows where those would be NaN/-Infinity
		// so a single bad sample doesn't corrupt the whole fit.
		if (model === 'logarithmic' && tt.some((v) => !(v > 0))) return stats;
		if (model === 'exponential' && yy.some((v) => !(v > 0))) return stats;
		if (model === 'polynomial' && tt.length <= polyDegree) return stats;

		let r;
		try {
			r = fitTrendSync(tt, yy, model, polyDegree);
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
//
// SKIP ACCOUNTING (`__skips`): a skipped window leaves NaN in every stat array,
// which renders as a blank cell — indistinguishable, to the user, from "the fit
// failed" or "the app is broken". So each per-y result also carries a `__skips`
// tally under a reserved key ({ total, fewPoints, logDomain, expDomain,
// polyDegree }) that the MovingAnalysis node turns into a warning sentence.
// Every consumer of this result iterates `statKeys` explicitly (output-column
// writes, pre-processes, previews, the parity adapter), so the extra key is
// invisible to them and the NUMERIC outputs are bit-identical to before —
// the same windows are skipped, for the same reasons, in the same places
// (the guards below mirror computeStatsForWindow's own trend guards, which
// stay in place as the last line of defence for direct callers).
export function computeMovingWindows({ tAll, ys, starts, windowSize, statKeys, args }) {
	// House rule (isInvalidValue, fixed in v72.28): a blank/whitespace string is
	// MISSING data, not zero. The old local `v == null || isNaN(v)` let '' through
	// (isNaN('') is false → Number('') fabricated a 0 into every window's fit).
	const isInvalid = isInvalidValue;
	const trendModel = args.analysis === 'trend' ? (args.trendModel ?? 'linear') : null;
	const trendPolyDegree = Math.max(0, Math.floor(args.trendPolyDegree ?? 2));
	const out = [];
	for (const yData of ys) {
		const perStat = {};
		for (const k of statKeys) perStat[k] = new Array(starts.length).fill(NaN);
		const skips = {
			total: starts.length,
			fewPoints: 0,
			logDomain: 0,
			expDomain: 0,
			polyDegree: 0
		};
		for (let w = 0; w < starts.length; w++) {
			const wStart = starts[w];
			const wEnd = wStart + windowSize;
			const tt = [];
			const yy = [];
			for (let i = 0; i < tAll.length; i++) {
				const ti = tAll[i];
				const yi = yData[i];
				if (isInvalid(ti) || isInvalid(yi)) continue;
				// Coerce once here: valid values may still be numeric STRINGS ('1.5'
				// from a paste), and the window maths must see numbers, not strings.
				const tn = Number(ti);
				if (tn >= wStart && tn < wEnd) {
					tt.push(tn);
					yy.push(Number(yi));
				}
			}
			if (tt.length < 3) {
				skips.fewPoints++;
				continue;
			}
			// Classify the trend-domain skips BEFORE the compute call so they can
			// be reported; the identical guards inside computeStatsForWindow then
			// never fire on this path, so the numeric outputs are unchanged.
			if (trendModel === 'logarithmic' && tt.some((v) => !(v > 0))) {
				skips.logDomain++;
				continue;
			}
			if (trendModel === 'exponential' && yy.some((v) => !(v > 0))) {
				skips.expDomain++;
				continue;
			}
			if (trendModel === 'polynomial' && tt.length <= trendPolyDegree) {
				skips.polyDegree++;
				continue;
			}
			const s = computeStatsForWindow(tt, yy, args);
			for (const k of statKeys) {
				if (Number.isFinite(s[k])) perStat[k][w] = s[k];
			}
		}
		perStat.__skips = skips;
		out.push(perStat);
	}
	return out;
}

/**
 * Turn one per-y `__skips` tally into user-facing warning sentences. Follows
 * the fitDomain message rule: each states the requirement, what the data
 * actually contains, and a remedy. Returns [] when nothing was skipped.
 *
 * @param {?{total:number, fewPoints:number, logDomain:number, expDomain:number, polyDegree:number}} skips
 * @param {string} seriesLabel the y column's name, for multi-series nodes
 * @param {{polyDegree?:number}} [opts]
 */
export function windowSkipMessages(skips, seriesLabel = '', opts = {}) {
	if (!skips) return [];
	const total = skips.total ?? 0;
	const forSeries = seriesLabel ? ` for ${seriesLabel}` : '';
	const ofTotal = (n) => `${n} of ${total} window${total === 1 ? '' : 's'}${forSeries}`;
	const wasWere = (n) => (n === 1 ? 'was' : 'were');
	const out = [];
	if (skips.logDomain > 0) {
		out.push(
			`${ofTotal(skips.logDomain)} ${wasWere(skips.logDomain)} skipped: the logarithmic model fits ` +
				`y = a + b·ln(x), so every x value in a window must be greater than 0, and these windows ` +
				`contain an x that is 0 or negative. Skipped windows are blank in the output columns. ` +
				`Shift x so every value is positive, or choose the linear or polynomial model, which have no such restriction.`
		);
	}
	if (skips.expDomain > 0) {
		out.push(
			`${ofTotal(skips.expDomain)} ${wasWere(skips.expDomain)} skipped: the exponential model fits ` +
				`y = a·e^(bx) by log-transforming y, so every y value in a window must be greater than 0, ` +
				`and these windows contain a y that is 0 or negative. Skipped windows are blank in the output columns. ` +
				`Add a constant offset to y so every value is positive, filter out the non-positive rows, or choose the linear or polynomial model.`
		);
	}
	if (skips.polyDegree > 0) {
		const deg = Math.max(0, Math.floor(opts.polyDegree ?? 2));
		out.push(
			`${ofTotal(skips.polyDegree)} ${wasWere(skips.polyDegree)} skipped: a degree-${deg} polynomial ` +
				`needs more than ${deg} points per window to be determined, and these windows have too few. ` +
				`Skipped windows are blank in the output columns. Lower the degree, widen the window, or supply denser data.`
		);
	}
	if (skips.fewPoints > 0) {
		out.push(
			`${ofTotal(skips.fewPoints)} ${wasWere(skips.fewPoints)} skipped: a window needs at least 3 usable ` +
				`points, and these windows have fewer (missing or blank cells do not count). Skipped windows are ` +
				`blank in the output columns. Widen the window, or check the data for gaps in that range.`
		);
	}
	return out;
}
