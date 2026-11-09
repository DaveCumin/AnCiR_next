// @ts-nocheck
// Periodogram calculations — extracted from web worker, using native JS with Kahan summation.

import { KahanSum, kahanMean, makeSeqArray } from '$lib/utils/numerics.js';
import { chisqSf } from './chisqSf.js';
import quantile_chisq from '@stdlib/stats-base-dists-chisquare-quantile';
import { binData } from '$lib/components/plotbits/helpers/wrangleData.js';
import { validPairs } from './validPairs.js';
import { isInvalidValue } from './stats.js';
import { medianSamplingInterval, samplingStep } from './samplingInterval.js';

// Re-exported: callers have long imported medianSamplingInterval from here.
export { medianSamplingInterval, samplingStep };

// ========== Degenerate input (ROB-13) ==========

/**
 * True when the series carries no variation at all: every usable value (missing values,
 * null, blanks and NaN skipped) is EXACTLY the same, or there are fewer than two of them.
 *
 * Exact equality on purpose. A constant like 0.1 is not representable, so after the mean is
 * removed every sample is left with the same tiny rounding residue (~1e-17), and a
 * variance-based test then divides that residue by an equally tiny variance: Chi-squared
 * reported Qp = N at every period (hugely "significant"), Enright a power of 1, and the
 * FFT/Lomb-Scargle argmax landed on whichever period the rounding favoured. No real
 * recording is exactly constant unless it truly has no signal (an off-wrist stretch, a dead
 * channel, a zero-filled segment), and those must report "no rhythm".
 *
 * @param {ArrayLike<any>} values
 * @returns {boolean}
 */
export function isFlatSeries(values) {
	let first;
	let seen = 0;
	for (let i = 0; i < (values?.length ?? 0); i++) {
		const raw = values[i];
		if (isInvalidValue(raw)) continue;
		const v = Number(raw); // Number-ok: checked with isInvalidValue on the line above
		if (seen === 0) first = v;
		else if (v !== first) return false;
		seen++;
	}
	return true;
}

/**
 * An approximate greatest common divisor of two positive numbers: Euclid's algorithm with a
 * remainder within 1% of the current divisor counted as zero (stored times are rounded, so
 * an exact gcd of 0.1667 and 1/6 would be a meaningless 3e-5). NaN when the remainders
 * shrink below 1% of the smaller input without dividing evenly (no common grid).
 *
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function approxGcd(a, b) {
	let hi = Math.max(a, b);
	let lo = Math.min(a, b);
	const floor = 0.01 * lo;
	for (let i = 0; i < 64 && lo >= floor; i++) {
		const r = hi % lo;
		if (r < 0.01 * lo || lo - r < 0.01 * lo) return lo;
		hi = lo;
		lo = r;
	}
	return NaN;
}

/** Fraction of samples that must sit on the sample grid for the grid origin to apply. */
const ON_GRID_SHARE = 0.9;
/** How far (as a fraction of the grid step) a sample may sit from the grid and count as on it. */
const ON_GRID_TOL = 0.05;

/**
 * Where the binned methods start their first bin.
 *
 * REGULAR data (at least 90% of the samples within 5% of a step of the grid min(x) + k * dt):
 * min(x) - g / 2, where g = gcd(dt, binSize) is the finest spacing between bin edges and
 * samples (g = dt when binSize is a whole number of samples, g = binSize when it is a
 * fraction of one). Every bin edge then lies as far as possible from every sample (midway
 * between two, when binSize is a whole number of samples), never on one. dt is samplingStep
 * (the mean of the gaps near the median), so rounded stored times do not drift off the grid
 * over a long record.
 *
 * Edges used to sit on the binSize grid, floor(min(x) / binSize) * binSize, which for the
 * common case (bin size = sampling interval, times on the grid) put EVERY sample exactly on a
 * bin edge. Times are usually stored rounded (10-min data as 24.1667, 24.3333, ... h with
 * binSize 1/6 h), so which side of the edge a sample fell on was decided by floating-point
 * noise: some bins got two samples and others none (672 non-empty bins for 1008 samples).
 * The Chi-squared fold then had fewer effective columns at some periods than others, so its
 * df and threshold saw-toothed from fold to fold (every third fold ~30% lower) and the peak
 * could move by hours. With the edges g / 2 from any sample, rounding smaller than that
 * cannot change which bin a sample falls in. Each bin keeps the samples it had under the old
 * origin whenever those samples were not on an edge, so such results do not move.
 *
 * IRREGULAR data (jittered times) has no edge placement that avoids every sample, so it keeps
 * the binSize grid, floor(min(x) / binSize) * binSize (one binSize lower if that rounds above
 * min(x)), and its results do not move either.
 *
 * Both anchor on min(x) rather than t = 0: a record starting at -120 h keeps every sample,
 * and Unix-second times (~1.7e8) do not make binData walk hundreds of millions of leading
 * empty bins. Mirrored in tools/ancir_runtime.py and tools/ancir_runtime.R (bin_origin).
 *
 * @param {number[]} xs  times, already filtered to finite values
 * @param {number} binSize
 * @returns {number}
 */
