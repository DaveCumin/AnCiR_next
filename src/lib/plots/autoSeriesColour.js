// A plot series' own colour (Actogram, CircularPhase, QQPlot `colour`; Histogram `fillColour`)
// resolved the way LineClass / PointsClass resolve theirs: the user's pick, else the colour its
// column has in the session's appearance map (one colour per column, across plots), else the
// palette slot of the series' place in its plot.
//
// These series used to COPY getPaletteColor(parent.data.length) into a plain field when they
// were made, so the copy saved as if it were a pick and the appearance map never applied to
// them. Now the field stores only a pick (null: automatic), read through this at draw time.
import { resolveColour } from './appearanceIdentity.js';

/**
 * @param {any} series the series (its `parentPlot.data` gives its place)
 * @param {string|null} explicit the user's pick, or null
 * @param {any} column the series' wired column wrapper (its `refId` names the column)
 * @returns {string}
 */
export function autoSeriesColour(series, explicit, column) {
	const ref = column?.refId;
	const colId = typeof ref === 'number' && ref >= 0 ? ref : null;
	const siblings = series?.parentPlot?.data;
	const index = Array.isArray(siblings) ? Math.max(0, siblings.indexOf(series)) : 0;
	return resolveColour(explicit, colId, index);
}

/** A saved colour as a pick: a non-empty string, else null (automatic). */
export function pickedColour(v) {
	return typeof v === 'string' && v !== '' ? v : null;
}
