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
import { core } from './core.svelte.js';

/** The style objects of a series whose resolved colour the export draws with. */
const COLOURED_PARTS = ['line', 'points'];

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
 * `{ [plotId]: [{ line?, points?, colourCategories? }, ...] }`, one entry per series in data order (an empty
 * object for a series with neither part), for every plot whose series have a line or points.
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
		const rows = data.map((datum) => {
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
			const categories = categoryEntry(datum);
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