export function binOrigin(xs, binSize) {
	const vals = [];
	let min = Infinity;
	for (let i = 0; i < xs.length; i++) {
		if (isInvalidValue(xs[i])) continue;
		const v = Number(xs[i]); // Number-ok: checked with isInvalidValue on the line above
		if (!Number.isFinite(v)) continue;
		vals.push(v);
		if (v < min) min = v;
	}
	if (!Number.isFinite(min) || !(binSize > 0) || !Number.isFinite(binSize)) return 0;

	const gridOrigin = () => {
		let origin = Math.floor(min / binSize) * binSize;
		// floor(min / binSize) * binSize can round to just above min for a large min and a
		// binSize that is not a power of two; binData would then drop the first sample.
		if (origin > min) origin -= binSize;
		return origin;
	};

	const dt = samplingStep(vals);
	if (!(dt > 0)) return gridOrigin();
	const g = approxGcd(dt, binSize);
	if (!(g > 0)) return gridOrigin();
	// The sample grid is min + k * dt; g divides dt, so on-grid samples are also on min + k * g.
	let onGrid = 0;
	for (const v of vals) {
		const k = (v - min) / dt;
		if (Math.abs(k - Math.round(k)) <= ON_GRID_TOL) onGrid++;
	}
	if (onGrid < ON_GRID_SHARE * vals.length) return gridOrigin();
	return min - g / 2;
}

// ========== Periodogram Calculation Functions ==========

/**
 * A Lomb-Scargle basis (cos or sin of w(t - tau) over the samples) whose spread about its own
 * mean is at most this fraction of the sample count is constant up to rounding, and its term
 * is left out.
 */
export const LS_DEGENERATE_BASIS = 1e-12;

