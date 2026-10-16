/**
 * Arrange a session's plots into a workspace grid.
 *
 * Every plot is born at the same default position, so a session that adds several without moving
 * them ends up with the whole set stacked in one place. This packs them instead: sensible size per
 * plot type, then shelf-packing into columns.
 *
 * Kept free of Svelte and of `core` so it stays a pure function: the demo generator calls it
 * headlessly, and it is the obvious basis for a "tidy plots" action later.
 */

import { facetGridDims } from './facetGrid.js';
import { COLUMN_BASED_FACET_TYPES } from './facetTypes.js';

/** Two columns of this width fit a normal laptop workspace without horizontal scrolling. */
const DEFAULT_SIZE = { width: 520, height: 300 };

/**
 * Draggable.svelte wraps every plot in side chrome and a header bar, so the box that occupies the
 * canvas is bigger than the plot's own width/height. Laying out on the bare numbers leaves rows
 * overlapping by the height of the header, which is invisible in the data and obvious on screen.
 */
export const PLOT_CHROME = { x: 20, y: 50 };

const outerWidth = (w) => w + PLOT_CHROME.x;
const outerHeight = (h) => h + PLOT_CHROME.y;

/**
 * Per-type sizes. The distinction that matters is aspect: a matrix or a polar plot is unreadable
 * squashed into a wide, short box, and a table wants width for its columns but little height.
 */
const SIZE_BY_TYPE = {
	pairsplot: { width: 520, height: 460 },
	correlationheatmap: { width: 520, height: 440 },
	circularphase: { width: 440, height: 440 },
	actogram: { width: 520, height: 440 },
	tableplot: { width: 520, height: 260 },
	histogram: { width: 520, height: 300 },
	boxplot: { width: 520, height: 300 },
	meansem: { width: 520, height: 300 },
	scatterplot: { width: 520, height: 300 },
	periodogram: { width: 520, height: 300 },
	correlogram: { width: 520, height: 300 },
	fft: { width: 520, height: 300 }
};

export function plotSizeFor(type) {
	return SIZE_BY_TYPE[type] ?? DEFAULT_SIZE;
}

/**
 * How many panels a facet generator shows, from its wired series alone (no column lookup, so
 * this stays pure and works on a headless session): one per wired column for a column-based
 * type, one per y of the first x-set otherwise. The same count facetPanels.facetUnits gives
 * once the columns exist, minus the check that each column is present.
 */
export function facetUnitCount(plot) {
	if (!plot?.facet) return 0;
	const data = Array.isArray(plot.plot?.data) ? plot.plot.data : [];
	if (COLUMN_BASED_FACET_TYPES.has(plot.type)) {
		return data.filter((dp) => (dp?.column?.refId ?? -1) >= 0).length;
	}
	let firstX;
	let n = 0;
	for (const dp of data) {
		const xRef = dp?.x?.refId ?? -1;
		if (firstX === undefined) firstX = xRef;
		if (xRef === firstX && (dp?.y?.refId ?? -1) >= 0) n++;
	}
	return n;
}

/**
 * Vertical space a faceted plot needs for its panel grid.
 *
 * Mirrors facetPanels.svelte.js, which lays the panels out one plot-height plus two paddings
 * below the generator, on the grid facetGrid.js computes (automatic near-square, or the
 * generator's chosen `facetRows`). Reserving it here is what stops a facet's panels from landing
 * on top of whatever was packed beneath it.
 *
 * @param facetRows the generator's chosen row count; 0 = automatic.
 */
export function facetFootprint({ width, height }, panelCount, padding = 15, facetRows = 0) {
	if (!panelCount) return { width: outerWidth(width), height: outerHeight(height) };
	const { rows, cols } = facetGridDims(panelCount, facetRows);
	const stepX = outerWidth(width) + padding;
	const stepY = outerHeight(height) + padding;
	return {
		width: cols * stepX - padding,
		// The generator itself, the gap beneath it, then the panel grid.
		height: outerHeight(height) + 2 * padding + rows * stepY - padding
	};
}

