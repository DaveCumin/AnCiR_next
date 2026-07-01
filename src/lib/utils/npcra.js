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
// Pure and dependency-free — O(n), safe to run synchronously (no worker).

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
 *   nEpochs:number}|null}  null when there is no usable data.
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
		const ti = Number(t[i]);
		if (Number.isFinite(ti)) pairs.push([ti, Number(y[i])]);
	}
	if (!pairs.length) return null;
	pairs.sort((a, b) => a[0] - b[0]);
	const t0 = pairs[0][0];
	const tEnd = pairs[pairs.length - 1][0];

	// 2. Resample into equal epochs (epoch value = mean of samples in the bin;
	//    an empty bin is missing → NaN).
	const e = epochHours;
	const nEpochs = Math.max(1, Math.ceil((tEnd - t0) / e + 1e-9));
	const sum = new Float64Array(nEpochs);
	const cnt = new Float64Array(nEpochs);
	for (const [ti, yi] of pairs) {
		if (!Number.isFinite(yi)) continue;
		let k = Math.floor((ti - t0) / e);
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
	for (let k = 0; k < nEpochs; k++) if (Number.isFinite(x[k])) mean += x[k], n++;
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
		const timeOfDay = ((k * e) % period + period) % period;
		let h = Math.floor(timeOfDay / e) % p;
		if (h < 0) h += p;
		pSum[h] += x[k];
		pCnt[h] += 1;
	}
	const profile = new Array(p);
	for (let h = 0; h < p; h++) profile[h] = pCnt[h] > 0 ? pSum[h] / pCnt[h] : NaN;

	// 5. IS = n·Σ_h(profile−X̄)²  /  (p·Σ_i(x−X̄)²)
	let profSS = 0;
	for (let h = 0; h < p; h++) if (Number.isFinite(profile[h])) profSS += (profile[h] - Xbar) ** 2;
	const IS = overallSS > 0 ? (n * profSS) / (p * overallSS) : NaN;

	// 6. IV = n·Σ(xᵢ−xᵢ₋₁)²  /  ((n−1)·Σ_i(x−X̄)²)   (successive finite pairs only)
	let diffSS = 0;
	for (let k = 1; k < nEpochs; k++) {
		if (Number.isFinite(x[k]) && Number.isFinite(x[k - 1])) diffSS += (x[k] - x[k - 1]) ** 2;
	}
	const IV = overallSS > 0 && n > 1 ? (n * diffSS) / ((n - 1) * overallSS) : NaN;

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
				if (Number.isFinite(v)) ws += v, wc++;
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
		nEpochs
	};
}