function calculateLombScarglePower(times, values, frequencies, onProgress) {
	if (
		!times ||
		!values ||
		times.length < 2 ||
		values.length < 2 ||
		times.length !== values.length
	) {
		return new Array(frequencies.length).fill(NaN);
	}

	// validPairs, not a bare isNaN: isNaN(null) is false, so nulls used to reach the fit as
	// zeros. A Split segment (full length, null outside the window) made this periodogram
	// report a spurious long period. See utils/validPairs.js.
	const { tt: t, yy: y } = validPairs(times, values);

	if (t.length === 0) return new Array(frequencies.length).fill(0);
	// No variation, no spectral power (ROB-13): see isFlatSeries.
	if (isFlatSeries(y)) return new Array(frequencies.length).fill(0);

	const yMean = kahanMean(y);

	// Calculate variance using Kahan summation
	const varSum = new KahanSum();
	for (let i = 0; i < y.length; i++) {
		const diff = y[i] - yMean;
		varSum.add(diff * diff);
	}
	const yVariance = varSum.value / (y.length - 1);

	// A flat/degenerate series has zero variance and no spectral power. Bail out
	// before the `power / (2 * yVariance)` divide below, which would otherwise
	// leak Infinity/NaN past the isNaN-only strip in runPeriodogramCalculation
	// and into downstream peak-picking.
	if (!(yVariance > 0)) {
		return new Array(frequencies.length).fill(0);
	}

	const powers = frequencies.map((f, freqIndex) => {
		const omega = 2 * Math.PI * f;

		// tau, the time offset that makes the cosine and sine bases ORTHOGONAL on
		// unevenly sampled data — the whole reason Lomb-Scargle is preferred over a
		// plain periodogram here. Lomb (1976, Ap&SS 39:447) and Scargle (1982, ApJ
		// 263:835) define it as
		//
		//     tan(2 w tau) = sum sin(2 w t) / sum cos(2 w t)
		//
		// Note the sums run over 2w. They were previously taken over w while still
		// being divided by 2w, which yields some other offset that does not
		// orthogonalise the bases. The error was mild on evenly sampled data (~1%)
		// and grew with irregularity (~4% of peak power, and occasionally a shifted
		// peak period, with 30% of samples dropped) — i.e. it was worst on exactly
		// the gappy recordings the method is chosen for.
		const twoOmega = 2 * omega;
		const cosAcc = new KahanSum();
		const sinAcc = new KahanSum();
		for (let i = 0; i < t.length; i++) {
			cosAcc.add(Math.cos(twoOmega * t[i]));
			sinAcc.add(Math.sin(twoOmega * t[i]));
		}
		const tau = Math.atan2(sinAcc.value, cosAcc.value) / twoOmega;

		// Calculate terms using Kahan summation
		const cosTermAcc = new KahanSum();
		const sinTermAcc = new KahanSum();
		for (let i = 0; i < y.length; i++) {
			const yDiff = y[i] - yMean;
			cosTermAcc.add(yDiff * Math.cos(omega * (t[i] - tau)));
			sinTermAcc.add(yDiff * Math.sin(omega * (t[i] - tau)));
		}

		// Calculate denominators using Kahan summation
		const cosDenomAcc = new KahanSum();
		const sinDenomAcc = new KahanSum();
		const cosSumAcc = new KahanSum();
		const sinSumAcc = new KahanSum();
		for (let i = 0; i < t.length; i++) {
			const cosVal = Math.cos(omega * (t[i] - tau));
			const sinVal = Math.sin(omega * (t[i] - tau));
			cosDenomAcc.add(cosVal * cosVal);
			sinDenomAcc.add(sinVal * sinVal);
			cosSumAcc.add(cosVal);
			sinSumAcc.add(sinVal);
		}

		const cosTerm = cosTermAcc.value;
		const sinTerm = sinTermAcc.value;
		// Guard each term on its basis. At a period equal to the sampling interval (or a
		// divisor of it) every sample sits at the same phase, so one basis is zero up to
		// rounding, and its term was (rounding)^2 / (rounding)^2: noise that drew a lone spike
		// in the aliasing demo; the other basis is a constant, whose projection on the
		// mean-removed data is zero up to rounding. A basis that is constant over the samples
		// (its spread about its own mean, sum c^2 - (sum c)^2 / n, at most LS_DEGENERATE_BASIS
		// of n) carries no signal and its term is left out; a zero basis is constant too. The
		// Nyquist case (cos alternating +-1) is not constant and still counts. Mirrored in
		// tools/ancir_runtime.py and tools/ancir_runtime.R.
		const n = t.length;
		const cosDenom = cosDenomAcc.value;
		const sinDenom = sinDenomAcc.value;
		const minSpread = LS_DEGENERATE_BASIS * n;
		const cosVaries = cosDenom - (cosSumAcc.value * cosSumAcc.value) / n > minSpread;
		const sinVaries = sinDenom - (sinSumAcc.value * sinSumAcc.value) / n > minSpread;
		const power =
			(cosVaries && cosDenom > 0 ? (cosTerm * cosTerm) / cosDenom : 0) +
			(sinVaries && sinDenom > 0 ? (sinTerm * sinTerm) / sinDenom : 0);

		if (onProgress && freqIndex % 10 === 0) {
			onProgress(freqIndex, frequencies.length);
		}
		const normalised = power / (2 * yVariance);
		return Number.isFinite(normalised) ? normalised : 0;
	});

	return powers;
}

