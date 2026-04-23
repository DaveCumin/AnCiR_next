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
export function computeFFT(times, values, freqStep = null) {
	if (
		!times ||
		!values ||
		times.length < 2 ||
		values.length < 2 ||
		times.length !== values.length
	) {
		return {
			frequencies: [],
			magnitudes: [],
			phases: [],
			samplingRate: 0,
			nyquistFreq: 0,
			minPeriod: 0
		};
	}

	const validIndices = times
		.map((t, i) => (isNaN(t) || isNaN(values[i]) ? -1 : i))
		.filter((i) => i !== -1);

	if (validIndices.length === 0) {
		return {
			frequencies: [],
			magnitudes: [],
			phases: [],
			samplingRate: 0,
			nyquistFreq: 0,
			minPeriod: 0
		};
	}

	const t = validIndices.map((i) => times[i]);
	const y = validIndices.map((i) => values[i]);

	const yMean = mean(y);
	const yDetrended = y.map((val) => val - yMean);

	const dt = t.length > 1 ? (t[t.length - 1] - t[0]) / (t.length - 1) : 1;
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
	if (n < yDetrended.length) {
		n = Math.pow(2, Math.ceil(Math.log2(yDetrended.length)));
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
