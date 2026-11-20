// Nonparametric Circadian Rhythm Analysis (NPCRA).
//
// Interdaily Stability (IS), Intradaily Variability (IV), Relative Amplitude
// (RA), and the M10 / L5 activity windows + their onsets, computed on activity
// resampled into equal epochs and folded onto an average 24 h profile.
//
// Reference: Van Someren EJW, Swaab DF, Colenda CC, Cohen W, McCall WV,
// Rosenquist PB (1999). Bright Light Therapy: Improved Sensitivity to Its
// Effects on Rest-Activity Rhythms in Alzheimer Patients by Application of
// Nonparametric Methods. Chronobiology International, 16(4), 505-518,
// formulas p.509. IS/IV originate in Witting et al. (1990).
//
// Pure, and dependent only on the house missing-value rule (isInvalidValue) — O(n), safe
// to run synchronously (no worker).
import { isInvalidValue } from './stats.js';
import { samplingStep } from './samplingInterval.js';

// An epoch counts as finer than the sampling only when it is more than this share shorter
// than the sampling step, so times stored to a few decimals (1-min data as 0.0167 h) with an
// epoch equal to the step stay on the ordinary path.
const FINER_TOLERANCE = 0.01;

/**
 * Whether the epoch is shorter than the record's sampling step: most epochs then hold no
 * sample, and the statistics can be no finer than the data (see EPOCH FINER THAN THE
 * SAMPLING on computeNPCRA).
 *
 * @param {number} epochHours
 * @param {number} samplingInterval  the record's sampling step (h); NaN when unknown
 * @returns {boolean}
 */
export function epochFinerThanSampling(epochHours, samplingInterval) {
	return samplingInterval > 0 && epochHours < samplingInterval * (1 - FINER_TOLERANCE);
}

/**
 * @param {number[]} t  time in hours (any origin; only differences matter)
 * @param {number[]} y  activity/value samples aligned to t
 * @param {object} [opts]
 * @param {number} [opts.epochHours=1]  resample bin length (h); p = period/epoch
 * @param {number} [opts.period=24]     folding period (h)
 * @param {number} [opts.mWindow=10]    M-window length (h) for M10
 * @param {number} [opts.lWindow=5]     L-window length (h) for L5
 * @param {boolean} [opts.fullDays=false] keep only whole periods of epochs from the first
 *   sample, as nparACT's fulldays = TRUE (see FULL DAYS below)
 * @returns {{IS:number,IV:number,RA:number,M10:number,L5:number,M10onset:number,
 *   L5onset:number,profile:number[],binCentres:number[],n:number,p:number,
 *   nEpochs:number,missingEpochFraction:number,t0:number,fullDaysKept:number|null,
 *   droppedEpochs:number,samplingInterval:number,pValid:number}|null}  null when there is no
 *   usable data. `missingEpochFraction` is (nEpochs - n) / nEpochs, the empty epochs (with an
 *   epoch finer than the sampling: the share of the epochs the sampling could fill that are
 *   empty). `nEpochs` counts the epochs used (after the full-days cut); `fullDaysKept` is the
 *   number of whole periods kept (null with fullDays off) and `droppedEpochs` the epochs the
 *   cut left out. `samplingInterval` is the record's sampling step (h, NaN when unknown) and
 *   `pValid` the number of profile bins that hold data.
 *
 * EMPTY EPOCHS. An epoch with no sample is missing, and a missing epoch takes no part in any
 * count, mean or variance. IS = n·Σ_h(x̄_h − X̄)² / (p·Σ_i(x_i − X̄)²) (Van Someren et al.
 * 1999, p.509) is the variance of the p hourly means over the variance of the n epochs, so
 * its p is the number of profile bins that HAVE a mean (`pValid`); the published formula
 * assumes every bin of the day is observed, where the two are the same number.
 *
 * EPOCH FINER THAN THE SAMPLING. With an epoch shorter than the sampling step (0.25 h epochs
 * on hourly data) only every few epochs can hold a sample. The statistics are then those of
 * the samples themselves, so a regular record gives the same IS and IV as an epoch equal to
 * its sampling step:
 *  - IV's successive differences (Witting et al. 1990) are taken between consecutive
 *    populated epochs that no sample was skipped between (their mean sample times at most
 *    1.5 sampling steps apart). A longer gap is missing data and breaks the pair, exactly as
 *    an empty epoch does at an ordinary epoch length.
 *  - The last sample stands for one sampling step, so the epoch grid runs to the end of it
 *    (else Full days would lose the last day to a grid one sampling step short).
 *  - An onset is the first populated bin of its window (the window may start on empty bins).
 *
 * FULL DAYS. nparACT (Blume, Santhi & Schabus 2016, MethodsX 3:430-435,
 * doi:10.1016/j.mex.2016.05.006) defaults to fulldays = TRUE and cuts the record to whole
 * days from the first sample before computing IS, IV, RA and L5/M10 (nparACT_base.R, CRAN
 * 0.9.1: `data <- data[1:(e*bin_hr*24*full_days),]`). Van Someren et al. (1999) do not say
 * what to do with a partial day. With `fullDays` the epoch grid is cut to floor(nEpochs / p)
 * whole periods, so every statistic rests on the same whole days. A record shorter than
 * one period has no whole day to keep and is used whole (`fullDaysKept` 0).
 *
 * PHASE FRAME: M10onset, L5onset and binCentres are hours after `t0`, the earliest
 * valid time (the first sample), folded into [0, period). They are NOT clock time:
 * a record starting at 07:00 whose most active hours start at 08:00 has M10onset
 * 1. Callers that want clock time or a common origin across windows add `t0` (and
 * the origin's clock hour) and re-wrap: see utils/phaseReference.js.
 */