// Enright (1965, J Theor Biol 8:426) periodogram amplitude A_p for every trial period.
//
// Fold the binned series into a Buys-Ballot table with nb = round(P / binSize) columns
// (rows = successive cycles), take each column's mean M_h, and report the standard deviation
// of the column means about their grand mean, with the number of columns as the divisor:
//
//     A_p = sqrt( (1 / P') * sum_h (M_h - Mbar)^2 ),   Mbar = (1 / P') * sum_h M_h
//
// This is eq. 12.12 of Legendre & Legendre (Numerical Ecology, 2nd English ed., Elsevier
// 1998, section 12.4.1), which they attribute to Enright (1965); the adespatial R package
// (WRperiodogram, by P. Legendre and G. Guenard) uses the same divisor. Enright's paper
// itself was not available to check; the textbook's worked example is pinned in
// periodogram.enright.test.js. A_p is in the units of the data and is never negative.
//
// MISSING VALUES. An empty bin (no sample, NaN in binData output) is missing, never 0: each
// column mean averages only its occupied bins (Legendre & Legendre eq. 12.13: "r is the
// number with data, in column j"), a column with no occupied bin is left out, and P' counts
// the occupied columns. A partial last cycle simply leaves its later columns one row
// shorter. Fewer than two occupied columns, or a fold longer than the binned record, has no
// statistic (NaN, dropped from the spectrum), as in Chi-squared.
//
// It used to return the mean lag-product autocorrelation at every multiple of the fold,
// over the variance, with empty bins as 0. That is not Enright's statistic, it could be
// negative, and over 500 noisy records its peak differed from A_p's in 292 (SPEC-7).
//
// Mirrored in tools/ancir_runtime.py (_enright_pgram) and tools/ancir_runtime.R
// (enright_pgram); the pure-enright-periodogram-* parity fixtures pin all three.
export function enrightAmplitude(data, nBins) {
	if (!Number.isFinite(nBins) || nBins < 1 || nBins > data.length) return NaN;
	const sums = Array.from({ length: nBins }, () => new KahanSum());
	const counts = new Array(nBins).fill(0);
	for (let i = 0; i < data.length; i++) {
		// isNaN-ok: binData output (number, or NaN for an empty bin), never null.
		if (isNaN(data[i])) continue;
		sums[i % nBins].add(data[i]);
		counts[i % nBins]++;
	}
	const means = [];
	for (let h = 0; h < nBins; h++) if (counts[h] > 0) means.push(sums[h].value / counts[h]);
	if (means.length < 2) return NaN;
	const grand = kahanMean(means);
	const ss = new KahanSum();
	for (const m of means) ss.add((m - grand) * (m - grand));
	return Math.sqrt(ss.value / means.length);
}

function calculateEnrightPower(times, values, periods, binSize, onProgress) {
	if (!times || !values || times.length < 2 || values.length < 2) {
		return new Array(periods.length).fill(NaN);
	}

	// validPairs first, as the Chi-squared path does: binData's isFinite(null) is
	// true, so a raw null y was averaged into its bin as a zero instead of leaving
	// the bin empty. See utils/validPairs.js.
	const { tt, yy } = validPairs(times, values);
	// Flat data has no rhythm (ROB-13): A_p is 0 at every fold that has a statistic, not
	// the spread of rounding residues.
	const flat = isFlatSeries(yy);
	const binnedData = binData(tt, yy, binSize, binOrigin(tt, binSize));
	if (binnedData.bins.length === 0) {
		return new Array(periods.length).fill(NaN);
	}
	const data = binnedData.y_out;

	return periods.map((period, periodIndex) => {
		if (onProgress && periodIndex % 10 === 0) onProgress(periodIndex, periods.length);
		const ap = enrightAmplitude(data, Math.round(period / binSize));
		if (!Number.isFinite(ap)) return NaN;
		return flat ? 0 : ap;
	});
}

