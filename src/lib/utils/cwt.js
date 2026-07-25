// @ts-nocheck
/**
 * Continuous wavelet transform (CWT) — Torrence & Compo (1998), "A Practical
 * Guide to Wavelet Analysis", Bull. Amer. Meteor. Soc. 79(1):61-78.
 *
 * Everything is done in the Fourier domain, exactly as in the paper (their
 * eq. 4): FFT the (zero-padded, mean-removed) signal ONCE, multiply by the
 * conjugate of the wavelet's Fourier transform at each scale, then inverse-FFT
 * per scale. That is one forward plus `nScales` inverse transforms, rather than
 * an O(n·support) direct convolution per scale.
 *
 * Conventions, all from the paper, spelled out because they are the usual
 * source of "my numbers don't match" confusion:
 *
 * - The mother wavelet is normalised at each scale to unit energy (their
 *   eq. 6), so power is comparable ACROSS scales. Without this, large scales
 *   always dominate and the scalogram is unreadable.
 * - Scales are log2-spaced (their eq. 9-10): s_j = s0 · 2^(j·dj).
 * - Scale is converted to the equivalent FOURIER PERIOD (their Table 1) so the
 *   axis reads in hours, which is what a chronobiologist wants. For Morlet with
 *   ω0 = 6 the factor is ≈ 1.03, i.e. scale ≈ period, which is exactly why
 *   Morlet-6 is the conventional choice.
 * - The cone of influence is the e-folding time (their Table 1 / §3.g). Values
 *   inside the COI are edge-contaminated by the zero padding and must not be
 *   interpreted; the plot draws it.
 *
 * The transform requires UNIFORMLY sampled data. Uneven timestamps are a
 * caller-side concern — `cwtFromSeries` detects them and reports, rather than
 * silently returning confident nonsense (the same trap Lomb-Scargle exists to
 * avoid on the periodogram side).
 */
import { fftInPlace, ifftInPlace, nextPowerOfTwo } from './fft.js';
import { validPairs } from './validPairs.js';
import { mean } from '$lib/components/plotbits/helpers/wrangleData.js';

/** Supported mother wavelets. */
export const WAVELETS = ['morlet', 'paul', 'dog'];

/** Largest padded transform length we will allocate (see fft.js MAX_FFT_N rationale). */
const MAX_N = 1 << 22;

const EMPTY = Object.freeze({
	periods: [],
	scales: [],
	power: [],
	coi: [],
	times: [],
	dt: 0,
	nScales: 0,
	valid: false,
	reason: 'no data'
});

/**
 * Γ(x) via the Lanczos approximation — needed for the Paul/DOG normalisations
 * and their scale→period factors. Kept local and small; the app's D13 policy
 * reserves @stdlib for distribution CDFs/quantiles, not for a single gamma.
 */
function gamma(x) {
	const g = 7;
	const C = [
		0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
		-176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
		1.5056327351493116e-7
	];
	if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
	x -= 1;
	let a = C[0];
	const t = x + g + 0.5;
	for (let i = 1; i < g + 2; i++) a += C[i] / (x + i);
	return Math.sqrt(2 * Math.PI) * t ** (x + 0.5) * Math.exp(-t) * a;
}

/**
 * Wavelet-specific constants (Torrence & Compo Table 1).
 *
 * `fourierFactor` converts scale → equivalent Fourier period.
 * `coiFactor` is the e-folding time as a multiple of scale.
 * `psiHat(w, s, dt)` is the wavelet's Fourier transform at angular frequency
 * `w`, already energy-normalised for scale `s`.
 */
function waveletProps(name, param) {
	if (name === 'paul') {
		const m = param ?? 4;
		return {
			fourierFactor: (4 * Math.PI) / (2 * m + 1),
			coiFactor: 1 / Math.SQRT2,
			psiHat(w, s, dt) {
				if (w <= 0) return 0;
				const norm =
					Math.sqrt((2 * Math.PI * s) / dt) *
					(2 ** m / Math.sqrt(m * gamma(2 * m))) *
					Math.sqrt(2 * m); // T&C Table 1 normalisation
				return norm * (s * w) ** m * Math.exp(-s * w);
			}
		};
	}
	if (name === 'dog') {
		const m = param ?? 2; // m = 2 is the Marr / "Mexican hat" wavelet
		return {
			fourierFactor: (2 * Math.PI) / Math.sqrt(m + 0.5),
			coiFactor: Math.SQRT2,
			psiHat(w, s, dt) {
				const norm = Math.sqrt((2 * Math.PI * s) / dt) * Math.sqrt(1 / gamma(m + 0.5));
				// -(i^m) only rotates phase; |psiHat| is what power uses.
				return norm * (s * Math.abs(w)) ** m * Math.exp(-((s * w) ** 2) / 2);
			}
		};
	}
	// Morlet (default). w0 = 6 makes the wavelet admissible without correction
	// and gives fourierFactor ≈ 1.03, so scale ≈ Fourier period.
	const w0 = param ?? 6;
	return {
		fourierFactor: (4 * Math.PI) / (w0 + Math.sqrt(2 + w0 * w0)),
		coiFactor: Math.SQRT2,
		psiHat(w, s, dt) {
			if (w <= 0) return 0; // Morlet is analytic: zero for negative frequencies
			const norm = Math.sqrt((2 * Math.PI * s) / dt) * Math.PI ** -0.25;
			return norm * Math.exp(-((s * w - w0) ** 2) / 2);
		}
	};
}

