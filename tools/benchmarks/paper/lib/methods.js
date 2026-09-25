// Thin wrappers around AnCiR's ACTUAL analysis engine (src/lib/utils/*), reproducing
// how the app turns a spectrum into a reported number:
//  - periodogram peak: first arg-max of power over the trial-period grid, exactly as
//    tableProcesses/RhythmicityAnalysis.svelte (runAnalysis) does (strict `>`, so the
//    FIRST of tied maxima wins);
//  - FFT peak: arg-max of magnitude over the WHOLE one-sided spectrum (no band limit),
//    also as RhythmicityAnalysis does;
//  - free-period cosinor: fitCosineCurves(t, y, 1) as utils/cosinor.worker-task.js calls
//    it for the Cosinor node, period = 2*pi/frequency;
//  - fixed-period cosinor: fitCosinorFixed(t, y, period, 1, 0.05); pF is the F-test p.
// No AnCiR source is modified; these only call exported functions.
import { runPeriodogramCalculation } from '$lib/utils/periodogram.js';
import { fitCosineCurves, fitCosinorFixed } from '$lib/utils/cosinor.js';
import { computeFFT } from '$lib/utils/fft.js';
import { surrogateTest } from '$lib/utils/surrogates.js';

function firstArgmax(arr) {
	let best = -Infinity;
	let idx = -1;
	for (let i = 0; i < arr.length; i++) {
		if (Number.isFinite(arr[i]) && arr[i] > best) {
			best = arr[i];
			idx = i;
		}
	}
	return idx;
}

/**
 * Periodogram peak period (+ significance for Chi-squared).
 * @returns {{period:number, power:number, sigPeak:number|null, sigAny:number|null, pPeak:number|null}}
 */
export function periodogramPeak(
	method,
	t,
	y,
	{ periodMin, periodMax, step, binSize, alpha = 0.05 }
) {
	const res = runPeriodogramCalculation({
		method,
		xData: t,
		yData: y,
		periodMin,
		periodMax,
		periodSteps: step,
		binSize,
		chiSquaredAlpha: alpha
	});
	const i = firstArgmax(res.y);
	if (i < 0)
		return { period: NaN, power: NaN, sigPeak: null, sigAny: null, pPeak: null, periodRel: null };
	let sigPeak = null;
	let sigAny = null;
	let pPeak = null;
	let periodRel = null;
	if (method === 'Chi-squared') {
		// Sensitivity variant (NOT what RhythmicityAnalysis reports): the period maximising
		// Qp / threshold, i.e. the peak relative to its own significance line. Raw Qp grows
		// with df (~ period/binSize), so the raw arg-max leans to long periods. (Min p-value
		// was not used because p underflows to exactly 0 over many periods at high SNR.)
		let bestR = -Infinity;
		for (let k = 0; k < res.y.length; k++) {
			const ratio = res.y[k] / res.threshold[k];
			if (Number.isFinite(ratio) && ratio > bestR) {
				bestR = ratio;
				periodRel = res.x[k];
			}
		}
		sigPeak = res.y[i] > res.threshold[i] ? 1 : 0;
		sigAny = res.y.some((v, k) => Number.isFinite(res.threshold[k]) && v > res.threshold[k])
			? 1
			: 0;
		pPeak = res.pvalue[i];
	}
	return { period: res.x[i], power: res.y[i], sigPeak, sigAny, pPeak, periodRel };
}

/** Global FFT magnitude peak (RhythmicityAnalysis behaviour). freqStep null = auto. */
export function fftPeak(t, y, freqStep = null) {
	const r = computeFFT(t, y, freqStep);
	if (!r.frequencies.length) return { period: NaN };
	let b = 0;
	for (let i = 1; i < r.magnitudes.length; i++) if (r.magnitudes[i] > r.magnitudes[b]) b = i;
	return { period: 1 / r.frequencies[b], magnitude: r.magnitudes[b] };
}

/** Free-period single-component cosinor (Levenberg-Marquardt), searched over the
 * same period range as the periodograms (the node's Min/Max period params). */
export function cosinorFree(t, y, minPeriod = null, maxPeriod = null) {
	try {
		const r = fitCosineCurves(t, y, 1, { minPeriod, maxPeriod });
		const c = r?.parameters?.cosines?.[0];
		if (!c || !(c.frequency > 0)) return { period: NaN };
		return {
			period: (2 * Math.PI) / c.frequency,
			amplitude: Math.abs(c.amplitude),
			r2: r.rSquared
		};
	} catch {
		return { period: NaN };
	}
}

/** Fixed-period classical cosinor; returns the zero-amplitude F-test p. */
export function cosinorFixedP(t, y, period) {
	const r = fitCosinorFixed(t, y, period, 1, 0.05);
	return r ? r.pF : NaN;
}

/**
 * AnCiR Surrogate Test node statistic: peak FFT magnitude inside [pmin, pmax] vs a
 * moving-block bootstrap null (block = 24 h), exactly as tableProcesses/SurrogateTest.svelte.
 */
export function surrogateBlockP(
	t,
	y,
	{ nSurrogates = 199, seed = 12345, blockHours = 24, pmin = 20, pmax = 28 } = {}
) {
	const dt = (t[t.length - 1] - t[0]) / (t.length - 1);
	const blockLength = Math.max(1, Math.round(blockHours / dt));
	const stat = (yy) => {
		const { frequencies, magnitudes } = computeFFT(t.slice(0, yy.length), yy);
		let best = 0;
		for (let i = 0; i < frequencies.length; i++) {
			const p = 1 / frequencies[i];
			if (p >= pmin && p <= pmax && magnitudes[i] > best) best = magnitudes[i];
		}
		return best;
	};
	const r = surrogateTest(y, stat, { method: 'block', nSurrogates, seed, blockLength });
	return r.pValue;
}