// Sokolove & Bushell (1978, J Theor Biol 72:131) Qp for one trial period, on
// already-binned data. Uniform-occupancy form: Qp = K·N·Σ_h(M_h − M̄)² / Σ_i(x_i − M̄)²
// with P columns of K rows each and N = P·K observations; under the no-rhythm null
// Qp ~ χ²(P − 1), so E[Qp] ≈ df.
//
// This generalises that to OCCUPANCY-WEIGHTED sums so that EMPTY bins (NaN in
// binData output — a binSize smaller than the sampling interval leaves most bins
// empty) carry no weight anywhere:
//
//     Qp = N_eff · Σ_h K_h·(M_h − M̄)² / Σ_i(x_i − M̄)²
//
// where the sums run over NON-EMPTY columns/bins only, K_h is the number of
// non-empty bins folded into column h, and N_eff = Σ K_h. Each column mean M_h has
// null variance σ²/K_h, so Σ K_h(M_h − M̄)² ≈ σ²·χ²(P_eff − 1) while the denominator
// ≈ N_eff·σ², giving E[Qp] ≈ P_eff − 1 at ANY binSize. The old form multiplied the
// unweighted column sum of squares by data.length·rowNum, which count empty bins:
// with 0.25 h bins on hourly data that inflated noise Qp ~2.5-10x above the
// chi-square null (and df counted the ~72 permanently-empty columns), so noise
// crossed even the corrected threshold. With no empty bins and uniform occupancy
// this reduces exactly to the Sokolove-Bushell form above.
//
// Returns { power, df } with df = P_eff − 1, the SAME df the caller must use for
// the threshold quantile and the p-value — statistic, df, threshold and p only
// calibrate together. Mirrored in tools/ancir_runtime.py and tools/ancir_runtime.R;
// the pure-chisq-periodogram fixtures pin power, df and threshold across all three.
function calculateChiSquaredPower(data, binSize, period, avgAll, denominator, flat = false) {
	const colNum = Math.round(period / binSize);
	// A zero/non-finite binSize makes colNum Infinity/NaN, and a tiny binSize makes
	// it huge-but-finite; either would blow up the `Array.from({length: colNum})`
	// allocation below (RangeError: Invalid array length). Bins-per-period can't
	// meaningfully exceed the sample count, so cap at data.length.
	if (!Number.isFinite(colNum) || colNum < 1 || colNum > data.length) {
		return { power: NaN, df: NaN };
	}

	// Use Kahan summation for column sums
	const colSums = Array.from({ length: colNum }, () => new KahanSum());
	const colCounts = new Array(colNum).fill(0);

	for (let i = 0; i < data.length; i++) {
		const col = i % colNum;
		// isNaN-ok: binData output (number, or NaN for an empty bin) — never null.
		if (!isNaN(data[i])) {
			colSums[col].add(data[i]);
			colCounts[col]++;
		}
	}

	// Occupancy-weighted between-column sum of squares over non-empty columns only.
	const numAcc = new KahanSum();
	let nonEmptyCols = 0;
	let nonEmptyBins = 0;
	for (let i = 0; i < colNum; i++) {
		if (colCounts[i] === 0) continue;
		nonEmptyCols++;
		nonEmptyBins += colCounts[i];
		const diff = colSums[i].value / colCounts[i] - avgAll;
		numAcc.add(colCounts[i] * diff * diff);
	}

	const df = nonEmptyCols - 1;
	// Fewer than two occupied columns leaves nothing to compare: no statistic.
	if (df < 1) return { power: NaN, df: NaN };

	// Flat data (isFlatSeries): no between-column variation at all. Qp is 0, with the fold's
	// real df, so the p-value is 1 and the threshold is still drawn (ROB-13). Computing it
	// would divide one rounding residue by another and report Qp = N.
	if (flat) return { power: 0, df };

	const result = (numAcc.value * nonEmptyBins) / denominator;
	return { power: isFinite(result) ? result : NaN, df };
}

// ========== Fold Grid (binned methods) ==========

