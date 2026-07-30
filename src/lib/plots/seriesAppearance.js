// Marker shape, line dash and monochrome: the print-safe half of the figure style.
//
// WHY THIS MATTERS
//
// Journals still print in greyscale and reviewers read printed figures. Colour alone
// carries all the series identity today, so a greyscale print collapses every series
// into the same grey. Shape and dash are the redundant channels that survive it, and
// they are also what makes a figure readable to a colourblind reader.
//
// UNIFORM BY DEFAULT, opt in per figure. Everything stays circles and solid lines
// until `varyMarkers` is on, which was a deliberate decision: turning it on globally
// would visibly change every existing figure for no immediate benefit.
//
// PINS ARE LAZY BUT STICKY. A shape is claimed the first time a figure asks for one,
// then kept in a session-wide map keyed on the column, exactly like colour. Toggling
// varyMarkers off and back on therefore returns the SAME shapes rather than
// reshuffling — without that the toggle would be non-deterministic across sessions,
// and a figure would silently change on reload.
//
// WHY THIS APPLIES IMPERATIVELY
//
// A series resolves its colour and shape once, at construction, into its own $state,
// and every plot's template reads those fields directly (stroke={box.colour},
// shape={points.shape}, …). Making the flags reach existing series through a derived
// path would mean rewriting every read in every plot. Writing into the fields the
// templates already read reaches all of them at once, and is the same mechanism the
// palette switch uses (repaintPinnedSeries).
//
// Design spec: docs/superpowers/specs/2026-07-30-figure-style-system-design.md
import { core } from '$lib/core/core.svelte';
import { POINT_SHAPES } from '$lib/components/plotbits/pointShapes.js';
import { colourForColumn, seriesColumnId } from '$lib/plots/seriesColour.js';

/**
 * Dash patterns, in claim order. The empty string is solid, and is deliberately
 * FIRST so the first series in a figure keeps the appearance it had before markers
 * were varied.
 */
export const DASH_ORDER = ['', '6 3', '2 2', '8 3 2 3', '1 3'];

/** Style sub-objects on a series that carry appearance. */
const STYLE_KEYS = ['points', 'line', 'box'];

function shapeMap() {
	return (core.seriesShapes ??= {});
}
function dashMap() {
	return (core.seriesDashes ??= {});
}

/** Claim (or recall) a marker shape for a column. */
export function shapeForColumn(columnId, fallbackIndex = 0) {
	const key = String(columnId);
	const map = shapeMap();
	if (typeof map[key] === 'string' && POINT_SHAPES.includes(map[key])) return map[key];
	const taken = new Set(Object.values(map));
	let i = ((fallbackIndex % POINT_SHAPES.length) + POINT_SHAPES.length) % POINT_SHAPES.length;
	for (let n = 0; n < POINT_SHAPES.length && taken.has(POINT_SHAPES[i]); n++) {
		i = (i + 1) % POINT_SHAPES.length;
	}
	map[key] = POINT_SHAPES[i];
	return map[key];
}

/** Claim (or recall) a dash pattern for a column. */
export function dashForColumn(columnId, fallbackIndex = 0) {
	const key = String(columnId);
	const map = dashMap();
	if (typeof map[key] === 'string' && DASH_ORDER.includes(map[key])) return map[key];
	const taken = new Set(Object.values(map));
	let i = ((fallbackIndex % DASH_ORDER.length) + DASH_ORDER.length) % DASH_ORDER.length;
	for (let n = 0; n < DASH_ORDER.length && taken.has(DASH_ORDER[i]); n++) {
		i = (i + 1) % DASH_ORDER.length;
	}
	map[key] = DASH_ORDER[i];
	return map[key];
}

/**
 * An evenly spaced grey for series `i` of `n`.
 *
 * Bounded well inside black and white: pure black is indistinguishable from axis ink
 * and pure white is invisible on a white background, so the ramp runs from a dark
 * grey to a mid grey. With one series it returns the dark end rather than dividing by
 * zero.
 */
export function greyForIndex(i, n) {
	const DARK = 0x22;
	const LIGHT = 0xaa;
	const count = Math.max(1, n);
	const t = count === 1 ? 0 : Math.min(1, Math.max(0, i / (count - 1)));
	const v = Math.round(DARK + (LIGHT - DARK) * t);
	const hex = v.toString(16).padStart(2, '0');
	return `#${hex}${hex}${hex}`;
}

/** Forget a column's pinned marker/dash (column deleted). */
export function releaseSeriesAppearance(columnId) {
	if (core.seriesShapes) delete core.seriesShapes[String(columnId)];
	if (core.seriesDashes) delete core.seriesDashes[String(columnId)];
}

/**
 * Bring one figure's series into line with its style flags.
 *
 * Idempotent, and reversible: turning a flag off restores the palette colour (from
 * the column's pinned slot) and the plain circle/solid defaults, so the toggles are
 * genuinely toggles rather than one-way transformations.
 *
 * @param {{style?: Record<string, any>, plot?: {data?: any[]}}} plot a wrapper Plot
 * @returns {number} how many style objects were changed
 */
export function applyFigureAppearance(plot) {
	const style = plot?.style;
	const data = plot?.plot?.data;
	if (!style || !Array.isArray(data)) return 0;

	const mono = style.monochrome === true;
	const vary = style.varyMarkers === true;
	let n = 0;

	data.forEach((datum, i) => {
		const colId = seriesColumnId(datum);
		// Monochrome is per FIGURE, so the grey depends on the series' position in this
		// plot, not on the session-wide slot. Colour identity across plots is a
		// colour-palette property; in greyscale the shape carries identity instead.
		const colour = mono ? greyForIndex(i, data.length) : colId == null ? null : colourForColumn(colId);
		const shape = vary && colId != null ? shapeForColumn(colId, i) : 'circle';
		const dash = vary && colId != null ? dashForColumn(colId, i) : '';

		for (const key of STYLE_KEYS) {
			const s = datum[key];
			if (!s) continue;
			if (colour && s.colour !== colour) {
				s.colour = colour;
				n++;
			}
			if (colour && 'fillColour' in s && s.fillColour !== colour) {
				s.fillColour = colour;
				n++;
			}
			if ('shape' in s && s.shape !== shape) {
				s.shape = shape;
				n++;
			}
			if ('stroke' in s && s.stroke !== dash) {
				s.stroke = dash;
				n++;
			}
		}
	});
	return n;
}

/** Apply to every plot. Used by the Settings template's "Apply to all". */
export function applyAppearanceToAll(plots) {
	let n = 0;
	for (const plot of plots ?? []) n += applyFigureAppearance(plot);
	return n;
}
