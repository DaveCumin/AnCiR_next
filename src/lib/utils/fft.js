// @ts-nocheck
import { mean } from '$lib/components/plotbits/helpers/wrangleData.js';
import { validPairs } from './validPairs.js';

/**
 * In-place iterative radix-2 Cooley-Tukey FFT over Float64Array pairs.
 *
 * Exported (unlike the object-based `fft` below) because the CWT and the
 * phase-randomised surrogates both need a REUSABLE forward+inverse pair, and
 * both run it once per scale / per surrogate. The `{re, im}` object form
 * allocates one object per sample per transform, which is fine for a one-shot
 * spectrum and much too slow when the transform is in a loop.
 *
 * `re` and `im` are modified in place and must both have the same power-of-two
 * length. `inverse` applies the conjugate twiddles and the 1/n scaling, so
 * `ifftInPlace(fftInPlace(x))` returns x (to floating-point tolerance).
 *
 * @param {Float64Array} re real parts, modified in place
 * @param {Float64Array} im imaginary parts, modified in place
 * @param {boolean} [inverse=false] run the inverse transform
 */
export function fftInPlace(re, im, inverse = false) {
	const n = re.length;
	if (n !== im.length) throw new Error('fftInPlace: re and im must be the same length');
	if (n < 2) return;
	if ((n & (n - 1)) !== 0) throw new Error('fftInPlace: length must be a power of two');

	// Bit-reversal permutation.
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			let t = re[i];
			re[i] = re[j];
			re[j] = t;
			t = im[i];
			im[i] = im[j];
			im[j] = t;
		}
	}

	// Danielson-Lanczos butterflies.
	const sign = inverse ? 1 : -1;
	for (let len = 2; len <= n; len <<= 1) {
		const ang = (sign * 2 * Math.PI) / len;
		const wRe = Math.cos(ang);
		const wIm = Math.sin(ang);
		for (let i = 0; i < n; i += len) {
			let curRe = 1;
			let curIm = 0;
			const half = len >> 1;
			for (let k = 0; k < half; k++) {
				const aRe = re[i + k];
				const aIm = im[i + k];
				const bRe = re[i + k + half] * curRe - im[i + k + half] * curIm;
				const bIm = re[i + k + half] * curIm + im[i + k + half] * curRe;
				re[i + k] = aRe + bRe;
				im[i + k] = aIm + bIm;
				re[i + k + half] = aRe - bRe;
				im[i + k + half] = aIm - bIm;
				const nextRe = curRe * wRe - curIm * wIm;
				curIm = curRe * wIm + curIm * wRe;
				curRe = nextRe;
			}
		}
	}

	if (inverse) {
		for (let i = 0; i < n; i++) {
			re[i] /= n;
			im[i] /= n;
		}
	}
}

/** Inverse of {@link fftInPlace}. Modifies `re`/`im` in place. */
export function ifftInPlace(re, im) {
	fftInPlace(re, im, true);
}

/** Smallest power of two >= n (n <= 0 gives 1). */
export function nextPowerOfTwo(n) {
	if (!Number.isFinite(n) || n <= 1) return 1;
	return 2 ** Math.ceil(Math.log2(n));
}

/**
 * In-place DFT of ANY length: radix-2 when the length is a power of two, otherwise
 * Bluestein's chirp-z algorithm (the length-n DFT written as a convolution, evaluated with
 * power-of-two transforms). Same conventions as {@link fftInPlace}: forward uses e^{-2 pi i kj/n},
 * and `inverse` applies the conjugate kernel and the 1/n scaling.
 *
 * Exists so a spectrum or a surrogate is computed at the series' OWN length. Zero-padding
 * to a power of two changes the transform (SPEC-3: it moved the 24 h bin of a ten-day hourly
 * record to 23.27 h) and a phase-randomised surrogate truncated back from a padded length
 * does not keep the spectrum (SPEC-4).
 *
 * @param {Float64Array} re modified in place
 * @param {Float64Array} im modified in place
 * @param {boolean} [inverse=false]
 */
