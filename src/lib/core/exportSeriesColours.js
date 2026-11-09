// @ts-check
// The colour the app draws each plot series in, for the Python export (pythonExport.js, which
// imports nothing and so cannot work it out).
//
// A series saves a colour only when someone chose one (LineClass / PointsClass `toJSON`
// write null while the colour is automatic). The automatic colour is resolved at READ time
// from the session's appearance map (plots/appearanceIdentity.js resolveColour: the column's
// pinned palette slot, so the same column is the same colour in every plot), falling back to
// the palette entry at the series' position. matplotlib's own palette by position
// (`C<index>`) therefore drew a different colour whenever a column's pin was not its position
// in this plot, or the user's palette was not matplotlib's. Reading the live getters here
// hands the export exactly the colours on screen.
//
// Colour by in Category mode (colour-by plan v1.1) adds `colourCategories` to a series' entry:
// `{ labels, colours }`, the categories in key order and the colour each is DRAWN in (the
// session's category colours: pinned palette slots or the user's own, greys when monochrome),
// or `{ refused: true }` when there are more categories than palette colours and nothing is
// coloured. The category colours live in core.categoryColours, which the export cannot read,
// so the runtime would otherwise guess them by position.
//
// A Boxplot series has neither a line nor points: its entry is `box: { colour, fill }`, the
// stroke and fill its boxes are drawn in (BoxClass's read-time colour and fill, greys once
// monochrome has been applied). A boxplot coloured per CATEGORY (one series over several
// categories, Boxplotclass.categoryColoured) adds `colourCategories` to its series: every
// category in the Boxplot's order and the colour Box.svelte draws it in (the session's pinned
// category colour, else the slot it would claim; greys by place when monochrome).
import { core } from './core.svelte.js';
import { categoryPalette } from '$lib/plots/seriesColour.js';
import { isInvalidValue } from '$lib/utils/stats.js';
import { isMissingCategory } from '$lib/utils/chisquare.js';

/** The style objects of a series whose resolved colour the export draws with. */
const COLOURED_PARTS = ['line', 'points'];
/**
 * A series' OWN colour field (no style object) on the plots that have one: the Actogram's,
 * CircularPhase's and QQPlot's `colour`, the Histogram's `fillColour`. Saved as null while
 * automatic (plots/autoSeriesColour.js), so the export carries the colour as drawn.
 */
const OWN_COLOUR = {
	actogram: 'colour',
	circularphase: 'colour',
	qqplot: 'colour',
	histogram: 'fillColour'
};

/**
 * A Category-coloured series' categories and drawn colours, `{ refused: true }`, or null.
 * The same categories and colours every renderer and the key read (EncodedSeries).
 * @param {any} datum
 */
export function categoryEntry(datum) {
	try {
		if (!datum?.colourCategorical) return null;
		if (datum.colourRefusal) return { refused: true };
		const labels = datum.colourDomain?.categories;
		const colours = datum.colourPalette;
		if (!Array.isArray(labels) || !Array.isArray(colours)) return null;
		return { labels: [...labels], colours: [...colours] };
	} catch {
		return null;
	}
}

/**
 * A Boxplot series' drawn colours (`{ colour, fill }`), or null when it has none to read.
 * @param {any} datum
 */
function boxEntry(datum) {
	try {
		const box = datum?.boxPlot;
		if (!box) return null;
		const colour = box.colour;
		const fill = box.fillColour;
		if (typeof colour !== 'string' || colour === '') return null;
		return { colour, fill: typeof fill === 'string' && fill !== '' ? fill : colour };
	} catch {
		return null;
	}
}

/**
 * The categories of a per-category coloured Boxplot and the colour each box is drawn in, or
 * null when its boxes take the series' colours. Box.svelte draws a pinned category in its
 * pinned colour; a category not pinned yet takes the slot it is about to claim, in
 * first-appearance order (categoryPalette covers both); monochrome draws greys by place.
 * @param {any} plot a wrapper Plot
 */
export function boxCategoryEntry(plot) {
	try {
		const inner = plot?.plot;
		if (plot?.type !== 'boxplot' || !inner?.categoryColoured) return null;
		const labels = (inner.uniqueXValues ?? []).map(String);
		const mono = plot?.style?.monochrome === true;
		// The order Box.svelte meets them in (and pins them in): rows with a category and a value.
		const firstSeen = [];
		const seen = new Set();
		const ys = inner.data?.[0]?.y?.getData?.() ?? [];
		(inner.data?.[0]?.x?.getData?.() ?? []).forEach((v, i) => {
			if (isMissingCategory(v) || isInvalidValue(ys[i])) return;
			const key = String(v);
			if (seen.has(key)) return;
			seen.add(key);
			firstSeen.push(key);
		});
		// categoryPalette: a pinned label's colour, else the slot it is about to claim.
		return { labels, colours: categoryPalette(labels, firstSeen, mono) };
	} catch {
		return null;
	}
}

/**
 * `{ [plotId]: [{ line?, points?, colour?, fillColour?, box?, colourCategories? }, ...] }`, one entry per series in
 * data order (an empty object for a series with none of them), for every plot whose series
 * have a line, points or boxes.
 * @param {any[]} [plots] the wrapper plots (default: the live session's)
 * @returns {Record<string, Array<Record<string, any>>>}
 */
export function exportSeriesColours(plots = core.plots) {
	/** @type {Record<string, Array<Record<string, any>>>} */
	const out = {};
	for (const plot of plots ?? []) {
		const data = plot?.plot?.data;
		if (plot?.id == null || !Array.isArray(data)) continue;
		let any = false;
		const boxCategories = boxCategoryEntry(plot);
		const rows = data.map((datum, index) => {
			/** @type {Record<string, any>} */
			const entry = {};
			for (const part of COLOURED_PARTS) {
				let colour;
				try {
					colour = datum?.[part]?.colour;
				} catch {
					colour = undefined;
				}
				if (typeof colour === 'string' && colour !== '') {
					entry[part] = colour;
					any = true;
				}
			}
			const own = OWN_COLOUR[plot?.type];
			if (own) {
				let colour;
				try {
					colour = datum?.[own];
				} catch {
					colour = undefined;
				}
				if (typeof colour === 'string' && colour !== '') {
					entry[own] = colour;
					any = true;
				}
			}
			const box = plot?.type === 'boxplot' ? boxEntry(datum) : null;
			if (box) {
				entry.box = box;
				any = true;
			}
			const categories = index === 0 && boxCategories ? boxCategories : categoryEntry(datum);
			if (categories) {
				entry.colourCategories = categories;
				any = true;
			}
			return entry;
		});
		if (any) out[plot.id] = rows;
	}
	return out;
}
