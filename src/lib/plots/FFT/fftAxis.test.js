import { describe, it, expect } from 'vitest';
import {
	fftXAxisLabel,
	convertFftLimits,
	isAutoFftLabel,
	FFT_PERIOD_LABEL,
	FFT_FREQUENCY_LABEL
} from './fftAxis.js';
import { FFTclass } from './FFT.svelte';

describe('fftXAxisLabel', () => {
	it('gives the label for the mode when the stored label is automatic', () => {
		expect(fftXAxisLabel('Frequency', true)).toBe(FFT_PERIOD_LABEL);
		expect(fftXAxisLabel('Frequency', false)).toBe(FFT_FREQUENCY_LABEL);
		expect(fftXAxisLabel(FFT_PERIOD_LABEL, false)).toBe(FFT_FREQUENCY_LABEL);
		expect(fftXAxisLabel(FFT_FREQUENCY_LABEL, true)).toBe(FFT_PERIOD_LABEL);
	});

	it("keeps the user's own wording, including a deliberately empty label", () => {
		expect(fftXAxisLabel('Tau (h)', false)).toBe('Tau (h)');
		expect(fftXAxisLabel('', true)).toBe('');
		expect(isAutoFftLabel('')).toBe(false);
	});
});

describe('convertFftLimits', () => {
	it('inverts AND swaps the ends', () => {
		const [lo, hi] = convertFftLimits([5, 30]);
		expect(lo).toBeCloseTo(1 / 30);
		expect(hi).toBeCloseTo(1 / 5);
	});

	it('keeps an unset or non-positive end unset instead of producing Infinity', () => {
		expect(convertFftLimits([null, null])).toEqual([null, null]);
		expect(convertFftLimits([0, 10])).toEqual([0.1, null]);
	});
});

describe('FFTclass x-axis label follows the mode', () => {
	it('a legacy session with no xAxis in period mode is labelled as period (the paper bug)', () => {
		const fft = FFTclass.fromJSON(null, { showPeriod: true, xlimsIN: [5, 30], data: [] });
		expect(fft.xAxis.label).toBe(FFT_PERIOD_LABEL);
	});

	it('a legacy session in frequency mode is labelled as frequency', () => {
		const fft = FFTclass.fromJSON(null, { showPeriod: false, data: [] });
		expect(fft.xAxis.label).toBe(FFT_FREQUENCY_LABEL);
	});

	it('a saved "Frequency" label on a period plot is corrected on load', () => {
		const fft = FFTclass.fromJSON(null, {
			showPeriod: true,
			xAxis: { label: 'Frequency', gridlines: true, nticks: 5 },
			data: []
		});
		expect(fft.xAxis.label).toBe(FFT_PERIOD_LABEL);
	});

	it('toggling the mode relabels an automatic label and leaves a custom one alone', () => {
		const fft = FFTclass.fromJSON(null, { showPeriod: true, data: [] });
		fft.showPeriod = false;
		expect(fft.xAxis.label).toBe(FFT_FREQUENCY_LABEL);
		fft.showPeriod = true;
		expect(fft.xAxis.label).toBe(FFT_PERIOD_LABEL);

		fft.xAxis.label = 'Tau (h)';
		fft.showPeriod = false;
		expect(fft.xAxis.label).toBe('Tau (h)');
	});

	it('round-trips showPeriod through toJSON', () => {
		const fft = FFTclass.fromJSON(null, { showPeriod: true, data: [] });
		expect(fft.toJSON().showPeriod).toBe(true);
		expect(fft.toJSON().xAxis.label).toBe(FFT_PERIOD_LABEL);
	});
});
