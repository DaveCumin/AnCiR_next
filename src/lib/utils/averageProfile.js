// Average daily profile — fold a time series onto a single period and compute
// the mean value (± SEM) in each phase bin.
//
// This is the standard "average day" / "mean waveform" view of a circadian
// record: every sample's time is mapped to its time-of-day within the folding
// period, samples are grouped into `nBins` equal bins over [0, period), and the
// per-bin mean is reported with its standard error. It is the shared fold that
// NonparametricRA (npcra.js ~:78-91) performs internally, extracted here as a
// standalone primitive so it can be exposed as its own node and reused by
// phase/mean±SEM/heatmap features.
//
// Pure and dependency-light (only numerics.kahanMean) — O(n), safe to run
// synchronously.

import { kahanMean } from '$lib/utils/numerics.js';

/**
 * @param {number[]} t  sample times (any origin/units; only differences matter)
 * @param {number[]} y  values aligned to t
 * @param {object} [opts]
 * @param {number} [opts.period=24] folding period (same units as t)
 * @param {number} [opts.nBins=24]  number of phase bins over [0, period)
 * @returns {{binCentres:number[], profile:number[], sem:number[], n:number[]}}
 *   binCentres — bin-centre time-of-day for each bin (length nBins)
 *   profile    — mean of finite y in each bin (NaN for an empty bin)
 *   sem        — standard error of the mean per bin (NaN when fewer than 2 pts)
 *   n          — count of finite (t,y) pairs contributing to each bin
 *   For invalid parameters (period ≤ 0, nBins < 1) every array is empty.
 */
export function averageDailyProfile(t, y, opts = {}) {
	const period = opts.period ?? 24;
	const nBins = Math.trunc(opts.nBins ?? 24);
	if (!(period > 0) || !(nBins >= 1)) {
		return { binCentres: [], profile: [], sem: [], n: [] };
	}

	const binWidth = period / nBins;
	const binCentres = new Array(nBins);
	for (let b = 0; b < nBins; b++) binCentres[b] = b * binWidth + binWidth / 2;

	// 1. Pair, keep samples with finite time AND finite value; find the time
	//    origin t0 (earliest finite time) so the fold is relative to record start.
	const len = Math.min(t?.length ?? 0, y?.length ?? 0);
	let t0 = Infinity;
	const pairs = [];
	for (let i = 0; i < len; i++) {
		// Reject null/undefined/'' explicitly — Number(null) is 0 (a finite value),
		// which would otherwise fold a missing timestamp onto time-of-day 0.
		if (t[i] == null || t[i] === '' || y[i] == null || y[i] === '') continue;
		const ti = Number(t[i]);
		const yi = Number(y[i]);
		if (!Number.isFinite(ti) || !Number.isFinite(yi)) continue;
		pairs.push([ti, yi]);
		if (ti < t0) t0 = ti;
	}

	const profile = new Array(nBins).fill(NaN);
	const sem = new Array(nBins).fill(NaN);
	const n = new Array(nBins).fill(0);
	if (!pairs.length) return { binCentres, profile, sem, n };

	// 2. Fold each sample onto [0, period) and bin it.
	const buckets = Array.from({ length: nBins }, () => []);
	for (const [ti, yi] of pairs) {
		const timeOfDay = (((ti - t0) % period) + period) % period;
		let b = Math.floor(timeOfDay / binWidth);
		if (b < 0) b = 0;
		else if (b >= nBins) b = nBins - 1; // guard the floating-point edge at period
		buckets[b].push(yi);
	}

	// 3. Per-bin mean (Kahan) + sample SEM.
	for (let b = 0; b < nBins; b++) {
		const vals = buckets[b];
		const cnt = vals.length;
		n[b] = cnt;
		if (cnt === 0) continue;
		const m = kahanMean(vals);
		profile[b] = m;
		if (cnt >= 2) {
			let ss = 0;
			for (const v of vals) ss += (v - m) ** 2;
			const variance = ss / (cnt - 1); // unbiased sample variance
			sem[b] = Math.sqrt(variance) / Math.sqrt(cnt);
		}
	}

	return { binCentres, profile, sem, n };
}
