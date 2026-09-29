// @ts-nocheck
import { mean } from '$lib/components/plotbits/helpers/wrangleData.js';
import { validPairs } from './validPairs.js';

// meanSpacing lives with the valid-row rules it applies; SurrogateTest uses it too. Re-exported
// so the Correlogram and its tests keep importing it from here.
export { meanSpacing } from './validPairs.js';

/**
 * Compute the autocorrelation function of a 1-D signal sampled at `times`.
 *
 * Uses a fast index-based path when sampling is approximately uniform (within
 * 10% of the median dt) and a slower time-pair path otherwise.
 *
 * The time-pair path is the slotted estimator for unevenly sampled series: every product of
 * two mean-removed samples is dropped into the lag slot its time separation falls in, and a
 * slot's correlation is the mean of its products over the variance. This is the discrete
 * correlation function of Edelson and Krolik (1988, ApJ 333:646), which Rehfeld et al. (2011,
 * "Comparison of correlation analysis techniques for irregularly sampled time series",
 * Nonlinear Processes in Geophysics 18:389-404, doi:10.5194/npg-18-389-2011, Sect. "Correlation
 * slotting", Eqs. 10-11 and Table 1) write as a rectangular kernel b_k that keeps a pair when
 * its separation lies within half a slot of k * dt. Three rules make it well defined:
 *
 *   1. Lag 0 is exactly 1, on both paths. A normalised autocorrelation is 1 at zero lag by
 *      definition. The slot around 0 holds each sample's pairing with itself (the product
 *      (y_i - mean)^2, whose mean over all i IS the variance, so 1) and any distinct pairs
 *      closer than half a step. Those near-zero pairs estimate the correlation at a small
 *      NON-zero lag, not at 0, and pull the slot away from 1. The old code left the
 *      self-pairs out and averaged only those near pairs: the fixture
 *      plot-correlogram-upper-median (step 2 h) read -0.142 at lag 0 from three pairs exactly
 *      1 h apart. So lag 0 is reported as 1 and the near-zero, non-self pairs
 *      (separation below half a step) are not used at any lag. On the index-shift path the
 *      sum-over-variance is 1 up to rounding (2 ulp off on some windows); it is set exactly.
 *   2. Slots are HALF-OPEN: lag k (k >= 1) takes the separations d with
 *      (k - 1/2) * dt <= d < (k + 1/2) * dt, so a pair exactly on a boundary is counted in
 *      one lag, the upper one, never in two. Rehfeld et al. state the window both ways (a
 *      strict "< 1/2" in Eq. 11, "d <= h/2" in Table 1); only a half-open window gives every
 *      pair exactly one slot.
 *   3. On evenly spaced data every separation is a whole number of steps, so rules 1 and 2
 *      change nothing there except lag 0 (see correlogram.evenSpacing.svelte.test.js).
 *
 * Edelson and Krolik's original paper was not available to check here; the rules above rest on
 * Rehfeld et al.'s description of it and on the definition of the normalised autocorrelation.
 * The Python and R ports (tools/ancir_runtime.py, tools/ancir_runtime.R) follow the same
 * rules, pinned by the parity fixtures plot-correlogram-{upper-median,boundary-pair,
 * near-zero-pairs}.
 *
 * @param {number[]} times      - Sample times (hours).
 * @param {number[]} values     - Signal values aligned to `times`.
 * @param {number|null} binSize - Lag bin width (hours); null = derive from data spacing.
 * @param {number|null} maxLag  - Maximum lag (hours); null = (timespan)/2.
 * @param {number}      minLag  - Minimum lag (hours); defaults to 0. Lags below this are dropped.
 *
 * `peakLag` / `peakCorrelation` are the dominant period, via findAutocorrelationPeak
 * below (one implementation, reachable either from here or directly).
 * @returns {{ lags: number[], correlations: number[], dt: number, peakLag: number, peakCorrelation: number }}
 */