export function fftAnyLength(re, im, inverse = false) {
	const n = re.length;
	if (n !== im.length) throw new Error('fftAnyLength: re and im must be the same length');
	if (n < 2) return;
	if ((n & (n - 1)) === 0) {
		fftInPlace(re, im, inverse);
		return;
	}
	const m = nextPowerOfTwo(2 * n - 1);
	const sign = inverse ? 1 : -1;
	// Chirp w_k = exp(sign * i * pi * k^2 / n). k^2 is reduced mod 2n first, so the angle
	// stays small and exact for long series (k^2 itself loses precision past ~9.5e7).
	const wRe = new Float64Array(n);
	const wIm = new Float64Array(n);
	for (let k = 0; k < n; k++) {
		const k2 = (k * k) % (2 * n);
		const ang = (sign * Math.PI * k2) / n;
		wRe[k] = Math.cos(ang);
		wIm[k] = Math.sin(ang);
	}
	const aRe = new Float64Array(m);
	const aIm = new Float64Array(m);
	for (let k = 0; k < n; k++) {
		aRe[k] = re[k] * wRe[k] - im[k] * wIm[k];
		aIm[k] = re[k] * wIm[k] + im[k] * wRe[k];
	}
	const bRe = new Float64Array(m);
	const bIm = new Float64Array(m);
	bRe[0] = wRe[0];
	bIm[0] = -wIm[0];
	for (let k = 1; k < n; k++) {
		bRe[k] = bRe[m - k] = wRe[k];
		bIm[k] = bIm[m - k] = -wIm[k];
	}
	fftInPlace(aRe, aIm);
	fftInPlace(bRe, bIm);
	for (let k = 0; k < m; k++) {
		const r = aRe[k] * bRe[k] - aIm[k] * bIm[k];
		aIm[k] = aRe[k] * bIm[k] + aIm[k] * bRe[k];
		aRe[k] = r;
	}
	fftInPlace(aRe, aIm, true);
	for (let k = 0; k < n; k++) {
		let r = aRe[k] * wRe[k] - aIm[k] * wIm[k];
		let i = aRe[k] * wIm[k] + aIm[k] * wRe[k];
		if (inverse) {
			r /= n;
			i /= n;
		}
		re[k] = r;
		im[k] = i;
	}
}

// ---------------------------------------------------------------------------
// Regridding (SPEC-2)
// ---------------------------------------------------------------------------

/**
 * Gap rule shared by every FFT caller. A run of up to MAX_GAP_SAMPLES consecutive missing
 * samples is filled by linear interpolation between its neighbours, provided the filled
 * samples are at most MAX_MISSING_FRACTION of the grid. Anything more is refused with a
 * reason, because no fill rule is honest over a long gap: the transform needs one value per
 * grid slot, and both joining the two sides (the old behaviour: 24 h read as 31 h after a
 * three-day gap) and inventing values over it change the spectrum. The Lomb-Scargle
 * periodogram handles gaps and uneven sampling natively.
 */
export const FFT_GAP_RULE = Object.freeze({ maxGapSamples: 3, maxMissingFraction: 0.1 });

// A sample further than this fraction of the grid step from its grid slot is not on the grid.
const ALIGN_TOLERANCE = 0.25;

const fmtH = (h) => (Math.abs(h) >= 10 ? h.toFixed(0) : Number(h.toPrecision(3)).toString());

/**
 * Put a series onto its own uniform sampling grid.
 *
 * The step is the MEDIAN interval between consecutive valid samples (robust to a gap, unlike
 * span / (n - 1)). Each sample must sit within a quarter step of a grid slot; missing slots
 * are filled or refused under {@link FFT_GAP_RULE}.
 *
 * @param {Array<number|null>} times hours, increasing
 * @param {Array<number|null>} values
 * @param {{maxGapSamples?:number, maxMissingFraction?:number}} [opts]
 * @returns {{ok:boolean, reason:string, t0:number, dt:number, y:number[], nObserved:number,
 *            nFilled:number, longestGap:number}} `longestGap` in samples; `y` is the gridded
 *            series (filled slots included) when ok.
 */