// The binned methods (Chi-squared and Enright) fold the binned series at a whole
// number of bins, nBins = round(P / binSize), so they depend on the trial period
// ONLY through nBins: every trial period inside one bin width is the same test.
// Returning each trial period as its own point gave runs of identical power, and
// argmax picked the FIRST of the tie. A noise-free 24.0 h cosine at 1 h bins was
// reported as 23.5 h (a -binSize/2 bias), and the Sidak correction counted every
// duplicate as an extra comparison, so the threshold was too conservative.
//
// This maps the requested grid to its DISTINCT folds and labels each with the
// period it actually tests, nBins * binSize. The step still decides which folds
// are sampled (a step coarser than binSize skips folds, a finer one just repeats
// them), and a fold whose period rounds outside [periodMin, periodMax] is
// dropped, so every returned point lies inside the requested range. Mirrored in
// tools/ancir_runtime.py (_fold_grid) and tools/ancir_runtime.R (fold_grid).
export function foldGrid(periods, binSize, periodMin, periodMax) {
	const nBins = [];
	const foldPeriods = [];
	if (!(binSize > 0) || !Number.isFinite(binSize)) return { nBins, periods: foldPeriods };
	// Relative slack so a fold landing exactly on a range end is not lost to rounding.
	const eps = 1e-9 * Math.max(1, Math.abs(periodMin), Math.abs(periodMax));
	for (const period of periods) {
		const n = Math.round(period / binSize);
		if (!Number.isFinite(n) || n < 1) continue;
		// The grid ascends, so trial periods sharing a fold are adjacent.
		if (nBins.length && nBins[nBins.length - 1] === n) continue;
		const foldPeriod = n * binSize;
		if (foldPeriod < periodMin - eps || foldPeriod > periodMax + eps) continue;
		nBins.push(n);
		foldPeriods.push(foldPeriod);
	}
	return { nBins, periods: foldPeriods };
}

// ========== Main Calculation Function ==========

/** Population (n-divisor) variance, Kahan-summed; NaN for an empty array. */
function populationVariance(values) {
	if (!values.length) return NaN;
	const m = kahanMean(values);
	const acc = new KahanSum();
	for (const v of values) acc.add((v - m) * (v - m));
	return acc.value / values.length;
}

