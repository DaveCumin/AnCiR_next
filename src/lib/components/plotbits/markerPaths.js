// @ts-check
// The marker path builder every point renderer shares (colour-by plan 2026-10-20, sections
// 3.2 and 3.7): Points.svelte (Scatterplot, Mean +/- SEM and the other Cartesian plots), the
// Q-Q plot and the Circular phase plot. Pure, so the grouping exists once.
//
// Each marker carries its own geometry inside the path (pointShapes.getPointPath), so markers
// of any position AND ANY SIZE share one <path>; only the FILL forces separate paths.
//
//   - No encoding: the whole series is ONE path in its colour, exactly as before colour by.
//   - Colour by: one path per non-empty colour bucket, "no value" first (drawn underneath, in
//     the series colour), then the buckets in index order (decision 9).
//   - Size by: every marker at its own EXACT radius. Paths are grouped by (size layer, colour
//     bucket) only to order the drawing: the largest layer first, so small points are not
//     hidden under big ones (plan 3.7); within a layer, colour as above. At most S x (K + 1)
//     paths (8 x 65), only the non-empty ones emitted.

import { getPointPath } from './pointShapes.js';

/**
 * @typedef {object} MarkerColourBy
 * @property {ArrayLike<number>} idx the colour bucket of each MARK (-1, or a mark past the
 *   end, is "no value")
 * @property {string[]} colours the bucket colours
 * @property {string} [noValueColour] what a mark with no value is drawn in (the series colour)
 */

/**
 * @typedef {object} MarkerSizeBy
 * @property {ArrayLike<number>} r the exact radius of each MARK, px
 * @property {ArrayLike<number>} layer the drawing layer of each mark, 0 .. S - 1 (largest last)
 * @property {number} S how many layers
 * @property {number} [noValueLayer] the layer of a mark past the end of `r` (drawn at `radius`)
 */

/**
 * @param {ArrayLike<number>} px marker centres in px (NaN or a non-finite entry is skipped)
 * @param {ArrayLike<number>} py
 * @param {object} o
 * @param {string} [o.shape] a POINT_SHAPES key
 * @param {number} o.radius the bounding-circle radius (every marker's, while not sized)
 * @param {string} o.colour the series colour (the one path while not coloured)
 * @param {MarkerColourBy|null} [o.colourBy] null draws every marker in `colour`
 * @param {MarkerSizeBy|null} [o.sizeBy] null draws every marker at `radius`
 * @param {ArrayLike<number>|null} [o.marks] the mark index of each centre, for `colourBy.idx`
 *   and `sizeBy.r` (default: centre j is mark j)
 * @returns {{key: string, fill: string, d: string, layer?: number}[]} key 'all', or 'none' /
 *   'b<bucket>' while coloured; sized, 's<layer>' (not coloured) or 's<layer>-none' /
 *   's<layer>-b<bucket>'
 */
export function markerPaths(
	px,
	py,
	{ shape = 'circle', radius, colour, colourBy = null, marks = null, sizeBy = null }
) {
	const n = Math.min(px?.length ?? 0, py?.length ?? 0);
	const coloured = !!(colourBy?.idx && colourBy?.colours);
	const sized = !!(sizeBy?.r && sizeBy?.layer && sizeBy.S > 0);
	if (!coloured && !sized) {
		let d = '';
		for (let j = 0; j < n; j++) {
			if (!Number.isFinite(px[j]) || !Number.isFinite(py[j])) continue;
			d += getPointPath(shape, px[j], py[j], radius) + ' ';
		}
		return [{ key: 'all', fill: colour, d }];
	}

	// One list of path pieces per (layer, colour group); colour group 0 is "no value" (or the
	// series colour while not coloured), group b + 1 is bucket b. Joined once.
	const K = coloured ? colourBy.colours.length : 0;
	const G = K + 1;
	const S = sized ? sizeBy.S : 1;
	const idx = coloured ? colourBy.idx : null;
	const nIdx = idx ? idx.length : 0;
	const rs = sized ? sizeBy.r : null;
	const layers = sized ? sizeBy.layer : null;
	const nR = rs ? rs.length : 0;
	const pastLayer = sized ? (sizeBy.noValueLayer ?? 0) : 0;
	/** @type {string[][]} */
	const parts = Array.from({ length: S * G }, () => []);
	for (let j = 0; j < n; j++) {
		if (!Number.isFinite(px[j]) || !Number.isFinite(py[j])) continue;
		const k = marks ? marks[j] : j;
		let g = 0;
		if (coloured) {
			const b = k >= 0 && k < nIdx ? idx[k] : -1;
			g = b >= 0 && b < K ? b + 1 : 0;
		}
		let s = 0;
		let r = radius;
		if (sized && k >= 0 && k < nR) {
			r = rs[k];
			s = layers[k];
		} else if (sized) {
			s = pastLayer;
		}
		if (!(s >= 0 && s < S)) s = 0;
		parts[s * G + g].push(getPointPath(shape, px[j], py[j], r));
	}
	const out = [];
	// Sized: the largest layer first. Not sized: the one layer.
	for (let s = S - 1; s >= 0; s--) {
		for (let g = 0; g < G; g++) {
			const list = parts[s * G + g];
			if (list.length === 0) continue;
			const colourKey = coloured ? (g === 0 ? 'none' : `b${g - 1}`) : '';
			const fill = !coloured
				? colour
				: g === 0
					? (colourBy.noValueColour ?? colour)
					: colourBy.colours[g - 1];
			const key = sized ? (coloured ? `s${s}-${colourKey}` : `s${s}`) : colourKey;
			const path = { key, fill, d: list.join(' ') + ' ' };
			if (sized) path.layer = s;
			out.push(path);
		}
	}
	return out;
}

/**
 * The marker under the cursor among points of different sizes (plan 3.7: hover with each
 * point's own radius). A point is hit within twice its radius (the old fixed-size rule);
 * among several hits the one whose centre is nearest relative to its size wins, so a small
 * point sitting on a large one stays reachable. `qt` is a d3 quadtree of the points in px.
 * @template T
 * @param {import('d3-quadtree').Quadtree<T>} qt
 * @param {number} mx
 * @param {number} my
 * @param {(d: T) => number} radiusOf
 * @param {number} maxRadius the largest radius in the tree
 * @returns {T|undefined}
 */
export function findMarkerHit(qt, mx, my, radiusOf, maxRadius) {
	const reach = 2 * maxRadius;
	const x0 = mx - reach;
	const y0 = my - reach;
	const x1 = mx + reach;
	const y1 = my + reach;
	const fx = qt.x();
	const fy = qt.y();
	/** @type {T|undefined} */
	let best;
	let bestScore = Infinity;
	qt.visit((node, nx0, ny0, nx1, ny1) => {
		if (!('length' in node)) {
			/** @type {any} */
			let leaf = node;
			do {
				const d = leaf.data;
				const r = radiusOf(d);
				const dist = Math.hypot(fx(d) - mx, fy(d) - my);
				if (r > 0 && dist <= 2 * r) {
					const score = dist / r;
					if (score < bestScore) {
						bestScore = score;
						best = d;
					}
				}
				leaf = leaf.next;
			} while (leaf);
		}
		return nx0 > x1 || ny0 > y1 || nx1 < x0 || ny1 < y0;
	});
	return best;
}