export function computeNPCRA(t, y, opts = {}) {
	const epochHours = opts.epochHours ?? 1;
	const period = opts.period ?? 24;
	const mWindow = opts.mWindow ?? 10;
	const lWindow = opts.lWindow ?? 5;
	const fullDays = opts.fullDays === true;
	if (!(epochHours > 0) || !(period > 0)) return null;

	// 1. Pair, keep finite times, sort ascending by time.
	const pairs = [];
	const len = Math.min(t?.length ?? 0, y?.length ?? 0);
	for (let i = 0; i < len; i++) {
		// A missing time is dropped, not read as hour 0: Number(null) and Number('') are 0,
		// which pulled t0 back to 0 and averaged the row into the first epoch.
		if (isInvalidValue(t[i])) continue;
		const ti = Number(t[i]);
		// A missing VALUE stays missing (NaN, skipped when binning) but its time is kept, so
		// the epoch grid and the onset origin do not move. Number(y[i]) alone read null, ''
		// and ' ' as 0: a null-padded Split segment scored IS 0.195 instead of 1.000.
		if (Number.isFinite(ti)) pairs.push([ti, isInvalidValue(y[i]) ? NaN : Number(y[i])]);
	}
	if (!pairs.length) return null;
	pairs.sort((a, b) => a[0] - b[0]);
	const t0 = pairs[0][0];
	const tEnd = pairs[pairs.length - 1][0];

	// 2. Resample into equal epochs (epoch value = mean of samples in the bin;
	//    an empty bin is missing → NaN).
	const e = epochHours;
	const samplingInterval = samplingStep(pairs.map((pr) => pr[0]));
	const finer = epochFinerThanSampling(e, samplingInterval);
	const nGrid = Math.max(
		1,
		finer ? Math.ceil((tEnd - t0 + samplingInterval) / e - 1e-9) : Math.ceil((tEnd - t0) / e + 1e-9)
	);
	// A non-time X axis with a very large value range yields a huge span/epoch ratio
	// (epochHours>0 is already guaranteed above), so nEpochs can be enormous and
	// `new Float64Array(nEpochs)` throws / OOMs. Cap at a sane window count; beyond
	// this the input isn't a real time series.
	if (!Number.isFinite(nGrid) || nGrid > 1e7) return null;
	const sum = new Float64Array(nGrid);
	const cnt = new Float64Array(nGrid);
	// Sum of the sample times in each epoch (hours after t0), for the epoch's mean time.
	const tSum = new Float64Array(nGrid);
	for (const [ti, yi] of pairs) {
		if (!Number.isFinite(yi)) continue;
		// Snap to the epoch grid before flooring: a non-integer epoch (1/24 for a
		// day-unit axis) makes (ti - t0) / e land at 11.999999… for an exact bin edge.
		let k = Math.floor((ti - t0) / e + 1e-9);
		if (k < 0) k = 0;
		else if (k >= nGrid) k = nGrid - 1;
		sum[k] += yi;
		cnt[k] += 1;
		tSum[k] += ti - t0;
	}
	// Epochs per period (the folded profile's bins).
	const p = Math.max(1, Math.round(period / e));
	// Full days: keep whole periods from the first sample (see FULL DAYS above).
	const fullDaysKept = fullDays ? Math.floor(nGrid / p) : null;
	const nEpochs = fullDaysKept >= 1 ? fullDaysKept * p : nGrid;
	const droppedEpochs = nGrid - nEpochs;
	const x = new Array(nEpochs);
	for (let k = 0; k < nEpochs; k++) x[k] = cnt[k] > 0 ? sum[k] / cnt[k] : NaN;

	// 3. Grand mean + overall sum-of-squares over the valid epochs.
	let n = 0;
	let mean = 0;
	for (let k = 0; k < nEpochs; k++) if (Number.isFinite(x[k])) ((mean += x[k]), n++);
	if (n === 0) return null;
	mean /= n;
	const Xbar = mean;
	let overallSS = 0;
	for (let k = 0; k < nEpochs; k++) if (Number.isFinite(x[k])) overallSS += (x[k] - Xbar) ** 2;

	// 4. Average 24 h profile: fold epochs onto p bins-of-day.
	const pSum = new Float64Array(p);
	const pCnt = new Float64Array(p);
	for (let k = 0; k < nEpochs; k++) {
		if (!Number.isFinite(x[k])) continue;
		// Epoch k sits at bin k mod p of the folded profile; computing it through
		// (k*e) % period / e reintroduces floating-point error for non-integer e.
		const h = ((k % p) + p) % p;
		pSum[h] += x[k];
		pCnt[h] += 1;
	}
	const profile = new Array(p);
	for (let h = 0; h < p; h++) profile[h] = pCnt[h] > 0 ? pSum[h] / pCnt[h] : NaN;

	// 5. IS = n·Σ_h(profile−X̄)²  /  (pValid·Σ_i(x−X̄)²), over the profile bins that hold data
	//    (see EMPTY EPOCHS above). Dividing by all p bins read 0.25 h epochs on hourly data
	//    as IS 0.25 instead of 0.99: three bins in four were never observed.
	let profSS = 0;
	let pValid = 0;
	for (let h = 0; h < p; h++) {
		if (!Number.isFinite(profile[h])) continue;
		profSS += (profile[h] - Xbar) ** 2;
		pValid++;
	}
	const IS = overallSS > 0 ? (n * profSS) / (pValid * overallSS) : NaN;

	// 6. IV = [Σ(xᵢ−xᵢ₋₁)² / nPairs]  /  [Σ_i(x−X̄)² / n], over the successive pairs whose two
	//    epochs are both present. The mean squared successive difference over the variance
	//    (Witting et al. 1990; Van Someren et al. 1999, p.509); with no gaps nPairs = n − 1 and
	//    this is the textbook n·Σ(xᵢ−xᵢ₋₁)² / ((n−1)·Σ(x−X̄)²). Dividing by n − 1 regardless
	//    (FIT-8) biased IV low in proportion to the missing epochs. A pair is two adjacent
	//    epochs; with an epoch finer than the sampling, also two populated epochs no sample
	//    was skipped between (see EPOCH FINER THAN THE SAMPLING above), without which there
	//    is no pair at all and IV is blank.
	let diffSS = 0;
	let nPairs = 0;
	let prev = -1;
	for (let k = 0; k < nEpochs; k++) {
		if (!Number.isFinite(x[k])) continue;
		if (
			prev >= 0 &&
			(k - prev === 1 ||
				(finer && tSum[k] / cnt[k] - tSum[prev] / cnt[prev] <= 1.5 * samplingInterval))
		) {
			diffSS += (x[k] - x[prev]) ** 2;
			nPairs++;
		}
		prev = k;
	}
	const IV = overallSS > 0 && nPairs > 0 ? diffSS / nPairs / (overallSS / n) : NaN;
	// Share of the epoch grid with no valid sample; the node warns above 10%. With an epoch
	// finer than the sampling only one epoch in samplingInterval / e can hold a sample, so
	// the share is of those.
	const fillable = finer ? Math.min(nEpochs, (nEpochs * e) / samplingInterval) : nEpochs;
	const missingEpochFraction = Math.max(0, (fillable - n) / fillable);

	// 7. M10 / L5 as circular rolling-window means over the daily profile.
	const roll = (widthHours, better) => {
		const w = Math.min(p, Math.max(1, Math.round(widthHours / e)));
		let bestVal = null;
		let bestStart = 0;
		for (let s = 0; s < p; s++) {
			let ws = 0;
			let wc = 0;
			for (let j = 0; j < w; j++) {
				const v = profile[(s + j) % p];
				if (Number.isFinite(v)) ((ws += v), wc++);
			}
			if (wc === 0) continue;
			const m = ws / wc;
			if (bestVal === null || better(m, bestVal)) {
				bestVal = m;
				bestStart = s;
			}
		}
		// The onset is the window's first bin that holds data: with an epoch finer than the
		// sampling the first window to reach the best mean starts on empty bins, which read
		// an 08:00 onset as 07:15.
		let first = bestStart;
		if (bestVal !== null) {
			for (let j = 0; j < w; j++) {
				if (Number.isFinite(profile[(bestStart + j) % p])) {
					first = (bestStart + j) % p;
					break;
				}
			}
		}
		return { value: bestVal, onset: first * e };
	};
	const M = roll(mWindow, (m, b) => m > b);
	const L = roll(lWindow, (m, b) => m < b);
	const M10 = M.value ?? NaN;
	const L5 = L.value ?? NaN;
	const denom = M10 + L5;
	const RA = Number.isFinite(M10) && Number.isFinite(L5) && denom !== 0 ? (M10 - L5) / denom : NaN;

	const binCentres = Array.from({ length: p }, (_, h) => h * e + e / 2);
	return {
		IS,
		IV,
		RA,
		M10,
		L5,
		M10onset: M.onset,
		L5onset: L.onset,
		profile,
		binCentres,
		n,
		p,
		nEpochs,
		missingEpochFraction,
		t0,
		fullDaysKept,
		droppedEpochs,
		samplingInterval,
		pValid
	};
}

