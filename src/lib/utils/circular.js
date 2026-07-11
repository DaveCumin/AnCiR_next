// @ts-nocheck
// Circular (directional) statistics for phase/angle data.
//
// All angles are in RADIANS. Use `toRadians()` to convert degrees or a
// clock-time-on-a-period (e.g. acrophase hours on a 24 h cycle) first.
//
// References:
//   Fisher, N.I. (1993) Statistical Analysis of Circular Data. CUP.
//   Zar, J.H. (1999) Biostatistical Analysis, 4th ed. Ch. 27.
//   Mardia, K.V. & Jupp, P.E. (2000) Directional Statistics. Wiley.
//   Batschelet, E. (1981) Circular Statistics in Biology.

import { kahanMean } from '$lib/utils/numerics.js';

const TWO_PI = 2 * Math.PI;

/**
 * Convert a value to radians on a circle.
 * @param {number} v
 * @param {'radians'|'degrees'|'hours'} unit
 * @param {number} [period=24] - full-cycle length when unit === 'hours'
 * @returns {number} angle in radians
 */
export function toRadians(v, unit = 'radians', period = 24) {
	if (!Number.isFinite(v)) return NaN;
	if (unit === 'degrees') return (v * Math.PI) / 180;
	if (unit === 'hours') {
		const p = Number.isFinite(period) && period > 0 ? period : 24;
		return (v / p) * TWO_PI;
	}
	return v;
}

/**
 * Convert a raw data column to radians per the chosen unit. Empty / null /
 * whitespace / non-numeric cells become NaN (dropped downstream by
 * cleanAngles) rather than a real 0-rad angle that would bias the mean.
 * @param {any[]} data
 * @param {'radians'|'degrees'|'hours'} [unit='radians']
 * @param {number} [period=24]
 * @returns {number[]}
 */
export function toRadiansColumn(data, unit = 'radians', period = 24) {
	return (data ?? []).map((v) => {
		if (v == null) return NaN;
		if (typeof v === 'string' && v.trim() === '') return NaN;
		const num = Number(v);
		return Number.isFinite(num) ? toRadians(num, unit, period) : NaN;
	});
}

/** Coerce a cell to a number, mapping null/undefined/blank/non-numeric to NaN. */
function cleanNum(v) {
	if (v == null || (typeof v === 'string' && v.trim() === '')) return NaN;
	const n = Number(v);
	return Number.isFinite(n) ? n : NaN;
}

/** Keep only finite entries; convert to Number. */
function cleanAngles(anglesRad) {
	const out = [];
	for (const a of anglesRad ?? []) {
		if (a === null || a === undefined || a === '') continue;
		const v = Number(a);
		if (Number.isFinite(v)) out.push(v);
	}
	return out;
}

/**
 * Mean direction and mean resultant length of a sample of angles.
 * C = mean(cos θ), S = mean(sin θ); R = sqrt(C² + S²) ∈ [0, 1];
 * meanAngle = atan2(S, C), wrapped to [0, 2π).
 *
 * @param {number[]} anglesRad
 * @returns {{ meanAngle: number, R: number, n: number, C: number, S: number }}
 */
export function circularMean(anglesRad) {
	const a = cleanAngles(anglesRad);
	const n = a.length;
	if (n === 0) return { meanAngle: NaN, R: NaN, n: 0, C: NaN, S: NaN };
	// kahanMean over the projected components (compensated summation).
	const C = kahanMean(a.map(Math.cos));
	const S = kahanMean(a.map(Math.sin));
	const R = Math.sqrt(C * C + S * S);
	let meanAngle = Math.atan2(S, C);
	if (meanAngle < 0) meanAngle += TWO_PI;
	return { meanAngle, R, n, C, S };
}

/**
 * Rayleigh test of uniformity (is there a preferred direction?).
 * H0: the angles are uniformly distributed on the circle.
 *
 * z = n · R²  (Rayleigh's z).
 *
 * p-value uses the standard series approximation (Zar 1999, eq. 27.4;
 * Fisher 1993, §4.3.2; as implemented in the R `circular` package):
 *   p = e^{-z} · [ 1 + (2z − z²)/(4n) − (24z − 132z² + 76z³ − 9z⁴)/(288 n²) ]
 * clamped to [0, 1]. Accurate for n ≳ 10; the leading e^{-z} term is the
 * large-sample limit.
 *
 * @param {number[]} anglesRad
 * @returns {{ n: number, R: number, meanAngle: number, z: number, pValue: number }}
 */
