// Releasing the automatic series colours an older session wrote out as if they were choices.
//
// WHAT A SAVED COLOUR MEANS
//
// A series' style objects (LineClass, PointsClass, BoxClass) resolve their colour at read time:
// a user's pick, else the column's record in the appearance map, else a palette slot. Since
// v72.4 an automatic stroke is saved as null, so a saved string IS a pick. Sessions saved
// before v72.4 wrote every colour out, the automatic ones too, and an automatic colour was the
// palette entry for the series' PLACE in its plot (series i took palette[i]). Loaded verbatim,
// those would pin every series to the colour it had when saved and the appearance map (one
// colour per column, across plots) would never engage.
//
// The box FILL was saved as a resolved colour until v82.49 (it now saves null while it follows
// the stroke). An automatic fill was the stroke's colour, or palette[0] (an old bug froze every
// series' fill at palette[0] before the series was wired).
//
// THE RULE (the information that tells an automatic colour from a pick)
//
//   1. The session's version. From v72.4 a stroke string is a pick, always, even when it equals
//      a palette slot; from v82.49 a fill string is too. Nothing is released.
//   2. Before that, a string that is EXACTLY what the old automatic rule produced for THIS
//      series is released:
//        stroke: palette[i], i the series' own place in its plot;
//        fill:   palette[0], palette[i], the series' saved stroke, or the colour the series'
//                column has in the session's appearance map (what an automatic stroke drew).
//      Anything else is a pick and kept. A legacy pick that happens to equal its own slot is
//      indistinguishable from an automatic colour in such a file and is released; it still
//      draws the same colour (the column takes that slot when it is pinned).
//
// This used to be decided in each style object's constructor, without the version, against
// palette[parentPlot.data.length]. While a plot's fromJSON builds its series list that length
// is 0, so every series compared against palette[0]: series 2 saved in palette[1] (automatic)
// was kept as a pick, and a real pick of palette[0] on any series was released. Doing it here,
// once per session load (components/iconActions/Setting.svelte buildSession), puts it where
// the version is known; undo, copy and duplicate (which round-trip the CURRENT format) no
// longer pass through it at all.
import { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';
import { migrateAppearanceMaps } from '$lib/plots/appearanceIdentity.js';

/** The first version that saves an automatic stroke as null (appearance identity, v72.4). */
export const NULL_AUTO_STROKE_VERSION = Object.freeze([72, 4]);
/** The first version that saves a fill following its stroke as null. */
export const NULL_AUTO_FILL_VERSION = Object.freeze([82, 49]);

/** The series slots that hold a LineClass / PointsClass / BoxClass, in every plot type. */
export const STYLE_SLOTS = Object.freeze([
	'line',
	'points',
	'phaseLine',
	'phasePoints',
	'confidenceLine',
	'thresholdline',
	'boxPlot'
]);

/**
 * [major, minor] of an app version ('β.82.48' -> [82, 48], 'v72.4' -> [72, 4], '81' -> [81, 0]),
 * or null when there is none.
 * @param {unknown} version
 * @returns {[number, number] | null}
 */
export function versionParts(version) {
	if (typeof version !== 'string' && typeof version !== 'number') return null;
	const m = String(version).match(/(\d+)(?:\.(\d+))?/);
	if (!m) return null;
	return [Number(m[1]), m[2] != null ? Number(m[2]) : 0];
}

/**
 * Whether a session saved by `version` predates `[major, minor]`. A session with no readable
 * version predates everything (every session the app writes carries one).
 * @param {unknown} version
 * @param {readonly number[]} threshold
 */
export function savedBefore(version, threshold) {
	const v = versionParts(version);
	if (!v) return true;
	return v[0] < threshold[0] || (v[0] === threshold[0] && v[1] < threshold[1]);
}

const same = (a, b) =>
	typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/** The colour an appearance record draws, or null. */
function recordColour(record) {
	const c = record?.colour;
	if (!c) return null;
	return c.hex ?? (Number.isInteger(c.slot) ? getPaletteColor(c.slot) : null);
}

/**
 * Release the automatic colours a pre-v72.4 (stroke) or pre-v82.49 (box fill) session saved.
 * Pure: returns a copy when anything changed, else the session itself.
 * @param {any} json  a parsed session
 * @returns {{ json: any, released: number }}
 */
export function releaseLegacyAutoColours(json) {
	if (!json || !Array.isArray(json.plots)) return { json, released: 0 };
	const strokes = savedBefore(json.version, NULL_AUTO_STROKE_VERSION);
	const fills = savedBefore(json.version, NULL_AUTO_FILL_VERSION);
	if (!strokes && !fills) return { json, released: 0 };

	// What an automatic stroke drew for a column: its record in the session's appearance map.
	const appearance = fills
		? migrateAppearanceMaps(
				json.seriesAppearance,
				json.seriesColours,
				json.seriesShapes,
				json.seriesDashes
			)
		: {};

	let released = 0;
	const plots = json.plots.map((plot) => {
		const data = plot?.plot?.data;
		if (!Array.isArray(data)) return plot;
		let changed = false;
		const nextData = data.map((series, i) => {
			if (!series || typeof series !== 'object') return series;
			let nextSeries = series;
			for (const slot of STYLE_SLOTS) {
				const style = series[slot];
				if (!style || typeof style !== 'object') continue;
				const patch = {};
				if (strokes && typeof style.colour === 'string' && same(style.colour, getPaletteColor(i))) {
					patch.colour = null;
				}
				if (fills && typeof style.fillColour === 'string') {
					const ref = series.y?.refId ?? series.column?.refId;
					const followed = [
						getPaletteColor(0),
						getPaletteColor(i),
						style.colour,
						recordColour(appearance[String(ref)])
					];
					if (followed.some((c) => same(style.fillColour, c))) patch.fillColour = null;
				}
				if (Object.keys(patch).length) {
					released += Object.keys(patch).length;
					nextSeries = { ...nextSeries, [slot]: { ...style, ...patch } };
				}
			}
			if (nextSeries !== series) changed = true;
			return nextSeries;
		});
		return changed ? { ...plot, plot: { ...plot.plot, data: nextData } } : plot;
	});
	return released ? { json: { ...json, plots }, released } : { json, released: 0 };
}
