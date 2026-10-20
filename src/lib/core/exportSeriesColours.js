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
import { core } from './core.svelte.js';

/** The style objects of a series whose resolved colour the export draws with. */
const COLOURED_PARTS = ['line', 'points'];

/**
 * `{ [plotId]: [{ line?, points? }, ...] }`, one entry per series in data order (an empty
 * object for a series with neither part), for every plot whose series have a line or points.
 * @param {any[]} [plots] the wrapper plots (default: the live session's)
 * @returns {Record<string, Array<Record<string, string>>>}
 */
export function exportSeriesColours(plots = core.plots) {
	/** @type {Record<string, Array<Record<string, string>>>} */
	const out = {};
	for (const plot of plots ?? []) {
		const data = plot?.plot?.data;
		if (plot?.id == null || !Array.isArray(data)) continue;
		let any = false;
		const rows = data.map((datum) => {
			/** @type {Record<string, string>} */
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
			return entry;
		});
		if (any) out[plot.id] = rows;
	}
	return out;
}