/**
 * Place every plot, mutating x/y/width/height in place. A facet generator reserves the room
 * its panel grid takes (facetUnitCount, derived from its own series); the panels themselves
 * are views placed relative to it and are not plots.
 *
 * Packing is shortest-column-first rather than strict row-major, so a tall plot beside a short one
 * does not leave a hole underneath the short one.
 *
 * @param plots the session's plots
 */
export function layoutWorkspacePlots(plots, opts = {}) {
	const { columns = 2, gutter = 30, originX = 60, originY = 60, padding = 15 } = opts;

	const top = (plots ?? []).filter(Boolean);
	if (top.length === 0) return plots;

	// A faceted plot is as wide as its panel grid, so it can need more than one column's width.
	const colWidth = Math.max(
		...top.map(
			(p) => facetFootprint(plotSizeFor(p.type), facetUnitCount(p), padding, p.facetRows ?? 0).width
		),
		DEFAULT_SIZE.width
	);

	const nextY = new Array(columns).fill(originY);

	for (const p of top) {
		const size = plotSizeFor(p.type);
		p.width = size.width;
		p.height = size.height;

		const foot = facetFootprint(size, facetUnitCount(p), padding, p.facetRows ?? 0);
		// Shortest column wins; ties go left so the reading order stays predictable.
		let col = 0;
		for (let i = 1; i < columns; i++) if (nextY[i] < nextY[col]) col = i;

		p.x = originX + col * (colWidth + gutter);
		p.y = nextY[col];
		nextY[col] += foot.height + gutter;
	}

	return plots;
}

// ---------------------------------------------------------------------------
// Notes on the workspace (UI-7)
// ---------------------------------------------------------------------------
//
// A Note card and a plot card share the workspace canvas. Every worked example ships a note at
// the top-left, and the plots were packed from the same corner, so the note covered the first
// plot. Notes get a lane of their own ABOVE the plots instead (the workflow canvas already
// reserves one above the node graph, see nodeDemoBuilders.addDemoNote), and a new note is
// nudged to the nearest free spot. Kept pure (boxes in, positions out) so the session loader,
// the note spawner, the demo generator and the tests all run the same geometry.

/** Clear space kept between a note and a plot (canvas px); two grid cells. */
export const NOTE_GAP = 30;

const snapUp = (v, grid) => (grid > 0 ? Math.ceil(v / grid) * grid : v);
const snapDown = (v, grid) => (grid > 0 ? Math.floor(v / grid) * grid : v);
const snapRound = (v, grid) => (grid > 0 ? Math.round(v / grid) * grid : v);

/**
 * The box a plot card occupies on the canvas, exactly as Draggable.svelte draws it: left/top at
 * (x, y), snapToGrid(width + 20) by snapToGrid(height + 50), with the card's CSS min-width of
 * 200 px. Works for a Plot and a FacetPanel alike (both carry x, y, width, height).
 */
export function plotCardBox(p, grid = 15) {
	return {
		id: p.id,
		x: p.x ?? 0,
		y: p.y ?? 0,
		w: Math.max(200, snapRound((p.width ?? 200) + PLOT_CHROME.x, grid)),
		h: snapRound((p.height ?? 150) + PLOT_CHROME.y, grid)
	};
}

/** The box a note card occupies (NoteCard.svelte draws it at exactly x, y, width, height). */
export function noteCardBox(n) {
	return { id: n.id, x: n.x ?? 0, y: n.y ?? 0, w: n.width ?? 200, h: n.height ?? 120 };
}