export function regridUniform(times, values, opts = {}) {
	const maxGapSamples = opts.maxGapSamples ?? FFT_GAP_RULE.maxGapSamples;
	const maxMissingFraction = opts.maxMissingFraction ?? FFT_GAP_RULE.maxMissingFraction;
	const fail = (reason, extra = {}) => ({
		ok: false,
		reason,
		t0: NaN,
		dt: NaN,
		y: [],
		nObserved: 0,
		nFilled: 0,
		longestGap: 0,
		...extra
	});
	if (!times || !values) return fail('no data');
	const { indices } = validPairs(times, values);
	if (indices.length < 2) return fail('need at least 2 samples with both a time and a value');
	const t = indices.map((i) => Number(times[i]));
	const y = indices.map((i) => Number(values[i]));

	const diffs = new Array(t.length - 1);
	for (let i = 1; i < t.length; i++) {
		const d = t[i] - t[i - 1];
		if (!(d > 0) || !Number.isFinite(d)) return fail('the time axis is not increasing');
		diffs[i - 1] = d;
	}
	const sorted = [...diffs].sort((a, b) => a - b);
	const dt = sorted[Math.floor((sorted.length - 1) / 2)];
	if (!(dt > 0) || !Number.isFinite(dt)) return fail('the time axis is not increasing');

	const t0 = t[0];
	const slots = new Array(t.length);
	for (let i = 0; i < t.length; i++) {
		const pos = (t[i] - t0) / dt;
		const slot = Math.round(pos);
		if (Math.abs(pos - slot) > ALIGN_TOLERANCE || (i > 0 && slot === slots[i - 1])) {
			return fail(
				`the samples do not sit on a regular grid (typical interval ${fmtH(dt)} h). ` +
					'Bin the data to a fixed interval first, or use the Lomb-Scargle periodogram.',
				{ dt }
			);
		}
		slots[i] = slot;
	}
	const N = slots[slots.length - 1] + 1;
	if (!(N <= MAX_FFT_N)) return fail('the record is too long for the transform', { dt });

	let longestGap = 0;
	for (let i = 1; i < slots.length; i++)
		longestGap = Math.max(longestGap, slots[i] - slots[i - 1] - 1);
	const nMissing = N - t.length;
	if (longestGap > maxGapSamples) {
		return fail(
			`the record has a gap of ${fmtH(longestGap * dt)} h (${longestGap} missing samples at the ` +
				`${fmtH(dt)} h interval). The FFT needs evenly spaced samples and fills at most ` +
				`${maxGapSamples} in a row. Use the Lomb-Scargle periodogram, which handles gaps, or ` +
				'analyse the segments either side separately.',
			{ dt, longestGap, nObserved: t.length }
		);
	}
	if (nMissing > maxMissingFraction * N) {
		return fail(
			`${nMissing} of ${N} samples (${((100 * nMissing) / N).toFixed(0)}%) are missing at the ` +
				`${fmtH(dt)} h interval, more than the ${(100 * maxMissingFraction).toFixed(0)}% the FFT ` +
				'will interpolate. Use the Lomb-Scargle periodogram, which handles missing samples.',
			{ dt, longestGap, nObserved: t.length }
		);
	}

	const out = new Array(N);
	for (let i = 0; i < slots.length; i++) {
		out[slots[i]] = y[i];
		if (i > 0) {
			const gap = slots[i] - slots[i - 1];
			for (let g = 1; g < gap; g++) {
				out[slots[i - 1] + g] = y[i - 1] + ((y[i] - y[i - 1]) * g) / gap;
			}
		}
	}
	return {
		ok: true,
		reason: '',
		t0,
		dt,
		y: out,
		nObserved: t.length,
		nFilled: nMissing,
		longestGap
	};
}

// ---------------------------------------------------------------------------
// Magnitude spectrum
// ---------------------------------------------------------------------------

const EMPTY_SPECTRUM = {
	frequencies: [],
	magnitudes: [],
	phases: [],
	samplingRate: 0,
	nyquistFreq: 0,
	minPeriod: 0,
	resolution: 0,
	nSamples: 0,
	nTransform: 0,
	nFilled: 0,
	grid: null,
	flat: false,
	warnings: [],
	reason: ''
};

// Largest transform length we'll allocate. A transform over > ~16M samples is neither useful
// here nor allocatable; anything demanding more is a sign of a degenerate (non-time) input
// rather than a real request.
const MAX_FFT_N = 1 << 24;

/**
 * Magnitude spectrum of a sampled series.
 *
 * - The series is first put on its own uniform grid ({@link regridUniform}); short gaps are
 *   interpolated, long ones refused with `reason` (SPEC-2).
 * - The mean is removed (only the mean: a linear trend is NOT removed and leaks into the
 *   lowest frequencies; detrend first if the record drifts).
 * - The transform is taken at the record's own length N, so the bins are the k / (N dt) grid
 *   whose spacing, `resolution`, is the true frequency resolution of the record. An explicit
 *   `freqStep` finer than that zero-pads to evaluate the same spectrum on a finer grid; that
 *   interpolates between independent bins, it does not add resolution.
 * - Magnitude is 2|X_k| / N with N the number of samples (not the padded length), so a pure
 *   sinusoid of amplitude A reads A at its frequency whatever the record length or padding
 *   (SPEC-3). {@link fftPeak} refines a peak that falls between bins.
 *
 * @param {number[]} times hours
 * @param {number[]} values
 * @param {number|null} [freqStep] cycles/h; null/0 = the record's own grid
 */
