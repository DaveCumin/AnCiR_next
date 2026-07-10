// @ts-nocheck
/**
 * FFT-based frequency-domain filtering of a uniformly-sampled real series.
 *
 * This module is self-contained: `computeFFT` in `fft.js` only produces a
 * magnitude spectrum (no inverse transform), so we implement our own in-place
 * iterative radix-2 Cooley-Tukey FFT with a matching inverse here. Non
 * power-of-two inputs are handled by zero-padding up to the next power of two,
 * filtering in the frequency domain, inverting, and truncating back to the
 * original length.
 *
 * Cutoffs are expressed in **normalized frequency**: a fraction of the Nyquist
 * frequency in the range 0..1, where 0 is DC and 1 is Nyquist. For a padded
 * transform of length M, DFT bin k maps to normalized frequency
 * `2 * min(k, M - k) / M` (folding the negative-frequency half onto the
 * positive one).
 */

/** Next power of two >= n (>= 1). Uses integer shifts to avoid log2 rounding. */
export function nextPow2(n) {
	if (n <= 1) return 1;
	let p = 1;
	while (p < n) p <<= 1;
	return p;
}

/**
 * In-place iterative radix-2 FFT over parallel real/imag arrays.
 * `re.length` must be a power of two. Inverse divides by n.
 * @param {number[]} re
 * @param {number[]} im
 * @param {boolean} inverse
 */
export function fftInPlace(re, im, inverse = false) {
	const n = re.length;
	if (n <= 1) return;

	// Bit-reversal permutation.
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			const tr = re[i];
			re[i] = re[j];
			re[j] = tr;
			const ti = im[i];
			im[i] = im[j];
			im[j] = ti;
		}
	}

	for (let len = 2; len <= n; len <<= 1) {
		const ang = ((inverse ? 2 : -2) * Math.PI) / len;
		const wr = Math.cos(ang);
		const wi = Math.sin(ang);
		const half = len >> 1;
		for (let i = 0; i < n; i += len) {
			let cwr = 1;
			let cwi = 0;
			for (let k = 0; k < half; k++) {
				const a = i + k;
				const b = a + half;
				const vr = re[b] * cwr - im[b] * cwi;
				const vi = re[b] * cwi + im[b] * cwr;
				re[b] = re[a] - vr;
				im[b] = im[a] - vi;
				re[a] += vr;
				im[a] += vi;
				const nwr = cwr * wr - cwi * wi;
				cwi = cwr * wi + cwi * wr;
				cwr = nwr;
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

const isFiniteNum = (v) => v != null && Number.isFinite(Number(v));

/**
 * Whether DC (normalized frequency 0) is inside the passband for a filter type.
 */
function dcInBand(type, low, high) {
	if (type === 'high') return 0 >= low;
	if (type === 'band') return 0 >= low && 0 <= high;
	return 0 <= high; // 'low'
}

/**
 * Frequency-domain low/high/band-pass filter of a uniformly-sampled series.
 *
 * The series mean is subtracted before transforming (so the DC bin carries no
 * energy) and re-added afterwards only when DC lies inside the passband. This
 * keeps a high-pass filter zero-mean and a low/band-pass filter that includes
 * DC at the original offset.
 *
 * Missing entries (null/undefined/NaN/±Infinity) are substituted with the mean
 * of the valid values for the transform, then re-emitted as `null` in the
 * output so downstream code still sees them as missing.
 *
 * @param {Array<number|null>} y  Uniformly-sampled values.
 * @param {{ type?: 'low'|'high'|'band', low?: number, high?: number }} opts
 *        Normalized cutoffs (fraction of Nyquist, 0..1). `low` is the lower edge
 *        (high-pass / band-pass); `high` is the upper edge (low-pass / band-pass).
 * @returns {Array<number|null>} Filtered series, same length as `y`.
 */
export function fftFilter(y, opts = {}) {
	const type = opts.type ?? 'low';
	const low = Number(opts.low ?? 0);
	const high = Number(opts.high ?? 1);
	const n = y.length;
	if (n === 0) return [];

	const valid = new Array(n);
	const validVals = [];
	for (let i = 0; i < n; i++) {
		valid[i] = isFiniteNum(y[i]);
		if (valid[i]) validVals.push(Number(y[i]));
	}

	// Not enough signal to filter — return a numeric copy, preserving missing.
	if (validVals.length < 2) {
		return y.map((v) => (isFiniteNum(v) ? Number(v) : null));
	}

	let mean = 0;
	for (const v of validVals) mean += v;
	mean /= validVals.length;

	const M = nextPow2(n);
	const re = new Array(M).fill(0);
	const im = new Array(M).fill(0);
	for (let i = 0; i < n; i++) {
		re[i] = (valid[i] ? Number(y[i]) : mean) - mean;
	}

	fftInPlace(re, im, false);

	for (let k = 0; k < M; k++) {
		const kk = Math.min(k, M - k);
		const normFreq = (2 * kk) / M;
		let keep;
		if (type === 'high') keep = normFreq >= low;
		else if (type === 'band') keep = normFreq >= low && normFreq <= high;
		else keep = normFreq <= high; // 'low'
		if (!keep) {
			re[k] = 0;
			im[k] = 0;
		}
	}

	fftInPlace(re, im, true);

	const addBack = dcInBand(type, low, high) ? mean : 0;
	const out = new Array(n);
	for (let i = 0; i < n; i++) {
		out[i] = valid[i] ? re[i] + addBack : null;
	}
	return out;
}