export function runPeriodogramCalculation(params, onProgress) {
	let out = { x: [], y: [], threshold: [], pvalue: [], df: [] };
	let binnedData = { bins: [], y_out: [] };
	let lsStats = null;
	let chiFlat = false;

	if (params.method === 'Chi-squared') {
		if (!params.yData) {
			return { x: [], y: [], threshold: [], pvalue: [], df: [] };
		}
		// Strip unusable rows before binning. Two reasons: a NaN last x makes binData's
		// while(true) loop never break (currentStart >= NaN is always false), AND a null y
		// would otherwise be aggregated into its bin as a zero (isNaN(null) is false), pulling
		// the bin mean toward 0. This used to filter on x only.
		const { tt: binX, yy: binY } = validPairs(params.xData, params.yData);
		chiFlat = isFlatSeries(binY);
		binnedData = binData(binX, binY, params.binSize, binOrigin(binX, params.binSize));
		if (binnedData.bins.length === 0) {
			return { x: [], y: [], threshold: [], pvalue: [], df: [] };
		}
	}

	const requested = makeSeqArray(params.periodMin, params.periodMax, params.periodSteps);
	// Lomb-Scargle evaluates every requested period; the binned methods evaluate
	// each distinct fold once, at the period it actually tests (see foldGrid).
	const periods =
		params.method === 'Chi-squared' || params.method === 'Enright'
			? foldGrid(requested, params.binSize, params.periodMin, params.periodMax).periods
			: requested;
	const frequencies = periods.map((p) => 1 / p);

	const power = new Array(periods.length);
	const threshold = new Array(periods.length);
	const pvalue = new Array(periods.length);
	// Effective chi-square df per period (Chi-squared method only; NaN otherwise).
	// Exposed so callers and the parity fixtures can verify that the statistic,
	// threshold and p-value all used the SAME df.
	const dfOut = new Array(periods.length).fill(NaN);

	if (params.method === 'Chi-squared') {
		const data = binnedData.y_out;
		const avgAll = kahanMean(data);

		// Calculate denominator using Kahan summation
		const denomAcc = new KahanSum();
		for (let i = 0; i < data.length; i++) {
			// isNaN-ok: binData output (number, or NaN for an empty bin) — never null.
			if (!isNaN(data[i])) {
				const diff = data[i] - avgAll;
				denomAcc.add(diff * diff);
			}
		}

		for (let p = 0; p < periods.length; p++) {
			// power and df come out of ONE fold: df is the EFFECTIVE bins-per-period
			// (non-empty columns) minus 1, not round(period/binSize) - 1, so that the
			// statistic, the threshold and the p-value all key off the same chi-square
			// null even when binSize is smaller than the sampling interval and most
			// bins are empty. With no empty bins the two df conventions coincide.
			const { power: qp, df } = calculateChiSquaredPower(
				data,
				params.binSize,
				periods[p],
				avgAll,
				denomAcc.value,
				chiFlat
			);
			if (!(df >= 1) || !Number.isFinite(qp)) {
				power[p] = NaN;
				threshold[p] = NaN;
				pvalue[p] = NaN;
				dfOut[p] = NaN;
			} else {
				power[p] = qp;
				dfOut[p] = df;
				// Upper tail computed directly (SPEC-14): 1 - CDF underflows to exactly 0 for a
				// strong rhythm (Qp 470.9 on 23 df gave 0; the tail is 3.9e-85), and that 0 went
				// to the CSV export and to any FDR step downstream.
				pvalue[p] = chisqSf(qp, df);
			}

			if (onProgress && p % 10 === 0) {
				onProgress(p, periods.length);
			}
		}

		// Sidak family size M = the number of DISTINCT folds that produced a
		// statistic. `periods` is already one entry per fold (see foldGrid), so
		// repeated trial periods that share a fold are one test, not several;
		// counting them made the line too high (0-0.2% false positives on white
		// noise at a nominal 5%). Folds with no statistic (df < 1) were not tested.
		const nTests = dfOut.filter((df) => df >= 1).length;
		const correctedAlpha = Math.pow(1 - params.chiSquaredAlpha, 1 / nTests);
		for (let p = 0; p < periods.length; p++) {
			if (!(dfOut[p] >= 1)) continue;
			// Sidak-corrected UPPER-tail quantile: correctedAlpha is the per-fold
			// CONFIDENCE level (1 - alpha)^(1/M), so the quantile is evaluated at
			// correctedAlpha directly. Passing 1 - correctedAlpha (as this once did)
			// lands on the LOWER tail, drawing the line below the noise floor so
			// nearly every period looked significant. Mirrored in
			// tools/ancir_runtime.py and tools/ancir_runtime.R; the
			// pure-chisq-periodogram-threshold parity fixture pins all three.
			threshold[p] = quantile_chisq(correctedAlpha, dfOut[p]);
		}
	} else if (params.method === 'Lomb-Scargle') {
		const powers = calculateLombScarglePower(params.xData, params.yData, frequencies, onProgress);
		// The sample count and the population variance of the sample times, which the peak's
		// family-wise p (Baluev 2008: periodogramPeak.js lombScargleFamilywiseP) needs.
		const { tt } = validPairs(params.xData ?? [], params.yData ?? []);
		lsStats = { nObs: tt.length, timeVar: populationVariance(tt.map(Number)) };
		for (let p = 0; p < periods.length; p++) {
			power[p] = powers[p];
			// Lomb-Scargle/Enright have no analytic significance line here. Emit NaN
			// (not undefined) so `threshold`/`pvalue` stay numeric and index-aligned
			// with `x`/`y` after the NaN strip below; callers reading pvalue[peak]
			// then get NaN instead of undefined.
			threshold[p] = NaN;
			pvalue[p] = NaN;
		}
	} else if (params.method === 'Enright') {
		const powers = calculateEnrightPower(
			params.xData,
			params.yData,
			periods,
			params.binSize,
			onProgress
		);
		for (let p = 0; p < periods.length; p++) {
			power[p] = powers[p];
			threshold[p] = NaN;
			pvalue[p] = NaN;
		}
	}

	// Remove NaN values
	const idxsToRemove = [];
	for (let i = 0; i < power.length; i++) {
		// isNaN-ok: power/periods are computed numbers, never null.
		if (isNaN(power[i]) || isNaN(periods[i])) {
			idxsToRemove.push(i);
		}
	}

	out = {
		x: periods.filter((v, i) => !idxsToRemove.includes(i)),
		y: power.filter((v, i) => !idxsToRemove.includes(i)),
		threshold: threshold.filter((v, i) => !idxsToRemove.includes(i)),
		pvalue: pvalue.filter((v, i) => !idxsToRemove.includes(i)),
		df: dfOut.filter((v, i) => !idxsToRemove.includes(i)),
		...(lsStats ?? {})
	};

	return out;
}
