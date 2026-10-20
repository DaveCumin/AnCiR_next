// @ts-check
// The marker path builder every point renderer shares (colour-by plan 2026-10-20, section
// 3.2): Points.svelte (Scatterplot, Mean +/- SEM and the other Cartesian plots), the Q-Q plot
// and the Circular phase plot. Pure, so the bucket grouping exists once.
//
// Each marker carries its own geometry inside the path (pointShapes.getPointPath), so markers
// of any position share one <path>; only the FILL forces separate paths. Without a colour
// encoding the whole series is ONE path in its colour, exactly as before colour by. With one,
// there is one path per non-empty colour bucket, "no value" first (drawn underneath, in the
// series colour), then the buckets in index order (decision 9).

import { getPointPath } from './pointShapes.js';

/**
 * @typedef {object} MarkerColourBy
 * @property {ArrayLike<number>} idx the colour bucket of each MARK (-1, or a mark past the
 *   end, is "no value")
 * @property {string[]} colours the bucket colours
 * @property {string} [noValueColour] what a mark with no value is drawn in (the series colour)
 */

/**
 * @param {ArrayLike<number>} px marker centres in px (NaN or a non-finite entry is skipped)
 * @param {ArrayLike<number>} py
 * @param {object} o
 * @param {string} [o.shape] a POINT_SHAPES key
 * @param {number} o.radius the bounding-circle radius
 * @param {string} o.colour the series colour (the one path while not coloured)
 * @param {MarkerColourBy|null} [o.colourBy] null draws one path in `colour`
 * @param {ArrayLike<number>|null} [o.marks] the mark index of each centre, for `colourBy.idx`
 *   (default: centre j is mark j)
 * @returns {{key: string, fill: string, d: string}[]} key 'all', or 'none' / 'b<bucket>'
 */
export function markerPaths(
	px,
	py,
	{ shape = 'circle', radius, colour, colourBy = null, marks = null }
) {
	const n = Math.min(px?.length ?? 0, py?.length ?? 0);
	if (!colourBy?.idx || !colourBy?.colours) {
		let d = '';
		for (let j = 0; j < n; j++) {
			if (!Number.isFinite(px[j]) || !Number.isFinite(py[j])) continue;
			d += getPointPath(shape, px[j], py[j], radius) + ' ';
		}
		return [{ key: 'all', fill: colour, d }];
	}

	// One list of path pieces per bucket (index 0 is "no value"), joined once.
	const K = colourBy.colours.length;
	const idx = colourBy.idx;
	const nIdx = idx.length;
	/** @type {string[][]} */
	const parts = Array.from({ length: K + 1 }, () => []);
	for (let j = 0; j < n; j++) {
		if (!Number.isFinite(px[j]) || !Number.isFinite(py[j])) continue;
		const k = marks ? marks[j] : j;
		const b = k >= 0 && k < nIdx ? idx[k] : -1;
		parts[b >= 0 && b < K ? b + 1 : 0].push(getPointPath(shape, px[j], py[j], radius));
	}
	const out = [];
	for (let g = 0; g <= K; g++) {
		if (parts[g].length === 0) continue;
		out.push({
			key: g === 0 ? 'none' : `b${g - 1}`,
			fill: g === 0 ? (colourBy.noValueColour ?? colour) : colourBy.colours[g - 1],
			d: parts[g].join(' ') + ' '
		});
	}
	return out;
}