export function computeFFT(times, values, freqStep = null) {
	if (
		!times ||
		!values ||
		times.length < 2 ||
		values.length < 2 ||
		times.length !== values.length
	) {
		return { ...EMPTY_SPECTRUM, warnings: [] };
	}

	const g = regridUniform(times, values);
	if (!g.ok) return { ...EMPTY_SPECTRUM, warnings: [], reason: g.reason };

	const N = g.y.length;
	if (N < 4) return { ...EMPTY_SPECTRUM, warnings: [], reason: 'need at least 4 samples' };
	const dt = g.dt;
	const samplingRate = 1 / dt;
	const nyquistFreq = samplingRate / 2;
	const minPeriod = 2 * dt;

	let M = N;
	if (freqStep && freqStep > 0) {
		const want = Math.ceil(samplingRate / freqStep);
		if (Number.isFinite(want) && want > N) M = want;
	}
	if (!Number.isFinite(M) || M > MAX_FFT_N) {
		return { ...EMPTY_SPECTRUM, warnings: [], reason: 'the requested frequency step is too fine' };
	}

	const yMean = mean(g.y);
	const yc = g.y.map((v) => v - yMean);
	// A series with no variation at all (every gridded value EXACTLY equal; interpolating a
	// constant is exact) has no spectrum. Its mean-removed values are one identical rounding
	// residue (0.1 - mean(0.1, ...) is ~1e-17, not 0), whose transform is pure rounding
	// noise, and the peak pick then reported whichever period that noise favoured (ROB-13).
	// So its magnitudes are exactly 0 and fftPeak reports no peak.
	let flat = true;
	for (let i = 1; i < g.y.length; i++) {
		if (g.y[i] !== g.y[0]) {
			flat = false;
			break;
		}
	}
	const re = new Float64Array(M);
	const im = new Float64Array(M);
	for (let i = 0; i < N; i++) re[i] = yc[i];
	fftAnyLength(re, im);

	const frequencies = [];
	const magnitudes = [];
	const phases = [];
	// Bins 1 .. below M/2: DC is the removed mean, and the Nyquist bin (even M) has no
	// conjugate partner, so 2|X|/N would double it.
	for (let k = 1; 2 * k < M; k++) {
		frequencies.push((k * samplingRate) / M);
		magnitudes.push(flat ? 0 : (2 * Math.hypot(re[k], im[k])) / N);
		phases.push(Math.atan2(im[k], re[k]));
	}

	const warnings = [];
	if (g.nFilled > 0) {
		warnings.push(
			`${g.nFilled} missing sample${g.nFilled > 1 ? 's were' : ' was'} filled by linear interpolation ` +
				`on the ${fmtH(dt)} h grid (longest run ${g.longestGap}).`
		);
	}

	return {
		frequencies,
		magnitudes,
		phases,
		samplingRate,
		nyquistFreq,
		minPeriod,
		resolution: samplingRate / N,
		nSamples: N,
		nTransform: M,
		nFilled: g.nFilled,
		// The gridded, mean-removed series, kept so fftPeak can refine between bins.
		grid: { t0: g.t0, dt, y: yc },
		flat,
		warnings,
		reason: ''
	};
}

/**
 * Amplitude, phase and explained sum of squares of the least-squares sinusoid at frequency f
 * fitted to the gridded,
 * mean-removed series. On a bin of the record's grid this equals 2|X_k| / N exactly (the
 * cosine and sine columns are orthogonal there); between bins it is the amplitude a
 * sinusoid at f actually has, which the raw DTFT magnitude 2|X(f)| / N is not: the
 * mirror-image term of a real signal pulls the DTFT maximum off the true frequency (a pure
 * 24 h cosine over 240 h peaked at 23.96 h by DTFT).
 */
