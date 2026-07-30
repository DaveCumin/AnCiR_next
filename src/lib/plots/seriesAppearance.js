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
import { seriesColumnId } from '$lib/plots/seriesColour.js';
import {
	DASH_ORDER,
	mappedColour,
	mappedShape,
	mappedDash,
	pinAppearance,
	releaseAppearance
} from '$lib/plots/appearanceIdentity.js';

/**
 * Re-exported, not redefined. Two copies of this list existed and had drifted from the
 * dash values the Line control actually offers; one vocabulary, owned by Line.svelte.
 */
export { DASH_ORDER };

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
	for (const key of enumerableKeys(datum)) {
		let value;
		try {
			value = datum[key];
		} catch {
			continue; // a getter that throws is not a style object
		}
		if (value && typeof value === 'object' && !Array.isArray(value) && 'colour' in value) {
			out.push(value);
		}
	}
	return out;
}

/**
 * Property names to look at on a series — own keys PLUS inherited getters.
 *
 * `Object.values(datum)` was the obvious way to do this and was wrong, which is why
 * monochrome and vary-markers silently stopped working. Svelte 5 compiles a `$state`
 * class field into a private field with a getter/setter pair ON THE PROTOTYPE, so a
 * series' `points` and `line` are not own enumerable properties of the instance:
 * `Object.keys(datum)` on a real ScatterDataclass returns []. Every plot series in the
 * app is such a class, so the structural search found nothing at all and
 * applyFigureAppearance reported zero changes on every figure.
 *
 * It passed the suite because the fixtures are plain object literals, where
 * Object.values works perfectly. That is the gap worth remembering: a fixture that
 * models a Svelte class as a plain object cannot see this class of bug.
 */
function enumerableKeys(obj) {
	const keys = new Set(Object.keys(obj));
	for (let proto = Object.getPrototypeOf(obj); proto && proto !== Object.prototype; ) {
		for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
			if (key !== 'constructor' && typeof desc.get === 'function') keys.add(key);
		}
		proto = Object.getPrototypeOf(proto);
	}
	return keys;
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
	releaseAppearance(columnId);
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
		// The identity map is the single source of truth for what a column looks like.
		// These read the MERGED record (core.seriesAppearance), not the three v72.1 maps —
		// reading the old ones meant turning monochrome off restored nothing, because the
		// colour identity had already moved and colourForColumn returned null for every
		// column, and it meant vary-markers kept claiming into a second, divergent map.
		const colour = mono ? greyForIndex(i, data.length) : colId == null ? null : mappedColour(colId);
		// Claim into the merged map for a column nothing has pinned yet — "apply to all" can
		// run before the pinning effect has seen a newly wired series. Idempotent, and this is
		// an event handler rather than a render, so writing here is safe.
		if (vary && colId != null) pinAppearance(colId, i);
		const shape = vary && colId != null ? (mappedShape(colId) ?? 'circle') : 'circle';
		const dash = vary && colId != null ? (mappedDash(colId) ?? 'solid') : 'solid';

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

/**
 * What each pinned column resolves to right now, taken BEFORE a palette swap.
 *
 * @returns {Record<string, string>} columnId → hex
 */
export function pinnedColourSnapshot() {
	const out = {};
	for (const colId of Object.keys(core.seriesAppearance ?? {})) {
		const hex = mappedColour(colId);
		if (hex) out[colId] = hex;
	}
	return out;
}

/**
 * Push a palette change through to colours that were resolved ONCE and stored.
 *
 * Most of a series resolves its colour on read now, so it follows the palette with no help.
 * What does not is anything derived from that colour at construction — Box's `fillColour` is
 * the live example. This reaches those.
 *
 * `before` is the discriminator: a stored colour still equal to its column's OLD resolved
 * colour was following the palette and is updated; anything else was deliberately chosen and
 * is left alone. Without that check a palette switch would overwrite hand-picked colours.
 *
 * @param {Record<string, string>} before from pinnedColourSnapshot(), taken pre-change
 * @returns {number} how many values were repainted
 */
export function repaintPinnedSeries(before) {
	if (!before) return 0;
	let n = 0;
	for (const plot of core.plots ?? []) {
		for (const datum of plot?.plot?.data ?? []) {
			const colId = seriesColumnId(datum);
			if (colId == null) continue;
			const was = before[colId];
			const now = was ? mappedColour(colId) : null;
			if (!was || !now || now === was) continue;
			for (const style of appearanceTargets(datum)) {
				if (style.colour === was) {
					style.colour = now;
					n++;
				}
				// Box's fill tracks its stroke, so move them together or a repainted box keeps
				// its old fill.
				if (style.fillColour === was) {
					style.fillColour = now;
					n++;
				}
			}
		}
	}
	return n;
}
