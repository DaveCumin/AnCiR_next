// @ts-nocheck
import { mean } from '$lib/components/plotbits/helpers/wrangleData.js';
import { validPairs } from './validPairs.js';

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
 * its separation lies within half a slot of k * dt. These rules make it well defined:
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
 *   4. A slot that holds no pair has no estimate: its correlation is NaN (missing), not 0.
 *      The slotted estimator is a ratio over the pairs in the slot (Rehfeld et al., Eq. 10),
 *      so with no pairs its denominator is zero and it is undefined. An r = 0 there is a
 *      number the data never gave, and it misled the peak search: on 0.25 / 0.75 h spacing
 *      (median step 0.25 h, so every k + 0.5 h slot is empty) the first empty slot in the
 *      trough read as the return to non-negative, and a 24 h rhythm reported its period as
 *      6.5 h with r = 0. The plot leaves a gap there, the peak search skips it, and the CSV
 *      export writes a blank cell.
 *   5. The lag window is set in hours, not samples: by default it ends at half the recording
 *      span, on both paths (see the comment at the cap below).
 *
 * Edelson and Krolik's original paper was not available to check here; the rules above rest on
 * Rehfeld et al.'s description of it and on the definition of the normalised autocorrelation.
 * The Python and R ports (tools/ancir_runtime.py, tools/ancir_runtime.R) follow the same
 * rules, pinned by the parity fixtures plot-correlogram-{upper-median,boundary-pair,
 * near-zero-pairs,empty-slots}.
 *
 * @param {number[]} times      - Sample times (hours).
 * @param {number[]} values     - Signal values aligned to `times`.
 * @param {number|null} binSize - Lag bin width (hours); null = derive from data spacing.
 * @param {number|null} maxLag  - Maximum lag (hours); null = half the recording span,
 *                               (last valid time - first) / 2. Capped at the span.
 * @param {number}      minLag  - Minimum lag (hours); defaults to 0. Lags below this are dropped.
 *
 * `peakLag` / `peakCorrelation` are the dominant period, via findAutocorrelationPeak
 * below (one implementation, reachable either from here or directly).
 * `counts` holds the pairs behind each lag (n at lag 0) and `n` the valid samples; the
 * significance band is built from them (correlogramBand).
 * @returns {{ lags: number[], correlations: number[], counts: number[], n: number, dt: number, peakLag: number, peakCorrelation: number }}
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

	// Rule 5: the lag window is set by TIME, not by the sample count. The default reaches half
	// the recording span, (last - first) / 2, on both paths. Chatfield (The Analysis of Time
	// Series) advises reading an autocorrelogram only out to about N/4 to N/2, as the long lags
	// rest on few pairs; that N counts samples because his series are evenly spaced. Here the
	// spacing may be uneven, so the cap is half the span in hours: an n / 2 cap in STEPS
	// stopped 0.25 / 0.75 h data (median step 0.25 h) at a quarter of the span, 18 h of a
	// 3-day record, before its 24 h peak. On evenly spaced data the span is (n - 1) steps, so
	// the default is floor((n - 1) / 2) steps, which is what the old min(span / 2, n / 2)
	// already gave there. A user max lag wins over the default, up to the span itself (no
	// pair is further apart than that); on the index-shift path also below n shifts.
	const span = t[t.length - 1] - t[0];
	const maxLagTime = maxLag ? maxLag : span / 2;
	const minLagTime = Number.isFinite(minLag) && minLag > 0 ? minLag : 0;

	if (minLagTime >= maxLagTime) {
		return { lags: [], correlations: [], dt };
	}

	let nLags = Math.min(Math.floor(maxLagTime / dt), Math.floor(span / dt));
	const startLagIdx = Math.ceil(minLagTime / dt);

	const yMean = mean(y);
	const yVariance = y.reduce((sum, val) => sum + (val - yMean) ** 2, 0) / n;

	if (yVariance === 0) {
		return { lags: [], correlations: [], dt };
	}

	const lags = [];
	const correlations = [];
	// The pairs behind each lag's estimate (n at lag 0): the (N - k) band and the Bartlett
	// band's N-normalised correlations (correlogramBand below) are built from them.
	const counts = [];

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
		// Rule 5: a shift of n samples or more has no pairs (reachable when a near-uniform
		// spacing makes span / dt exceed n - 1).
		nLags = Math.min(nLags, n - 1);
		for (let lag = startLagIdx; lag <= nLags; lag++) {
			// Rule 1: lag 0 is 1 by definition, not sum / (n * var) with its rounding.
			if (lag === 0) {
				lags.push(0);
				correlations.push(1);
				counts.push(n);
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
			// Rule 4 (unreachable here, as lag <= n - 1 always leaves a pair; kept for symmetry).
			const correlation = count > 0 ? sum / (count * yVariance) : NaN;
			lags.push(lag * dt);
			correlations.push(correlation);
			counts.push(count);
		}
	} else {
		for (let lagIdx = startLagIdx; lagIdx <= nLags; lagIdx++) {
			const targetLag = lagIdx * dt;
			// Rule 1: lag 0 is 1 by definition; the near-zero, non-self pairs are not used.
			if (lagIdx === 0) {
				lags.push(0);
				correlations.push(1);
				counts.push(n);
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
			// Rule 4: an empty slot is missing, not r = 0.
			const correlation = count > 0 ? sum / (count * yVariance) : NaN;
			lags.push(targetLag);
			correlations.push(correlation);
			counts.push(count);
		}
	}

	const peak = findAutocorrelationPeak(lags, correlations);
	return {
		lags,
		correlations,
		counts,
		n,
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

/**
 * The significance bands the Correlogram plot offers, in its select's order.
 *  - 'bartlett': Bartlett's large-lag standard error (Bartlett 1946, "On the theoretical
 *    specification and sampling properties of autocorrelated time-series", J. R. Statist.
 *    Soc. Suppl. 8:27-41), SE_k = sqrt((1 + 2 sum_{j=1}^{k-1} r_j^2) / N): the band under
 *    the null that the series is a moving average of order k - 1, so it widens past the lags
 *    that are already correlated. It is the band statsmodels plot_acf draws
 *    (bartlett_confint=True, its default); r_j there is the N-normalised ACF, which is what
 *    is used here (the plotted (N - k)-normalised r_j times its pairs over N). The default
 *    for a new plot (decision 2026-11-01).
 *  - 'white': +/- z / sqrt(N) at every lag, the white-noise band at short lags. Every
 *    Correlogram saved before the band became a choice draws this one.
 *  - 'nk': +/- z / sqrt(N - k), the white-noise standard error of THIS estimator, which
 *    averages the N - k products at lag k (on uneven sampling, the pairs in the lag slot).
 */
export const CORRELOGRAM_BAND_METHODS = ['bartlett', 'white', 'nk'];
export const CORRELOGRAM_BAND_LABELS = {
	bartlett: 'Bartlett (default)',
	white: '±z/√N',
	nk: '±z/√(N−k)'
};
/** The band of a new series, and of a saved series that predates the choice. */
export const NEW_CORRELOGRAM_BAND = 'bartlett';
export const LEGACY_CORRELOGRAM_BAND = 'white';

/**
 * The band a saved correlogram series draws: its own `bandMethod`, else, for a series a
 * session saved before the choice existed (it carries `showConfidenceBounds`, which every
 * saved series has written since the plot was added), the old +/- z / sqrt(N), else (a new
 * series from a quick plot, the MCP or an AI edit, which name only their columns) Bartlett.
 * tools/ancir_runtime.py correlogram_band_method applies the same rule.
 * @param {object|null|undefined} json  a series' saved JSON
 */
export function correlogramBandMethodOf(json) {
	const m = json?.bandMethod;
	if (CORRELOGRAM_BAND_METHODS.includes(m)) return m;
	if (json?.showConfidenceBounds !== undefined && json?.showConfidenceBounds !== null)
		return LEGACY_CORRELOGRAM_BAND;
	return NEW_CORRELOGRAM_BAND;
}

/** The z the plot has always used: 1.96 at 95%, else (99%) 2.576. */
export function correlogramBandZ(level) {
	return level === 0.95 ? 1.96 : 2.576;
}

/**
 * The upper and lower significance band at each lag of `acf` (a computeAutocorrelation
 * result), for `method` (CORRELOGRAM_BAND_METHODS) at `level` (0.95 or 0.99).
 *
 * The Bartlett band at lag k needs r_1 .. r_{k-1}; when the plotted window starts above lag 1
 * (a min lag), pass `full`, the same correlogram computed from lag 0, to supply them. A lag
 * whose correlation is missing (an empty slot) adds nothing to the sum. At lag 0 the Bartlett
 * band is missing (statsmodels gives it zero width: r_0 = 1 is not estimated). With fewer
 * than two samples every band is missing, except the legacy 'white' band, which is 0 there.
 *
 * `nWhite` is the N of the 'white' band. The plot has always counted the y values present
 * (whatever their times), so it passes that count and a saved session draws exactly the band
 * it drew before; without it the band uses the valid pairs, `acf.n`.
 * @param {{lags:number[], correlations:number[], counts?:number[], n?:number, dt:number}} acf
 * @param {{method?: string, level?: number, full?: object|null, nWhite?: number}} [opts]
 * @returns {{upper:number[], lower:number[]}}
 */
export function correlogramBand(
	acf,
	{ method = NEW_CORRELOGRAM_BAND, level = 0.95, full = null, nWhite = null } = {}
) {
	const lags = acf?.lags ?? [];
	const n = acf?.n ?? 0;
	const z = correlogramBandZ(level);
	const half = new Array(lags.length).fill(NaN);
	if (method === 'white') {
		const nw = nWhite ?? n;
		half.fill(nw >= 2 ? z / Math.sqrt(nw) : 0);
	} else if (n >= 2) {
		if (method === 'nk') {
			const counts = acf.counts ?? [];
			for (let i = 0; i < lags.length; i++) {
				const c = counts[i];
				half[i] = c > 0 ? z / Math.sqrt(c) : NaN;
			}
		} else {
			// Bartlett: the cumulative sum of the N-normalised r_j^2 over j = 1 .. k - 1,
			// indexed by whole lag steps (lags are multiples of dt).
			const src = full ?? acf;
			const dt = src.dt;
			const r2 = new Map();
			for (let i = 0; i < (src.lags?.length ?? 0); i++) {
				const k = Math.round(src.lags[i] / dt);
				const r = src.correlations[i];
				const c = src.counts?.[i] ?? 0;
				if (k >= 1 && Number.isFinite(r) && c > 0) r2.set(k, ((r * c) / n) ** 2);
			}
			const kOf = lags.map((l) => Math.round(l / acf.dt));
			let kMax = 0;
			for (const k of kOf) if (k > kMax) kMax = k;
			const cum = new Array(kMax + 1).fill(0); // cum[k] = sum_{j=1}^{k-1} r_j^2
			for (let k = 2; k <= kMax; k++) cum[k] = cum[k - 1] + (r2.get(k - 1) ?? 0);
			for (let i = 0; i < lags.length; i++) {
				const k = kOf[i];
				half[i] = k >= 1 ? z * Math.sqrt((1 + 2 * cum[k]) / n) : NaN;
			}
		}
	}
	return { upper: half, lower: half.map((h) => -h) };
}
