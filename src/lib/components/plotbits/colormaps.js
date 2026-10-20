// Colormaps shared by every plot that maps a value to a colour: the Actogram heatmap, CWT,
// Correlation heatmap and Pairs plot today, and colour by (colour-by plan 2026-10-20,
// sections 3.4 and 3.5). Moved here from plots/Actogram/colormaps.js, which re-exports it.
//
// Each colormap is a list of evenly spaced RGB stops (t = 0 the first, t = 1 the last);
// `colormapRGB` interpolates linearly between the two bracketing stops.
//
// viridis, magma and twilight_shifted are matplotlib's maps, sampled by
// tools/gen_colormap_stops.py into colormapStops.json (65 stops, so the interpolated colour
// stays within 1/255 of matplotlib's at every colour-by bucket centre). Until v82.35 the
// viridis and magma tables here were 9 hand-typed stops that claimed to be matplotlib's
// samples at t = 0, 1/8 ... 1 and were not (viridis at t = 7/8 was (110, 206, 88);
// matplotlib's is (173, 220, 48)). greysCyclic is twilight_shifted's monochrome twin (same
// luminance at every stop). greys and rdbu are this app's own ramps.
//
// Kept dependency-free (no d3-scale-chromatic) and pure, so it is unit-tested and the
// Python export can share the same tables.

import STOP_TABLES from './colormapStops.json';

/** @typedef {[number, number, number]} RGB */

/** @type {Record<string, RGB[]>} */
export const COLORMAPS = {
	viridis: /** @type {RGB[]} */ (STOP_TABLES.stops.viridis),
	magma: /** @type {RGB[]} */ (STOP_TABLES.stops.magma),
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
	// quantities plotted symmetrically about 0, e.g. a correlation in [-1, +1]
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
	],
	// CYCLIC: dark at both ends, light in the middle, first stop = last stop. For hour of
	// day (t = h / 24): midnight dark, noon light, and 23:59 beside 00:00 (decision 1).
	twilight_shifted: /** @type {RGB[]} */ (STOP_TABLES.stops.twilight_shifted),
	// CYCLIC grey with twilight_shifted's luminance: what monochrome swaps a cyclic map to.
	greysCyclic: /** @type {RGB[]} */ (STOP_TABLES.stops.greysCyclic)
};

/**
 * Labels for the colormap <select> of the heatmap plots (Actogram, CWT, Correlation heatmap,
 * Pairs plot). Sequential and diverging maps only: a cyclic map offered for a non-cyclic
 * quantity would draw the two ends of its range alike.
 */
export const COLORMAP_LABELS = {
	viridis: 'Viridis',
	magma: 'Magma',
	greys: 'Greys',
	rdbu: 'Blue–White–Red (diverging)'
};

/** Labels for the cyclic maps (offered for Hour of day only). */
export const CYCLIC_COLORMAP_LABELS = {
	twilight_shifted: 'Twilight (cyclic)',
	greysCyclic: 'Greys (cyclic)'
};

/**
 * What each map is. `cyclic` maps join end to end (first stop = last stop), so a cyclic
 * quantity's 0 and its period look alike; `monochrome` is the map monochrome mode swaps it
 * to (colour-by plan section 3.9).
 * @type {Record<string, {kind: 'sequential' | 'diverging' | 'cyclic', cyclic: boolean, monochrome: string}>}
 */
export const COLORMAP_META = {
	viridis: { kind: 'sequential', cyclic: false, monochrome: 'greys' },
	magma: { kind: 'sequential', cyclic: false, monochrome: 'greys' },
	greys: { kind: 'sequential', cyclic: false, monochrome: 'greys' },
	rdbu: { kind: 'diverging', cyclic: false, monochrome: 'greys' },
	twilight_shifted: { kind: 'cyclic', cyclic: true, monochrome: 'greysCyclic' },
	greysCyclic: { kind: 'cyclic', cyclic: true, monochrome: 'greysCyclic' }
};

export const DEFAULT_COLORMAP = 'viridis';
export const DEFAULT_CYCLIC_COLORMAP = 'twilight_shifted';

/** True for a map whose ends join (unknown names are not cyclic). */
export function isCyclicColormap(name) {
	return COLORMAP_META[name]?.cyclic === true;
}

/** The map monochrome mode draws in place of `name`. */
export function monochromeColormap(name) {
	return COLORMAP_META[name]?.monochrome ?? 'greys';
}

/**
 * The maps a control may offer: the cyclic ones for a cyclic quantity, else the rest.
 * @param {{cyclic?: boolean}} [opts]
 * @returns {Record<string, string>} key → label
 */
export function colormapChoices({ cyclic = false } = {}) {
	return cyclic ? { ...CYCLIC_COLORMAP_LABELS } : { ...COLORMAP_LABELS };
}

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
