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

/**
 * Every object on a series that carries appearance.
 *
 * DISCOVERED, not listed. The first version hardcoded ['points', 'line', 'box'] and
 * silently did nothing for two of the three plot shapes in the app:
 *   - a boxplot series keeps its style in `boxPlot`, not `box`;
 *   - an actogram series has `colour` directly on the datum, with no sub-object.
 * Only the scatterplot's points/line shape matched, which is also the only shape the
 * original test fixture used — so the tests passed while monochrome did nothing on
 * two plot types. Structural detection cannot fall out of step with the plots the
 * way a hand-maintained list did.
 */
function appearanceTargets(datum) {
	if (!datum || typeof datum !== 'object') return [];
	const out = [];
	if ('colour' in datum) out.push(datum);
	for (const value of Object.values(datum)) {
		if (value && typeof value === 'object' && !Array.isArray(value) && 'colour' in value) {
			out.push(value);
		}
	}
	return out;
}

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

/**
 * COLORMAP PLOTS. Four plots draw through a colormap rather than per-series colours:
 * CWT, CorrelationHeatmap, PairsPlot, and Actogram in heatmap mode. They have no
 * `colour` field for the appearance pass to touch, which is why monochrome appeared to
 * do nothing to the wavelet plot in particular.
 *
 * A greyscale map already exists, so monochrome just selects it. Switched on the plot
 * rather than resolved at each of the seven render sites, for the same reason the
 * series colours are: it reaches every consumer at once and needs no render code to
 * learn about the flag.
 *
 * The user's own choice is remembered per plot so turning monochrome off restores it,
 * rather than dumping every heatmap on the default. Kept on core so it survives a save
 * (core is serialised wholesale) — otherwise reloading a monochrome session would lose
 * the colour map it should go back to.
 */
const MONO_COLORMAP = 'greys';

function colormapMemory() {
	return (core.plotColormaps ??= {});
}

/**
 * Point a colormap plot at greys, or back at whatever the user had.
 * @returns {boolean} whether it changed
 */
function applyColormap(plot, mono) {
	const inner = plot?.plot;
	if (!inner || typeof inner.colormap !== 'string') return false;
	const memory = colormapMemory();
	const key = String(plot.id);

	if (mono) {
		if (inner.colormap === MONO_COLORMAP) return false;
		memory[key] = inner.colormap;
		inner.colormap = MONO_COLORMAP;
		return true;
	}
	const restore = memory[key];
	// Nothing remembered means monochrome never changed it, so leave the user's
	// current choice alone rather than forcing a default on them.
	if (typeof restore !== 'string' || inner.colormap !== MONO_COLORMAP) return false;
	inner.colormap = restore;
	delete memory[key];
	return true;
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
	if (!style) return 0;
	const data = plot?.plot?.data;

	const mono = style.monochrome === true;
	const vary = style.varyMarkers === true;
	let n = 0;

	// Colormap plots first: they have no per-series colour, so the loop below never
	// touches them.
	if (applyColormap(plot, mono)) n++;

	if (!Array.isArray(data)) return n;

	data.forEach((datum, i) => {
		const colId = seriesColumnId(datum);
		// Monochrome is per FIGURE, so the grey depends on the series' position in this
		// plot, not on the session-wide slot. Colour identity across plots is a
		// colour-palette property; in greyscale the shape carries identity instead.
		const colour = mono ? greyForIndex(i, data.length) : colId == null ? null : colourForColumn(colId);
		const shape = vary && colId != null ? shapeForColumn(colId, i) : 'circle';
		const dash = vary && colId != null ? dashForColumn(colId, i) : '';

		for (const s of appearanceTargets(datum)) {
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