export function rayleighTest(anglesRad) {
	const { meanAngle, R, n } = circularMean(anglesRad);
	if (n === 0) return { n: 0, R: NaN, meanAngle: NaN, z: NaN, pValue: NaN };

	const z = n * R * R;

	// Series approximation for the tail probability.
	const inner =
		1 +
		(2 * z - z * z) / (4 * n) -
		(24 * z - 132 * z * z + 76 * z ** 3 - 9 * z ** 4) / (288 * n * n);
	let pValue = Math.exp(-z) * inner;
	if (!Number.isFinite(pValue)) pValue = Math.exp(-z);
	pValue = Math.min(1, Math.max(0, pValue));

	return { n, R, meanAngle, z, pValue };
}

/**
 * Amplitude-weighted mean direction and mean resultant length.
 * C = Σ w·cosθ, S = Σ w·sinθ, W = Σ w; R = |(C,S)| / W ∈ [0,1] for w ≥ 0.
 * Pairs with a non-finite angle OR weight are dropped. Intended for
 * non-negative weights (activity / intensity); W ≤ 0 → NaN.
 * @param {number[]} anglesRad
 * @param {number[]} weights
 * @returns {{ meanAngle:number, R:number, n:number, W:number, C:number, S:number }}
 */
export function weightedCircularMean(anglesRad, weights) {
	let C = 0, S = 0, W = 0, n = 0;
	const len = Math.min(anglesRad?.length ?? 0, weights?.length ?? 0);
	for (let i = 0; i < len; i++) {
		const a = cleanNum(anglesRad[i]);
		const w = cleanNum(weights[i]);
		if (!Number.isFinite(a) || !Number.isFinite(w)) continue;
		C += w * Math.cos(a);
		S += w * Math.sin(a);
		W += w;
		n++;
	}
	if (n === 0 || W <= 0) return { meanAngle: NaN, R: NaN, n, W: n === 0 ? NaN : W, C: NaN, S: NaN };
	const R = Math.sqrt(C * C + S * S) / W;
	let meanAngle = Math.atan2(S, C);
	if (meanAngle < 0) meanAngle += TWO_PI;
	return { meanAngle, R, n, W, C, S };
}

/**
 * Amplitude-weighted Rayleigh test. Uses the Kish effective sample size
 * nEff = (Σw)² / Σw² so the significance reflects the weighting, then the
 * same tail approximation as rayleighTest with nEff in place of n.
 * @param {number[]} anglesRad
 * @param {number[]} weights
 * @returns {{ n:number, nEff:number, R:number, meanAngle:number, z:number, pValue:number, W:number }}
 */
export function weightedRayleigh(anglesRad, weights) {
	const { meanAngle, R, n, W } = weightedCircularMean(anglesRad, weights);
	let sumSq = 0;
	const len = Math.min(anglesRad?.length ?? 0, weights?.length ?? 0);
	for (let i = 0; i < len; i++) {
		const a = cleanNum(anglesRad[i]);
		const w = cleanNum(weights[i]);
		if (!Number.isFinite(a) || !Number.isFinite(w)) continue;
		sumSq += w * w;
	}
	if (n === 0 || !(W > 0) || !(sumSq > 0) || !Number.isFinite(R)) {
		return { n, nEff: NaN, R: NaN, meanAngle: NaN, z: NaN, pValue: NaN, W: Number.isFinite(W) ? W : NaN };
	}
	const nEff = (W * W) / sumSq;
	const z = nEff * R * R;
	const inner =
		1 + (2 * z - z * z) / (4 * nEff) -
		(24 * z - 132 * z * z + 76 * z ** 3 - 9 * z ** 4) / (288 * nEff * nEff);
	let pValue = Math.exp(-z) * inner;
	if (!Number.isFinite(pValue)) pValue = Math.exp(-z);
	pValue = Math.min(1, Math.max(0, pValue));
	return { n, nEff, R, meanAngle, z, pValue, W };
}

/**
 * Vector sum (resultant) of a group of angles.
 * @returns {{ n: number, C: number, S: number, r: number, rBar: number }}
 *   r = |Σ (cosθ, sinθ)|  (resultant LENGTH, not mean); rBar = r / n.
 */
