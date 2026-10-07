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
// The SEM is across DAYS (cycles), not samples (FIT-12): the samples one day contributes to a
// bin are repeated measures of that day's level, so pooling them as independent replicates
// (pseudo-replication; Hurlbert 1984, Ecological Monographs 54:187-211) shrank the SEM by about
// the square root of the samples per bin per day. Each day's samples in a bin are averaged
// first; the profile is the mean of those day means and the SEM is their SD / sqrt(days).
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
 * @returns {{binCentres:number[], profile:number[], sem:number[], n:number[],
 *   nSamples:number[], t0:number}}
 *   binCentres: bin-centre phase for each bin (length nBins): hours after `t0`, the
 *                earliest sample with a valid value, folded into [0, period). This is
 *                NOT clock time unless the record starts at midnight; callers relabel
 *                with utils/phaseReference.js (relabelFoldedProfile) for clock time.
 *   profile:    mean over days of each day's mean of finite y in the bin (NaN when empty)
 *   sem:        SD of those day means / sqrt(days) (NaN with fewer than 2 days)
 *   n:          number of days (cycles after t0) contributing to each bin: the SEM's n
 *   nSamples:   count of finite (t,y) pairs contributing to each bin
 *   t0:         the fold origin (NaN when there is no usable pair)
 *   For invalid parameters (period ≤ 0, nBins < 1) every array is empty.
 */
export function averageDailyProfile(t, y, opts = {}) {
	const period = opts.period ?? 24;
	const nBins = Math.trunc(opts.nBins ?? 24);
	if (!(period > 0) || !(nBins >= 1)) {
		return { binCentres: [], profile: [], sem: [], n: [], nSamples: [], t0: NaN };
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
	const nSamples = new Array(nBins).fill(0);
	if (!pairs.length) return { binCentres, profile, sem, n, nSamples, t0: NaN };

	// 2. Fold each sample onto [0, period) and bin it (phase relative to t0), keeping the
	//    day (cycle) it fell on. The day is taken from the same remainder as the bin, so a
	//    sample's day and bin always agree at a floating-point period edge.
	const buckets = Array.from({ length: nBins }, () => new Map());
	for (const [ti, yi] of pairs) {
		const timeOfDay = (((ti - t0) % period) + period) % period;
		const day = Math.round((ti - t0 - timeOfDay) / period);
		let b = Math.floor(timeOfDay / binWidth);
		if (b < 0) b = 0;
		else if (b >= nBins) b = nBins - 1; // guard the floating-point edge at period
		const byDay = buckets[b];
		if (!byDay.has(day)) byDay.set(day, []);
		byDay.get(day).push(yi);
		nSamples[b]++;
	}

	// 3. Per bin: each day's mean (Kahan), then the mean and sample SEM across days.
	for (let b = 0; b < nBins; b++) {
		const dayMeans = [...buckets[b].values()].map((vals) => kahanMean(vals));
		const cnt = dayMeans.length;
		n[b] = cnt;
		if (cnt === 0) continue;
		const m = kahanMean(dayMeans);
		profile[b] = m;
		if (cnt >= 2) {
			let ss = 0;
			for (const v of dayMeans) ss += (v - m) ** 2;
			const variance = ss / (cnt - 1); // unbiased sample variance of the day means
			sem[b] = Math.sqrt(variance) / Math.sqrt(cnt);
		}
	}

	return { binCentres, profile, sem, n, nSamples, t0 };
}