/**
 * Build the log2-spaced scale array (Torrence & Compo eq. 9-10).
 * @returns {number[]}
 */
export function buildScales(dt, n, { dj = 0.125, s0 = null, j1 = null } = {}) {
	const smallest = s0 && s0 > 0 ? s0 : 2 * dt;
	const maxJ =
		j1 != null && j1 > 0 ? j1 : Math.max(1, Math.floor(Math.log2((n * dt) / smallest) / dj));
	const scales = [];
	for (let j = 0; j <= maxJ; j++) scales.push(smallest * 2 ** (j * dj));
	return scales;
}

/**
 * Continuous wavelet transform of a uniformly sampled series.
 *
 * @param {number[]} values  signal samples (uniform dt)
 * @param {number} dt        sample interval, in the same units as the periods you want out
 * @param {object} [opts]
 * @param {string} [opts.wavelet='morlet']  'morlet' | 'paul' | 'dog'
 * @param {number} [opts.param]             ω0 for Morlet (default 6), m for Paul (4) / DOG (2)
 * @param {number} [opts.dj=0.125]          scale resolution (smaller = more scales)
 * @param {number} [opts.s0]                smallest scale (default 2·dt)
 * @param {number} [opts.j1]                number of scale steps (default: span-limited)
 * @param {number[]} [opts.periodRange]     [minPeriod, maxPeriod] filter applied after scaling
 * @param {boolean} [opts.rectify=true]     divide power by scale to remove the scale bias.
 *   Makes power comparable ACROSS scales (right for a scalogram), at the cost of
 *   shifting the per-scale argmax ~1-2% LOW. Pass `false` when the number you want
 *   is the period itself (tau estimation, ridge extraction).
 * @returns {{periods:number[], scales:number[], power:number[][], coi:number[],
 *            dt:number, nScales:number, valid:boolean, reason:string}}
 *          `power[j][i]` is |W|² at scale j, time index i.
 */
export function cwt(values, dt, opts = {}) {
	const {
		wavelet = 'morlet',
		param,
		dj = 0.125,
		s0 = null,
		j1 = null,
		periodRange = null,
		rectify = true
	} = opts;

	if (!Array.isArray(values) || values.length < 4) {
		return { ...EMPTY, reason: 'need at least 4 samples' };
	}
	if (!Number.isFinite(dt) || dt <= 0) {
		return { ...EMPTY, reason: 'sample interval must be positive and finite' };
	}
	if (!WAVELETS.includes(wavelet)) {
		return { ...EMPTY, reason: `unknown wavelet "${wavelet}"` };
	}

	const n = values.length;
	// Remove the mean: a DC offset otherwise leaks power into every large scale.
	const clean = values.map((v) => (Number.isFinite(v) ? Number(v) : NaN));
	const finite = clean.filter(Number.isFinite);
	if (finite.length < 4) return { ...EMPTY, reason: 'need at least 4 finite samples' };
	const mu = mean(finite);
	// Gaps are zero-filled AFTER mean removal, which is the least-bad option: it
	// biases power DOWN locally (a conservative direction) instead of injecting a
	// step. Callers should interpolate upstream if gaps are common.
	const padded0 = clean.map((v) => (Number.isFinite(v) ? v - mu : 0));

	const nPad = nextPowerOfTwo(n);
	if (!Number.isFinite(nPad) || nPad > MAX_N) {
		return { ...EMPTY, reason: 'series too long for the transform' };
	}

	const re = new Float64Array(nPad);
	const im = new Float64Array(nPad);
	for (let i = 0; i < n; i++) re[i] = padded0[i];
	fftInPlace(re, im);

	// Angular frequencies for the padded transform (T&C eq. 5).
	const omega = new Float64Array(nPad);
	for (let k = 0; k < nPad; k++) {
		const kk = k <= nPad / 2 ? k : k - nPad;
		omega[k] = (2 * Math.PI * kk) / (nPad * dt);
	}

	const props = waveletProps(wavelet, param);
	const allScales = buildScales(dt, n, { dj, s0, j1 });

	const scales = [];
	const periods = [];
	for (const s of allScales) {
		const period = s * props.fourierFactor;
		if (periodRange) {
			const [lo, hi] = periodRange;
			if (Number.isFinite(lo) && period < lo) continue;
			if (Number.isFinite(hi) && period > hi) continue;
		}
		scales.push(s);
		periods.push(period);
	}
	if (scales.length === 0) {
		return { ...EMPTY, reason: 'no scales fall inside the requested period range' };
	}

	const power = [];
	const wRe = new Float64Array(nPad);
	const wIm = new Float64Array(nPad);
	for (const s of scales) {
		for (let k = 0; k < nPad; k++) {
			const psi = props.psiHat(omega[k], s, dt);
			wRe[k] = re[k] * psi;
			wIm[k] = im[k] * psi;
		}
		ifftInPlace(wRe, wIm);
		const row = new Array(n);
		// Bias rectification (Liu, Liang & Weisberg 2007, J. Atmos. Oceanic Technol.
		// 24:2093-2102): raw |W|² grows in proportion to scale, so an unrectified
		// scalogram makes every long period look brighter than an equally strong
		// short one — two unit-amplitude sinusoids at 12 h and 24 h differ by ~2x.
		// Dividing by scale makes power comparable ACROSS scales, which is what a
		// reader of a scalogram assumes the colour means.
		const denom = rectify ? s : 1;
		for (let i = 0; i < n; i++) row[i] = (wRe[i] * wRe[i] + wIm[i] * wIm[i]) / denom;
		power.push(row);
	}

	// Cone of influence: e-folding time, tapering to zero at both ends (T&C §3.g).
	const coi = new Array(n);
	const coiConst = props.fourierFactor * props.coiFactor;
	for (let i = 0; i < n; i++) {
		const edge = Math.min(i, n - 1 - i);
		// +1e-9 keeps the endpoints off exactly zero so a log axis stays plottable.
		coi[i] = coiConst * dt * (edge + 1e-9);
	}

	return {
		periods,
		scales,
		power,
		coi,
		dt,
		nScales: scales.length,
		valid: true,
		reason: ''
	};
}