function resultant(anglesRad) {
	const a = cleanAngles(anglesRad);
	const n = a.length;
	let C = 0;
	let S = 0;
	for (const ang of a) {
		C += Math.cos(ang);
		S += Math.sin(ang);
	}
	const r = Math.sqrt(C * C + S * S);
	return { n, C, S, r, rBar: n > 0 ? r / n : NaN };
}

/**
 * Maximum-likelihood estimate of the von Mises concentration κ from a mean
 * resultant length r̄ (Fisher 1993, §4.5.5 / Best & Fisher 1981; the `A1inv`
 * of the R `circular` package). Standard piecewise approximation.
 * @param {number} rBar - mean resultant length ∈ [0, 1)
 * @returns {number} estimated κ ≥ 0
 */
export function kappaFromRbar(rBar) {
	if (!Number.isFinite(rBar) || rBar <= 0) return 0;
	if (rBar >= 1) return Infinity;
	if (rBar < 0.53) return 2 * rBar + rBar ** 3 + (5 * rBar ** 5) / 6;
	if (rBar < 0.85) return -0.4 + 1.39 * rBar + 0.43 / (1 - rBar);
	return 1 / (rBar ** 3 - 4 * rBar ** 2 + 3 * rBar);
}

/**
 * Watson–Williams multi-sample test: do k groups of angles share a common
 * mean direction? (one-way ANOVA analogue for circular data).
 * H0: all groups have the same mean angle.
 *
 * With k groups, N total angles, per-group resultant lengths r_i, and the
 * pooled resultant length r (Zar 1999, §27.7; Mardia & Jupp 2000, §7.4.1;
 * as in R `circular::watson.williams.test`):
 *   Rsum = Σ r_i
 *   r̄w   = Rsum / N            (weighted grand mean resultant length)
 *   κ̂    = A1inv(r̄w)
 *   β    = 1 + 3/(8 κ̂)          (small-κ correction factor)
 *   F    = β · (N − k)(Rsum − r) / [ (k − 1)(N − Rsum) ]
 *   df1 = k − 1,  df2 = N − k,  p = upper-tail F.
 *
 * The F p-value is computed by the caller via an F CDF (@stdlib in JS,
 * scipy in Python); this pure util returns F/df/κ̂/β and lets a `pFromF`
 * callback fill pValue so the util stays dependency-free.
 *
 * @param {number[][]} groupsOfAnglesRad
 * @param {(F:number, df1:number, df2:number) => number} [pFromF] - upper-tail F p
 * @returns {{ k:number, N:number, F:number, df1:number, df2:number,
 *             kappa:number, beta:number, Rsum:number, r:number, pValue:number,
 *             valid:boolean }}
 */
export function watsonWilliams(groupsOfAnglesRad, pFromF) {
	const groups = (groupsOfAnglesRad ?? []).map(resultant).filter((g) => g.n > 0);
	const k = groups.length;
	const invalid = {
		k,
		N: 0,
		F: NaN,
		df1: NaN,
		df2: NaN,
		kappa: NaN,
		beta: NaN,
		Rsum: NaN,
		r: NaN,
		pValue: NaN,
		valid: false
	};
	if (k < 2) return invalid;

	const N = groups.reduce((s, g) => s + g.n, 0);
	if (N <= k) return { ...invalid, N }; // need at least one df within

	const Rsum = groups.reduce((s, g) => s + g.r, 0);
	// Pooled resultant length from the summed components.
	let Cp = 0;
	let Sp = 0;
	for (const g of groups) {
		Cp += g.C;
		Sp += g.S;
	}
	const r = Math.sqrt(Cp * Cp + Sp * Sp);

	const rBarW = Rsum / N;
	const kappa = kappaFromRbar(rBarW);
	const beta = 1 + 3 / (8 * kappa);

	const denom = (k - 1) * (N - Rsum);
	let F;
	if (denom === 0) {
		F = Rsum - r === 0 ? 0 : Number.POSITIVE_INFINITY;
	} else {
		F = (beta * (N - k) * (Rsum - r)) / denom;
	}

	const df1 = k - 1;
	const df2 = N - k;
	let pValue = NaN;
	if (typeof pFromF === 'function' && Number.isFinite(F)) {
		pValue = pFromF(F, df1, df2);
	} else if (F === Number.POSITIVE_INFINITY) {
		pValue = 0;
	}

	return { k, N, F, df1, df2, kappa, beta, Rsum, r, pValue, valid: true };
}
