// Pure geometry for the boxplot's violin overlay.
//
// A violin is a KDE curve (utils/kde.js, Silverman auto bandwidth) mirrored
// symmetrically about the category centre. These helpers are Svelte-free so the
// numerical behaviour — trimming to the data range, the minimum-n gate, the
// symmetry of the outline — can be unit-tested without a DOM.

import { gaussianKDE } from '$lib/utils/kde.js';

// Below this many points a KDE is a smooth lie: the curve looks authoritative
// while carrying almost no information. No violin is drawn for such a group and
// the controls surface a warning instead (see Boxplotclass.violinWarnings).
export const VIOLIN_MIN_N = 5;

/**
 * Density curve for one group's violin, trimmed to the group's data range.
 *
 * @param {Array<number|null>} values raw group values; null/NaN/±Infinity ignored.
 * @param {{bandwidth?: number|null, gridSize?: number, minN?: number}} [opts]
 *   bandwidth — kernel width; null/0/negative means Silverman auto (matching the
 *   Histogram's convention and gaussianKDE's own fallback).
 * @returns {{points: Array<{v: number, d: number}>, maxDensity: number} | null}
 *   `points` runs from the group min to the group max (both included exactly, by
 *   linear interpolation of the KDE grid). Returns null when the group fails the
 *   minimum-n gate or the KDE is degenerate (all values equal → sigma 0).
 */
export function violinCurve(values, opts = {}) {
	const minN = opts.minN ?? VIOLIN_MIN_N;

	const cleaned = [];
	if (Array.isArray(values)) {
		for (const v of values) {
			if (v == null) continue; // Number(null) === 0 trap
			const num = typeof v === 'number' ? v : Number(v);
			if (Number.isFinite(num)) cleaned.push(num);
		}
	}
	if (cleaned.length < minN) return null;

	const { x, density } = gaussianKDE(cleaned, {
		bandwidth: opts.bandwidth != null && opts.bandwidth > 0 ? opts.bandwidth : null,
		gridSize: opts.gridSize ?? 128
	});
	if (x.length === 0) return null; // degenerate (sigma 0) — kde.js already gates this

	let lo = Infinity;
	let hi = -Infinity;
	for (const v of cleaned) {
		if (v < lo) lo = v;
		if (v > hi) hi = v;
	}

	// Trim: the KDE grid spans [min − 3h, max + 3h]; a violin conventionally stops
	// at the data. Keep interior grid points and interpolate the exact endpoints.
	const points = [{ v: lo, d: interpolateDensity(x, density, lo) }];
	for (let i = 0; i < x.length; i++) {
		if (x[i] > lo && x[i] < hi) points.push({ v: x[i], d: density[i] });
	}
	points.push({ v: hi, d: interpolateDensity(x, density, hi) });

	let maxDensity = 0;
	for (const p of points) {
		if (p.d > maxDensity) maxDensity = p.d;
	}
	if (!(maxDensity > 0)) return null;

	return { points, maxDensity };
}

/** Linear interpolation of a monotone-x KDE grid at position v. */
function interpolateDensity(x, density, v) {
	if (v <= x[0]) return density[0];
	const last = x.length - 1;
	if (v >= x[last]) return density[last];
	for (let i = 1; i <= last; i++) {
		if (x[i] >= v) {
			const t = (v - x[i - 1]) / (x[i] - x[i - 1]);
			return density[i - 1] + t * (density[i] - density[i - 1]);
		}
	}
	return density[last];
}

/**
 * Mirror a violin curve into a closed symmetric outline in pixel space.
 *
 * @param {{points: Array<{v: number, d: number}>, maxDensity: number}} curve
 * @param {{xCenter: number, halfWidthPx: number, yscale: (v: number) => number}} geom
 *   halfWidthPx — pixels the peak density reaches from the centre line.
 * @returns {Array<[number, number]>} polygon vertices: up the right flank from
 *   min to max, then back down the left flank — symmetric about xCenter.
 */
export function violinOutline(curve, { xCenter, halfWidthPx, yscale }) {
	const scale = curve.maxDensity > 0 ? halfWidthPx / curve.maxDensity : 0;
	const right = curve.points.map((p) => [xCenter + p.d * scale, yscale(p.v)]);
	const left = [...curve.points].reverse().map((p) => [xCenter - p.d * scale, yscale(p.v)]);
	return [...right, ...left];
}