// Warn when more than this share of the epoch grid is empty (FIT-8).
export const NPCRA_MAX_MISSING_EPOCHS = 0.1;

/**
 * The FIT-8 missing-epoch warning for one series, or null when at most
 * NPCRA_MAX_MISSING_EPOCHS of its epochs are empty. Many empty epochs thin the record IS
 * and IV rest on (IV is divided by the valid successive pairs, so it is not biased, but it
 * is noisier). One text for every node that reports IS / IV (NonparametricRA, CFI).
 *
 * @param {string} name                    the series' column name
 * @param {number} missingEpochFraction    computeNPCRA's (nEpochs - n) / nEpochs
 * @param {number} epochHours              the epoch length (h)
 * @param {number} [samplingInterval]      computeNPCRA's samplingInterval (h)
 * @returns {string|null}
 */
export function missingEpochWarning(name, missingEpochFraction, epochHours, samplingInterval) {
	if (!(missingEpochFraction > NPCRA_MAX_MISSING_EPOCHS)) return null;
	if (epochFinerThanSampling(epochHours, samplingInterval)) {
		return `"${name}": about ${Math.round(missingEpochFraction * 100)}% of the samples expected at the ${formatHours(samplingInterval)} h sampling interval are missing. IS and IV use only the samples (and, for IV, the successive pairs) that are present, so they rest on less of the recording than its length suggests.`;
	}
	return `"${name}": ${Math.round(missingEpochFraction * 100)}% of the ${epochHours} h epochs have no data. IS and IV use only the epochs (and, for IV, the successive pairs) that are present, so they rest on less of the recording than its length suggests.`;
}

const formatHours = (h) => String(Number(h.toPrecision(3)));

/**
 * The notice for an epoch shorter than the record's sampling step, or null when it is not.
 * Most epochs are then empty: the statistics are computed from the epochs that hold data and
 * are the same as with an epoch equal to the sampling step, and the profile has a value only
 * in the bins a sample falls in. One text for every node that takes an NPCRA epoch
 * (NonparametricRA, CFI, Moving Analysis).
 *
 * @param {number} epochHours        the epoch length (h)
 * @param {number} samplingInterval  the record's sampling step (h)
 * @returns {string|null}
 */
export function epochFinerWarning(epochHours, samplingInterval) {
	if (!epochFinerThanSampling(epochHours, samplingInterval)) return null;
	const dt = formatHours(samplingInterval);
	return `The ${epochHours} h epoch is shorter than the data's sampling interval (about ${dt} h), so most epochs are empty. The results are no finer than the data: they are the same as with a ${dt} h epoch.`;
}
