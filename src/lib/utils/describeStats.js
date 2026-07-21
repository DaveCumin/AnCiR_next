// @ts-nocheck
// Summary statistics for one column — the "describe the data" primitives.
//
// Elementary descriptive stats, so bespoke + tested (D13 policy): mean/variance/sd/median
// reuse sampleStats; skewness and kurtosis are added here. Every field is NaN for an empty /
// all-invalid column rather than a throw. Uses pairwise-complete filtering (drop null/NaN).
import { mean, sampleVariance, sampleStd, median } from './sampleStats.js';
import { isInvalidValue } from './stats.js';

/**
 * @param {number[]} values
 * @returns {{n:number, mean:number, median:number, sd:number, variance:number,
 *            min:number, max:number, range:number, skewness:number, kurtosis:number,
 *            q1:number, q3:number, iqr:number}}
 *   skewness is the adjusted Fisher-Pearson standardised moment (g1 with the sample
 *   correction, matching scipy.stats.skew(bias=False)); kurtosis is EXCESS kurtosis
 *   (g2, bias-corrected — scipy.stats.kurtosis(bias=False)); 0 for a normal.
 */
export function describeStats(values) {
	const clean = (values ?? []).filter((v) => !isInvalidValue(v)).map(Number);
	const n = clean.length;
	const nan = NaN;
	const out = {
		n,
		mean: nan,
		median: nan,
		sd: nan,
		variance: nan,
		min: nan,
		max: nan,
		range: nan,
		skewness: nan,
		kurtosis: nan,
		q1: nan,
		q3: nan,
		iqr: nan
	};
	if (n === 0) return out;

	const m = mean(clean);
	out.mean = m;
	out.median = median(clean);
	out.variance = sampleVariance(clean);
	out.sd = sampleStd(clean);

	let min = clean[0];
	let max = clean[0];
	for (const v of clean) {
		if (v < min) min = v;
		if (v > max) max = v;
	}
	out.min = min;
	out.max = max;
	out.range = max - min;

	// Quartiles (linear interpolation, type-7 / numpy default).
	const sorted = [...clean].sort((a, b) => a - b);
	const quantile = (q) => {
		if (n === 1) return sorted[0];
		const pos = q * (n - 1);
		const lo = Math.floor(pos);
		const frac = pos - lo;
		return sorted[lo] + (sorted[Math.min(lo + 1, n - 1)] - sorted[lo]) * frac;
	};
	out.q1 = quantile(0.25);
	out.q3 = quantile(0.75);
	out.iqr = out.q3 - out.q1;

	// Central moments for skewness / kurtosis.
	let m2 = 0;
	let m3 = 0;
	let m4 = 0;
	for (const v of clean) {
		const d = v - m;
		const d2 = d * d;
		m2 += d2;
		m3 += d2 * d;
		m4 += d2 * d2;
	}
	m2 /= n;
	m3 /= n;
	m4 /= n;
	const sd_pop = Math.sqrt(m2);
	if (n >= 3 && sd_pop > 0) {
		const g1 = m3 / (sd_pop * sd_pop * sd_pop);
		// bias-corrected sample skewness (scipy skew bias=False)
		out.skewness = (Math.sqrt(n * (n - 1)) / (n - 2)) * g1;
	}
	if (n >= 4 && m2 > 0) {
		const g2 = m4 / (m2 * m2) - 3; // excess kurtosis (biased)
		// bias-corrected excess kurtosis (scipy kurtosis bias=False)
		out.kurtosis = ((n - 1) / ((n - 2) * (n - 3))) * ((n + 1) * g2 + 6);
	}
	return out;
}

/** The stat keys DescribeData exposes, in display order. */
export const DESCRIBE_KEYS = [
	'n',
	'mean',
	'median',
	'sd',
	'min',
	'max',
	'range',
	'q1',
	'q3',
	'iqr',
	'skewness',
	'kurtosis'
];