/**
 * Global wavelet spectrum: time-average of power at each scale (T&C §5.c).
 * This is the wavelet analogue of a Fourier power spectrum and is often the
 * most directly comparable output to the app's periodogram.
 *
 * @param {number[][]} power  power[j][i]
 * @returns {number[]} one mean power per scale
 */
export function globalWaveletSpectrum(power) {
	if (!Array.isArray(power) || power.length === 0) return [];
	return power.map((row) => {
		if (!row || row.length === 0) return NaN;
		let sum = 0;
		let count = 0;
		for (const v of row) {
			if (Number.isFinite(v)) {
				sum += v;
				count++;
			}
		}
		return count > 0 ? sum / count : NaN;
	});
}

/**
 * Ridge: the period of maximum power at each time point, ignoring cells inside
 * the cone of influence. This is the piece that flows downstream as a column —
 * "what period is the animal running at, right now".
 *
 * @returns {{ridgePeriod:number[], ridgePower:number[]}}
 */
export function waveletRidge({ periods, power, coi }) {
	if (!Array.isArray(power) || power.length === 0) return { ridgePeriod: [], ridgePower: [] };
	const n = power[0]?.length ?? 0;
	const ridgePeriod = new Array(n).fill(NaN);
	const ridgePower = new Array(n).fill(NaN);
	for (let i = 0; i < n; i++) {
		let best = -Infinity;
		let bestJ = -1;
		for (let j = 0; j < power.length; j++) {
			// Inside the COI the value is an edge artefact, not a measurement.
			if (coi && periods[j] > coi[i]) continue;
			const v = power[j][i];
			if (Number.isFinite(v) && v > best) {
				best = v;
				bestJ = j;
			}
		}
		if (bestJ >= 0) {
			ridgePeriod[i] = periods[bestJ];
			ridgePower[i] = best;
		}
	}
	return { ridgePeriod, ridgePower };
}

/**
 * Convenience wrapper taking (times, values) as the app stores them.
 *
 * Detects non-uniform sampling rather than computing on it: the CWT has no
 * uneven-sampling variant here, so a series with irregular timestamps must be
 * binned or interpolated upstream. `tolerance` is the permitted relative
 * spread of the sample intervals.
 */
export function cwtFromSeries(times, values, opts = {}) {
	const { tolerance = 0.01, ...rest } = opts;
	if (!times || !values || times.length !== values.length || times.length < 4) {
		return { ...EMPTY, reason: 'need at least 4 aligned samples' };
	}
	const { indices } = validPairs(times, values);
	if (indices.length < 4) return { ...EMPTY, reason: 'need at least 4 finite samples' };

	const t = indices.map((i) => Number(times[i]));
	const y = indices.map((i) => Number(values[i]));

	const diffs = [];
	for (let i = 1; i < t.length; i++) diffs.push(t[i] - t[i - 1]);
	const dt = mean(diffs);
	if (!Number.isFinite(dt) || dt <= 0) {
		return { ...EMPTY, reason: 'time axis is not increasing' };
	}
	const maxDev = Math.max(...diffs.map((d) => Math.abs(d - dt))) / dt;
	if (maxDev > tolerance) {
		return {
			...EMPTY,
			dt,
			reason: `sampling is not uniform (intervals vary by ${(maxDev * 100).toFixed(1)}%). Bin or interpolate first.`
		};
	}

	const out = cwt(y, dt, rest);
	return { ...out, times: t };
}
