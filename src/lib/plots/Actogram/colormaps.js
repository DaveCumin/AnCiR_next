// Perceptual colormaps for the heatmap actogram render mode.
//
// Each colormap is a list of evenly-spaced RGB anchor stops (t = 0 → first,
// t = 1 → last). `colormapRGB` linearly interpolates between the two bracketing
// stops. Viridis and Magma are the standard matplotlib ramps (perceptually
// uniform, colour-blind friendly); Greys is a light→dark single-hue ramp for a
// classic "denser = darker" actogram look.
//
// Kept dependency-free (no d3-scale-chromatic) and pure so it can be unit-tested
// and reused by any plot that needs an intensity ramp.

/** @typedef {[number, number, number]} RGB */

/** @type {Record<string, RGB[]>} */
export const COLORMAPS = {
	// matplotlib viridis, sampled at t = 0, 1/8 … 1
	viridis: [
		[68, 1, 84],
		[72, 40, 120],
		[62, 74, 137],
		[49, 104, 142],
		[38, 130, 142],
		[31, 158, 137],
		[53, 183, 121],
		[110, 206, 88],
		[253, 231, 37]
	],
	// matplotlib magma, sampled at t = 0, 1/8 … 1
	magma: [
		[0, 0, 4],
		[28, 16, 68],
		[79, 18, 123],
		[129, 37, 129],
		[181, 54, 122],
		[229, 80, 100],
		[251, 135, 97],
		[254, 194, 135],
		[252, 253, 191]
	],
	// light → dark greys (low activity = pale, high = near-black)
	greys: [
		[247, 247, 247],
		[217, 217, 217],
		[189, 189, 189],
		[150, 150, 150],
		[115, 115, 115],
		[82, 82, 82],
		[55, 55, 55],
		[28, 28, 28],
		[0, 0, 0]
	],
	// DIVERGING blue → white → red (a coolwarm ramp). The MIDDLE stop (index 4) is
	// white, so a value mapped to t = 0.5 renders neutral. Intended for signed
	// quantities plotted symmetrically about 0 — e.g. a correlation in [-1, +1]
	// normalised so 0 → 0.5. Sequential maps (viridis/magma) hide the sign of the
	// centre; this one shows negative-blue / positive-red at a glance.
	rdbu: [
		[5, 48, 97],
		[42, 104, 172],
		[110, 160, 205],
		[185, 210, 230],
		[247, 247, 247],
		[244, 197, 173],
		[214, 118, 94],
		[178, 47, 46],
		[103, 0, 31]
	]
};

/** Human-readable labels for the colormap <select>. */
export const COLORMAP_LABELS = {
	viridis: 'Viridis',
	magma: 'Magma',
	greys: 'Greys',
	rdbu: 'Blue–White–Red (diverging)'
};

export const DEFAULT_COLORMAP = 'viridis';

/**
 * Sample a colormap at position `t`.
 * @param {string} name  key into COLORMAPS; unknown names fall back to viridis.
 * @param {number} t     position in [0, 1]; clamped, non-finite → 0.
 * @returns {string} an `rgb(r, g, b)` string.
 */
export function colormapRGB(name, t) {
	const stops = COLORMAPS[name] ?? COLORMAPS[DEFAULT_COLORMAP];
	// Clamp t into [0, 1]; treat NaN/undefined as the low end.
	let u = Number.isFinite(t) ? t : 0;
	if (u < 0) u = 0;
	else if (u > 1) u = 1;

	const last = stops.length - 1;
	const scaled = u * last;
	const i = Math.min(last - 1, Math.floor(scaled));
	const frac = scaled - i;

	const a = stops[i];
	const b = stops[i + 1];
	const r = Math.round(a[0] + (b[0] - a[0]) * frac);
	const g = Math.round(a[1] + (b[1] - a[1]) * frac);
	const bl = Math.round(a[2] + (b[2] - a[2]) * frac);
	return `rgb(${r}, ${g}, ${bl})`;
}

/**
 * Normalise a value to [0, 1] against a [min, max] domain.
 * A degenerate domain (min === max, or non-finite bounds) maps everything to 0
 * so a flat/empty series renders as the colormap's low end rather than NaN.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function normaliseTo01(value, min, max) {
	if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) return 0;
	if (max <= min) return 0;
	const t = (value - min) / (max - min);
	return t < 0 ? 0 : t > 1 ? 1 : t;
}
