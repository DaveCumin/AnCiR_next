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

/**
 * @param {number[]} t  time in hours (any origin; only differences matter)
 * @param {number[]} y  activity/value samples aligned to t
 * @param {object} [opts]
 * @param {number} [opts.epochHours=1]  resample bin length (h); p = period/epoch
 * @param {number} [opts.period=24]     folding period (h)
 * @param {number} [opts.mWindow=10]    M-window length (h) for M10
 * @param {number} [opts.lWindow=5]     L-window length (h) for L5
 * @returns {{IS:number,IV:number,RA:number,M10:number,L5:number,M10onset:number,
 *   L5onset:number,profile:number[],binCentres:number[],n:number,p:number,
 *   nEpochs:number,missingEpochFraction:number,t0:number}|null}  null when there is no
 *   usable data. `missingEpochFraction` is (nEpochs - n) / nEpochs, the empty epochs.
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
	const nEpochs = Math.max(1, Math.ceil((tEnd - t0) / e + 1e-9));
	// A non-time X axis with a very large value range yields a huge span/epoch ratio
	// (epochHours>0 is already guaranteed above), so nEpochs can be enormous and
	// `new Float64Array(nEpochs)` throws / OOMs. Cap at a sane window count; beyond
	// this the input isn't a real time series.
	if (!Number.isFinite(nEpochs) || nEpochs > 1e7) return null;
	const sum = new Float64Array(nEpochs);
	const cnt = new Float64Array(nEpochs);
	for (const [ti, yi] of pairs) {
		if (!Number.isFinite(yi)) continue;
		// Snap to the epoch grid before flooring: a non-integer epoch (1/24 for a
		// day-unit axis) makes (ti - t0) / e land at 11.999999… for an exact bin edge.
		let k = Math.floor((ti - t0) / e + 1e-9);
		if (k < 0) k = 0;
		else if (k >= nEpochs) k = nEpochs - 1;
		sum[k] += yi;
		cnt[k] += 1;
	}
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
	const p = Math.max(1, Math.round(period / e));
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

	// 5. IS = n·Σ_h(profile−X̄)²  /  (p·Σ_i(x−X̄)²)
	let profSS = 0;
	for (let h = 0; h < p; h++) if (Number.isFinite(profile[h])) profSS += (profile[h] - Xbar) ** 2;
	const IS = overallSS > 0 ? (n * profSS) / (p * overallSS) : NaN;

	// 6. IV = [Σ(xᵢ−xᵢ₋₁)² / nPairs]  /  [Σ_i(x−X̄)² / n], over the successive pairs whose two
	//    epochs are both present. The mean squared successive difference over the variance
	//    (Witting et al. 1990; Van Someren et al. 1999, p.509); with no gaps nPairs = n − 1 and
	//    this is the textbook n·Σ(xᵢ−xᵢ₋₁)² / ((n−1)·Σ(x−X̄)²). Dividing by n − 1 regardless
	//    (FIT-8) biased IV low in proportion to the missing epochs.
	let diffSS = 0;
	let nPairs = 0;
	for (let k = 1; k < nEpochs; k++) {
		if (Number.isFinite(x[k]) && Number.isFinite(x[k - 1])) {
			diffSS += (x[k] - x[k - 1]) ** 2;
			nPairs++;
		}
	}
	const IV = overallSS > 0 && nPairs > 0 ? diffSS / nPairs / (overallSS / n) : NaN;
	// Share of the epoch grid with no valid sample; the node warns above 10%.
	const missingEpochFraction = (nEpochs - n) / nEpochs;

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
		return { value: bestVal, onset: bestStart * e };
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
		t0
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
 * @returns {string|null}
 */
export function missingEpochWarning(name, missingEpochFraction, epochHours) {
	if (!(missingEpochFraction > NPCRA_MAX_MISSING_EPOCHS)) return null;
	return `"${name}": ${Math.round(missingEpochFraction * 100)}% of the ${epochHours} h epochs have no data. IS and IV use only the epochs (and, for IV, the successive pairs) that are present, so they rest on less of the recording than its length suggests.`;
}
