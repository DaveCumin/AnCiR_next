// @ts-nocheck
import { mean } from '$lib/components/plotbits/helpers/wrangleData.js';

// Cooley-Tukey radix-2 FFT (recursive). Input: array of {re, im}.
function fft(signal) {
	const n = signal.length;
	if (n <= 1) return signal;

	const even = fft(signal.filter((_, i) => i % 2 === 0));
	const odd = fft(signal.filter((_, i) => i % 2 === 1));

	const result = new Array(n);
	for (let k = 0; k < n / 2; k++) {
		const angle = (-2 * Math.PI * k) / n;
		const t = {
			re: Math.cos(angle) * odd[k].re - Math.sin(angle) * odd[k].im,
			im: Math.cos(angle) * odd[k].im + Math.sin(angle) * odd[k].re
		};

		result[k] = { re: even[k].re + t.re, im: even[k].im + t.im };
		result[k + n / 2] = { re: even[k].re - t.re, im: even[k].im - t.im };
	}
	return result;
}

/**
 * Compute the magnitude spectrum of a signal.
 *
 * @param {number[]} times    - Sample times (hours; assumed approximately uniform).
 * @param {number[]} values   - Signal values aligned to `times`.
 * @param {number|null} freqStep - Desired frequency resolution (cycles/hr); null/0 = auto (next power of two).
 * @returns {{
 *   frequencies: number[],
 *   magnitudes: number[],
 *   phases: number[],
 *   samplingRate: number,
 *   nyquistFreq: number,
 *   minPeriod: number
 * }}
 */
const EMPTY_SPECTRUM = {
	frequencies: [],
	magnitudes: [],
	phases: [],
	samplingRate: 0,
	nyquistFreq: 0,
	minPeriod: 0
};

// Largest padded transform length we'll allocate. A radix-2 FFT over > ~16M
// samples is neither useful here nor allocatable; anything demanding more is a
// sign of a degenerate (non-time) input rather than a real request.
const MAX_FFT_N = 1 << 24;

export function computeFFT(times, values, freqStep = null) {
	if (
		!times ||
		!values ||
		times.length < 2 ||
		values.length < 2 ||
		times.length !== values.length
	) {
		return { ...EMPTY_SPECTRUM };
	}

	const validIndices = times
		.map((t, i) => (isNaN(t) || isNaN(values[i]) ? -1 : i))
		.filter((i) => i !== -1);

	if (validIndices.length === 0) {
		return { ...EMPTY_SPECTRUM };
	}

	const t = validIndices.map((i) => times[i]);
	const y = validIndices.map((i) => values[i]);

	const yMean = mean(y);
	const yDetrended = y.map((val) => val - yMean);

	const dt = t.length > 1 ? (t[t.length - 1] - t[0]) / (t.length - 1) : 1;
	// The FFT assumes an increasing, uniformly-sampled time axis. A non-time /
	// non-monotonic X input (e.g. plain data values accidentally wired into the
	// time port) yields a zero, negative, or non-finite sample interval, which
	// makes samplingRate (1/dt) Infinite/negative and downstream the transform
	// length nonsensical. Bail with an empty spectrum instead of computing garbage
	// (or throwing "Invalid array length" while allocating the padded buffer).
	if (!Number.isFinite(dt) || dt <= 0) {
		return { ...EMPTY_SPECTRUM };
	}

	const samplingRate = 1 / dt;
	const nyquistFreq = samplingRate / 2;
	const minPeriod = 2 * dt;

	let n;
	if (freqStep && freqStep > 0) {
		n = Math.ceil(samplingRate / freqStep);
		n = Math.pow(2, Math.ceil(Math.log2(n)));
	} else {
		n = Math.pow(2, Math.ceil(Math.log2(yDetrended.length)));
	}
	if (!(n >= yDetrended.length)) {
		// Covers n < length as well as NaN (e.g. log2 of a bad value).
		n = Math.pow(2, Math.ceil(Math.log2(yDetrended.length)));
	}
	// Defensive: never try to allocate a non-finite or absurd padded length.
	if (!Number.isFinite(n) || n > MAX_FFT_N) {
		return { ...EMPTY_SPECTRUM };
	}
	const padded = [...yDetrended, ...new Array(n - yDetrended.length).fill(0)];
	const signal = padded.map((val) => ({ re: val, im: 0 }));

	const fftResult = fft(signal);

	const halfN = Math.floor(n / 2);
	const frequencies = [];
	const magnitudes = [];
	const phases = [];

	for (let i = 1; i < halfN; i++) {
		const freq = (i * samplingRate) / n;
		if (freq > nyquistFreq) break;
		frequencies.push(freq);
		const magnitude = (Math.sqrt(fftResult[i].re ** 2 + fftResult[i].im ** 2) * 2) / n;
		magnitudes.push(magnitude);
		phases.push(Math.atan2(fftResult[i].im, fftResult[i].re));
	}

	return { frequencies, magnitudes, phases, samplingRate, nyquistFreq, minPeriod };
}