/** Strict overlap: boxes that only touch along an edge do not cover each other. */
export function boxesOverlap(a, b) {
	return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Give notes that cover a plot a lane above the plots.
 *
 * Nothing moves unless some note overlaps some plot. When one does, every such note is laid
 * left to right (wrapping at the plots' width) in a lane starting at the top-left of everything
 * on the canvas, and every plot and every other note moves down by one rigid offset so the lane
 * sits clear above them. A rigid shift keeps the user's own arrangement (and every gap in it)
 * intact, so it cannot create a new overlap; only the offending notes are re-placed.
 *
 * @param {{ notes: Array<{id:any,x:number,y:number,w:number,h:number}>,
 *           plots: Array<{x:number,y:number,w:number,h:number}>,
 *           grid?: number, gap?: number }} input boxes (noteCardBox / plotCardBox)
 * @returns {{ dy: number, notes: Map<any, {x:number, y:number}> }} the plots' downward shift and
 *   the new top-left of every note that moves (lane notes and shifted notes); dy 0 and an empty
 *   map when nothing overlaps.
 */
export function noteLaneLayout({ notes, plots, grid = 15, gap = NOTE_GAP }) {
	const moves = new Map();
	if (!notes?.length || !plots?.length) return { dy: 0, notes: moves };
	const lane = notes.filter((n) => plots.some((p) => boxesOverlap(n, p)));
	if (lane.length === 0) return { dy: 0, notes: moves };
	const laneIds = new Set(lane.map((n) => n.id));
	const rest = notes.filter((n) => !laneIds.has(n.id));

	const all = [...plots, ...notes];
	const left = Math.min(...all.map((b) => b.x));
	const top = Math.min(...all.map((b) => b.y));
	const plotsRight = Math.max(...plots.map((b) => b.x + b.w));
	const wrapAt = Math.max(plotsRight, left + Math.max(...lane.map((n) => n.w)));

	// Reading order: the note the author put first (top, then left) stays first.
	const ordered = [...lane].sort((a, b) => a.y - b.y || a.x - b.x);
	let cx = left;
	let cy = top;
	let rowH = 0;
	for (const n of ordered) {
		if (cx > left && cx + n.w > wrapAt) {
			cx = left;
			cy += rowH + gap;
			rowH = 0;
		}
		moves.set(n.id, { x: cx, y: cy });
		cx = snapUp(cx + n.w + gap, grid);
		rowH = Math.max(rowH, n.h);
	}
	const laneBottom = cy + rowH;

	// Everything else moves down as one block so its top clears the lane by `gap`.
	const shifted = [...plots, ...rest];
	const blockTop = Math.min(...shifted.map((b) => b.y));
	const dy = Math.max(0, snapUp(laneBottom + gap - blockTop, grid));
	if (dy > 0) for (const n of rest) moves.set(n.id, { x: n.x, y: n.y + dy });
	return { dy, notes: moves };
}

/**
 * Where to put a NEW note of size w x h that the caller wants at (x, y): there, if it covers no
 * obstacle; otherwise the nearest free spot (by distance from the wanted point) among positions
 * flush beside an obstacle, `gap` away from it. Some candidate is always free (right of the
 * rightmost obstacle), so this never fails.
 *
 * @param {{x:number,y:number,w:number,h:number}} want
 * @param {Array<{x:number,y:number,w:number,h:number}>} obstacles
 */
export function freeNoteSpot(want, obstacles, { grid = 15, gap = NOTE_GAP } = {}) {
	const { w, h } = want;
	const isFree = (x, y) => !obstacles.some((o) => boxesOverlap({ x, y, w, h }, o));
	if (isFree(want.x, want.y)) return { x: want.x, y: want.y };
	const xs = new Set([want.x]);
	const ys = new Set([want.y]);
	for (const o of obstacles) {
		xs.add(snapUp(o.x + o.w + gap, grid));
		xs.add(snapDown(o.x - w - gap, grid));
		ys.add(snapUp(o.y + o.h + gap, grid));
		ys.add(snapDown(o.y - h - gap, grid));
	}
	let best = null;
	let bestD = Infinity;
	for (const x of xs) {
		for (const y of ys) {
			if (!isFree(x, y)) continue;
			const d = Math.hypot(x - want.x, y - want.y);
			if (d < bestD) {
				bestD = d;
				best = { x, y };
			}
		}
	}
	return best ?? { x: snapUp(Math.max(...obstacles.map((o) => o.x + o.w)) + gap, grid), y: want.y };
}