export function computeAutocorrelation(times, values, binSize = null, maxLag = null, minLag = 0) {
	if (
		!times ||
		!values ||
		times.length < 2 ||
		values.length < 2 ||
		times.length !== values.length
	) {
		return { lags: [], correlations: [], dt: 1 };
	}

	// validPairs, not a bare isNaN: nulls would be correlated as zeros. See utils/validPairs.js.
	const { indices: validIndices } = validPairs(times, values);

	if (validIndices.length < 2) {
		return { lags: [], correlations: [], dt: 1 };
	}

	const t = validIndices.map((i) => times[i]).filter((val) => val != null);
	const y = validIndices.map((i) => values[i]).filter((val) => val != null);

	const n = y.length;

	let dt;
	if (binSize != null) {
		dt = binSize;
	} else {
		const diffs = [];
		for (let i = 1; i < t.length; i++) diffs.push(t[i] - t[i - 1]);
		diffs.sort((a, b) => a - b);
		dt = diffs[Math.floor(diffs.length / 2)];
	}

	// A non-time / non-monotonic X axis gives a non-positive or non-finite sample
	// spacing (median diff <= 0, or binSize=0), which makes the lag counts below
	// Infinite/negative/NaN. Autocorrelation is undefined there; bail cleanly.
	if (!Number.isFinite(dt) || dt <= 0) {
		return { lags: [], correlations: [], dt: 1 };
	}

	const maxLagTime = maxLag ? maxLag : (t[t.length - 1] - t[0]) / 2;
	const minLagTime = Number.isFinite(minLag) && minLag > 0 ? minLag : 0;

	if (minLagTime >= maxLagTime) {
		return { lags: [], correlations: [], dt };
	}

	const nLags = Math.min(Math.floor(maxLagTime / dt), Math.floor(n / 2));
	const startLagIdx = Math.ceil(minLagTime / dt);

	const yMean = mean(y);
	const yVariance = y.reduce((sum, val) => sum + (val - yMean) ** 2, 0) / n;

	if (yVariance === 0) {
		return { lags: [], correlations: [], dt };
	}

	const lags = [];
	const correlations = [];

	const isUniform = (diffs) => {
		if (!diffs || diffs.length === 0) return false;
		const median = diffs[Math.floor(diffs.length / 2)];
		const maxDev = diffs.reduce((m, d) => Math.max(m, Math.abs(d - median)), 0);
		return maxDev < median * 0.1;
	};

	const timeDiffs = [];
	for (let i = 1; i < t.length; i++) timeDiffs.push(t[i] - t[i - 1]);
	timeDiffs.sort((a, b) => a - b);

	if (isUniform(timeDiffs)) {
		for (let lag = startLagIdx; lag <= nLags; lag++) {
			// Rule 1: lag 0 is 1 by definition, not sum / (n * var) with its rounding.
			if (lag === 0) {
				lags.push(0);
				correlations.push(1);
				continue;
			}
			let sum = 0;
			let count = 0;
			for (let i = 0; i < n - lag; i++) {
				// isNaN-ok: y is built from validPairs + an explicit != null filter above.
				if (!isNaN(y[i]) && !isNaN(y[i + lag])) {
					sum += (y[i] - yMean) * (y[i + lag] - yMean);
					count++;
				}
			}
			const correlation = count > 0 ? sum / (count * yVariance) : 0;
			lags.push(lag * dt);
			correlations.push(correlation);
		}
	} else {
		for (let lagIdx = startLagIdx; lagIdx <= nLags; lagIdx++) {
			const targetLag = lagIdx * dt;
			// Rule 1: lag 0 is 1 by definition; the near-zero, non-self pairs are not used.
			if (lagIdx === 0) {
				lags.push(0);
				correlations.push(1);
				continue;
			}
			// Rule 2: the half-open slot [(k - 1/2) dt, (k + 1/2) dt).
			const lo = (lagIdx - 0.5) * dt;
			const hi = (lagIdx + 0.5) * dt;
			let sum = 0;
			let count = 0;

			for (let i = 0; i < n; i++) {
				for (let j = i + 1; j < n; j++) {
					const timeDiff = t[j] - t[i];
					if (timeDiff >= lo && timeDiff < hi) {
						// isNaN-ok: y is built from validPairs + an explicit != null filter above.
						if (!isNaN(y[i]) && !isNaN(y[j])) {
							sum += (y[i] - yMean) * (y[j] - yMean);
							count++;
						}
					}
					if (timeDiff >= hi) break;
				}
			}
			const correlation = count > 0 ? sum / (count * yVariance) : 0;
			lags.push(targetLag);
			correlations.push(correlation);
		}
	}

	const peak = findAutocorrelationPeak(lags, correlations);
	return {
		lags,
		correlations,
		dt,
		peakLag: peak?.lag ?? NaN,
		peakCorrelation: peak?.correlation ?? NaN
	};
}