function magnitudeAt(y, dt, f) {
	const w = 2 * Math.PI * f * dt;
	const n = y.length;
	const cos = new Float64Array(n);
	const sin = new Float64Array(n);
	let mc = 0;
	let ms = 0;
	for (let j = 0; j < n; j++) {
		cos[j] = Math.cos(w * j);
		sin[j] = Math.sin(w * j);
		mc += cos[j];
		ms += sin[j];
	}
	mc /= n;
	ms /= n;
	// Centred regressors = a fit with its own constant term. The series' mean was removed
	// over the whole record, which over a non-whole number of cycles is not the sinusoid's
	// own offset, so a fit without a constant would be pulled slightly off the frequency.
	let scc = 0;
	let sss = 0;
	let scs = 0;
	let syc = 0;
	let sys = 0;
	for (let j = 0; j < n; j++) {
		const c = cos[j] - mc;
		const s = sin[j] - ms;
		scc += c * c;
		sss += s * s;
		scs += c * s;
		syc += y[j] * c;
		sys += y[j] * s;
	}
	const det = scc * sss - scs * scs;
	if (!(Math.abs(det) > 1e-12 * scc * sss)) {
		const mag = (2 * Math.hypot(syc, sys)) / y.length;
		return { mag, phase: Math.atan2(-sys, syc), fit: (mag * mag * y.length) / 2 };
	}
	const a = (syc * sss - sys * scs) / det;
	const b = (sys * scc - syc * scs) / det;
	// `fit` is the variance the sinusoid explains (a Lomb-Scargle numerator): the quantity to
	// maximise. The amplitude itself is not: near a pure sinusoid's frequency a slightly
	// wrong frequency can fit a slightly LARGER amplitude while explaining less.
	return { mag: Math.hypot(a, b), phase: Math.atan2(-b, a), fit: a * syc + b * sys };
}

/**
 * The spectral peak of a {@link computeFFT} result, refined between bins.
 *
 * Picks the largest bin (optionally within [periodMin, periodMax] hours, or among
 * `indices`), then maximises the variance a least-squares sinusoid explains (magnitudeAt) over the
 * interval to its neighbouring bins by golden-section search. A sinusoid between two bins of the record's grid (24.5 h in a
 * 250 h record falls between 25 h and 22.7 h) is then reported at its own period and at its
 * own amplitude, instead of at a bin period with up to a third of its amplitude lost.
 *
 * @param {ReturnType<typeof computeFFT>} spec
 * @param {{periodMin?:number, periodMax?:number, indices?:number[]}} [opts]
 * @returns {{frequency:number, period:number, magnitude:number, phase:number, index:number}|null}
 */
export function fftPeak(spec, opts = {}) {
	const f = spec?.frequencies ?? [];
	const m = spec?.magnitudes ?? [];
	// Flat data, or a spectrum with no positive magnitude anywhere: there is no peak to
	// report, so no period (ROB-13). Callers treat null as "no rhythm".
	if (!f.length || spec?.flat) return null;
	let cand = opts.indices;
	if (!cand) {
		const lo = opts.periodMin ?? 0;
		const hi = opts.periodMax ?? Infinity;
		cand = [];
		for (let i = 0; i < f.length; i++) {
			const p = 1 / f[i];
			if (p >= lo && p <= hi) cand.push(i);
		}
	}
	let best = -1;
	for (const i of cand) if (Number.isFinite(m[i]) && (best < 0 || m[i] > m[best])) best = i;
	if (best < 0 || !(m[best] > 0)) return null;

	let freq = f[best];
	let mag = m[best];
	let phase = spec.phases?.[best] ?? NaN;
	const grid = spec.grid;
	if (grid?.y?.length) {
		// Between the neighbouring bins only: below the first bin lie periods longer than the
		// record, which it cannot show (a trend would otherwise "refine" to twice its length).
		let a = best > 0 ? f[best - 1] : f[best];
		let b = best < f.length - 1 ? f[best + 1] : f[best];
		// Stay inside the requested period range, if any.
		if (opts.periodMax != null && Number.isFinite(opts.periodMax))
			a = Math.max(a, 1 / opts.periodMax);
		if (opts.periodMin != null && opts.periodMin > 0) b = Math.min(b, 1 / opts.periodMin);
		if (b > a) {
			const gr = (Math.sqrt(5) - 1) / 2;
			let c = b - gr * (b - a);
			let d = a + gr * (b - a);
			let fc = magnitudeAt(grid.y, grid.dt, c).fit;
			let fd = magnitudeAt(grid.y, grid.dt, d).fit;
			for (let it = 0; it < 60 && b - a > 1e-12 * f[best]; it++) {
				if (fc > fd) {
					b = d;
					d = c;
					fd = fc;
					c = b - gr * (b - a);
					fc = magnitudeAt(grid.y, grid.dt, c).fit;
				} else {
					a = c;
					c = d;
					fc = fd;
					d = a + gr * (b - a);
					fd = magnitudeAt(grid.y, grid.dt, d).fit;
				}
			}
			const fr = (a + b) / 2;
			const at = magnitudeAt(grid.y, grid.dt, fr);
			// Keep the bin if the search found nothing better (a flat or edge maximum).
			if (at.fit >= magnitudeAt(grid.y, grid.dt, f[best]).fit) {
				freq = fr;
				mag = at.mag;
				phase = at.phase;
			}
		}
	}
	return { frequency: freq, period: 1 / freq, magnitude: mag, phase, index: best };
}