// Two lags whose correlation differs by less than this are a TIE, not a ranking:
// a perfectly periodic series lands on its repeat value to within a few ulps, so
// a raw `>` lets floating-point noise decide which repeat is reported.
const TIE = 1e-12;

/**
 * The peak of an autocorrelogram: the DOMINANT PERIOD of the series.
 *
 * This convention deliberately differs from the cross-correlogram's (see
 * utils/crossCorrelation.js, which takes the largest |r| and so is sign-blind).
 * Autocorrelation is not the same question:
 *
 *   - Lag 0 is exactly 1 by definition, so "largest |r|" would always answer 0
 *     and the reported number would carry no information at all.
 *   - A rhythm is ANTI-correlated with itself at half a period, so the largest
 *     |r| at a non-zero lag is typically r = -1 at P/2. That is the same single
 *     rhythm seen in antiphase, not a second finding, and reporting lag 12 for a
 *     24 h rhythm would be actively misleading. Sign-blindness is wrong here.
 *   - A rhythm also repeats at every MULTIPLE of its period, and this estimator
 *     normalises each lag by its own overlap count, so the long-lag correlations
 *     are computed from fewer and fewer pairs and drift ABOVE the ones at the
 *     fundamental (values over 1 are routine at lag 3P). A plain maximum over
 *     non-zero lags therefore reports 2P, 3P or the last lag in the window
 *     rather than the period: a 12 h rhythm sampled hourly for five days
 *     reported 36 h.
 *
 * So the peak is the first SUBSTANTIAL POSITIVE peak away from zero, which is
 * the standard reading of a circadian autocorrelogram (Levine et al. 2002,
 * "Signal analysis of behavioral and molecular cycles", BMC Neuroscience 3:1):
 *
 *   1. drop lag 0 and any non-finite correlation;
 *   2. find where the correlogram first goes NEGATIVE (the trough at half a
 *      period) and then returns to non-negative: that contiguous positive run is
 *      the first lobe;
 *   3. the peak is the largest correlation inside that lobe, ties within 1e-12
 *      going to the smaller lag (the fundamental, never its echo);
 *   4. if the correlogram never dips negative, or never comes back up after
 *      dipping, there is no lobe to read: fall back to the largest correlation
 *      over the non-zero lags, same tie rule. That covers a user-narrowed lag
 *      window that starts on the rising flank, and a monotonically decaying
 *      (non-rhythmic) correlogram, where the honest answer is simply the
 *      strongest repeat on offer.
 *
 * @param {number[]} lags
 * @param {number[]} correlations
 * @returns {{lag:number, correlation:number, index:number}|null} null when there is nothing to read
 */
export function findAutocorrelationPeak(lags, correlations) {
	if (!lags?.length || !correlations?.length) return null;
	const candidates = [];
	const n = Math.min(lags.length, correlations.length);
	for (let i = 0; i < n; i++) {
		if (lags[i] > 0 && Number.isFinite(correlations[i])) candidates.push(i);
	}
	if (!candidates.length) return null;

	let window = candidates;
	let dip = -1;
	for (let k = 0; k < candidates.length; k++) {
		if (correlations[candidates[k]] < 0) {
			dip = k;
			break;
		}
	}
	if (dip >= 0) {
		let start = -1;
		for (let k = dip + 1; k < candidates.length; k++) {
			if (correlations[candidates[k]] >= 0) {
				start = k;
				break;
			}
		}
		if (start >= 0) {
			let end = start;
			while (end + 1 < candidates.length && correlations[candidates[end + 1]] >= 0) end++;
			window = candidates.slice(start, end + 1);
		}
	}

	let best = window[0];
	for (const i of window) {
		if (correlations[i] > correlations[best] + TIE) best = i;
	}
	return { lag: lags[best], correlation: correlations[best], index: best };
}
