// @ts-nocheck
// Where a NEW node goes on the workflow canvas: the one rule for every node the user adds
// (an imported table, a palette group, plot, analysis, transform or note, a quick plot, an
// AI-edit node, a paste). The node is centred on the middle of what the user can see, at the
// current pan and zoom. If something already sits exactly there (two adds in a row without
// moving), it steps CASCADE_STEP px down and right until it is clear of exact or near-exact
// collisions. It never hunts for distant free space: a small visible cascade is the intent.
//
// The geometry is pure (centredSpot, cascadeSpot, placeNewNodes, layoutObstacles). The live
// helpers (newNodePosition, newGroupPosition) read the session: the canvas's drawn node boxes
// and its size while the workflow editor is mounted (it registers them), otherwise the saved
// layout, the saved viewport and the size the canvas last had. A canvas never mounted in
// this page load has no size, so the node keeps the old default spot (createGroup's 80, 80).
import { core, appState } from '$lib/core/core.svelte.js';
import { nodePortAreaHeight } from '$lib/components/workflow/nodeRows.js';

/** The step of the cascade, in canvas px (down and right). */
export const CASCADE_STEP = 24;
/** Space kept between a node bigger than the view and the view's top or left edge (screen px). */
export const VIEW_MARGIN = 16;
/** Where a node goes when the canvas size is unknown: createGroup's default spot. */
export const FALLBACK_SPOT = { x: 80, y: 80 };
/** A new group's frame (createGroup's width and minimum height). */
export const GROUP_W = 240;
export const GROUP_MIN_H = 180;
/** A saved node with no saved size: wider and taller than most collapsed or data nodes. */
export const DEFAULT_NODE_BOX = { w: 240, h: 160 };

/**
 * The visible part of the canvas, in canvas coordinates, for a viewport `{ x, y, z }` (pan in
 * px and zoom, appState.workflowViewport) and the canvas element's size `{ w, h }` (screen px).
 */
export function visibleRect(viewport, viewSize) {
	const z = viewport?.z || 1;
	return {
		// `+ 0` turns an unpanned -0 into 0.
		x: -(viewport?.x ?? 0) / z + 0,
		y: -(viewport?.y ?? 0) / z + 0,
		w: viewSize.w / z,
		h: viewSize.h / z,
		z
	};
}

/**
 * Top left that centres a `w` x `h` node on the middle of the view. A node bigger than the
 * view along an axis is pinned VIEW_MARGIN in from that edge instead, so its header (and
 * left edge) stays on screen. Without a view size, FALLBACK_SPOT.
 */
export function centredSpot({ w, h }, viewport, viewSize) {
	if (!(viewSize?.w > 0 && viewSize?.h > 0)) return { ...FALLBACK_SPOT };
	const v = visibleRect(viewport, viewSize);
	const m = VIEW_MARGIN / v.z;
	const along = (start, span, size) =>
		size > span - 2 * m ? start + m : start + span / 2 - size / 2;
	return { x: along(v.x, v.w, w), y: along(v.y, v.h, h) };
}

/**
 * Whether box `a` sits (nearly) exactly where box `b` is: their top left corners, or their
 * centres, within `tol` px of each other on both axes. The centre test catches a node of a
 * different size already centred on the same spot; the corner test catches one the same size.
 */
export function sameSpot(a, b, tol = CASCADE_STEP / 2) {
	const near = (ax, ay, bx, by) => Math.abs(ax - bx) < tol && Math.abs(ay - by) < tol;
	return (
		near(a.x, a.y, b.x, b.y) ||
		near(a.x + a.w / 2, a.y + a.h / 2, b.x + (b.w ?? 0) / 2, b.y + (b.h ?? 0) / 2)
	);
}

/**
 * `want` (top left plus size), stepped `step` px down and right until no box in `others`
 * sits at the same spot (sameSpot). Overlap that is not a near-exact collision is left alone.
 * @returns {{x:number,y:number}}
 */
export function cascadeSpot(want, others, step = CASCADE_STEP) {
	let { x, y } = want;
	// Bounded: each step clears at least the boxes at the previous spot, so this ends long
	// before the guard on any real canvas.
	for (let i = 0; i < 1000; i++) {
		const at = { x, y, w: want.w, h: want.h };
		if (!others.some((o) => sameSpot(at, o, step / 2))) break;
		x += step;
		y += step;
	}
	return { x, y };
}

/**
 * Positions for nodes of the given sizes created together, in order: each centred on the
 * view, then cascaded clear of `others` and of the ones placed before it.
 * @param {Array<{w:number,h:number}>} sizes
 * @param {{ viewport?: {x:number,y:number,z:number}, viewSize?: {w:number,h:number}|null,
 *           others?: Array<{x:number,y:number,w:number,h:number}>, step?: number }} opts
 * @returns {Array<{x:number,y:number}>} rounded top-left corners, one per size
 */
export function placeNewNodes(sizes, { viewport, viewSize, others = [], step = CASCADE_STEP }) {
	const taken = [...others];
	return sizes.map((size) => {
		const spot = cascadeSpot({ ...centredSpot(size, viewport, viewSize), ...size }, taken, step);
		const at = { x: Math.round(spot.x), y: Math.round(spot.y) };
		taken.push({ ...at, w: size.w, h: size.h });
		return at;
	});
}

/** A group's frame on the canvas: its stored size, taller when its rows need more room. */
export function groupBox(g, x = g.x, y = g.y) {
	const rows = Array.isArray(g.allColumnIds)
		? g.allColumnIds.length
		: (g.sourceColumnIds?.length ?? 0);
	return {
		id: g.id,
		x: Number(x) || 0,
		y: Number(y) || 0,
		w: Number(g.width) || GROUP_W,
		h: Math.max(Number(g.height) || GROUP_MIN_H, nodePortAreaHeight(rows))
	};
}

/**
 * Everything already on the canvas, from the session alone: each group's frame and each
 * other node the saved layout places (at its saved size, else DEFAULT_NODE_BOX).
 * @param {{ groups?: object[], nodeLayout?: Record<string, {x:number,y:number,w?:number,h?:number}> }} s
 */
export function layoutObstacles({ groups = [], nodeLayout = {} } = {}) {
	const out = groups.map((g) => {
		const saved = nodeLayout?.[g.id];
		// The canvas moves a group by its layout entry first; the group's own x/y follows.
		return Number.isFinite(saved?.x) && Number.isFinite(saved?.y)
			? groupBox(g, saved.x, saved.y)
			: groupBox(g);
	});
	const groupIds = new Set(groups.map((g) => g.id));
	for (const [id, p] of Object.entries(nodeLayout ?? {})) {
		if (groupIds.has(id) || !Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue;
		out.push({
			id,
			x: p.x,
			y: p.y,
			w: Number(p.w) > 0 ? Number(p.w) : DEFAULT_NODE_BOX.w,
			h: Number(p.h) > 0 ? Number(p.h) : DEFAULT_NODE_BOX.h
		});
	}
	return out;
}

// The workflow editor, while mounted, supplies its drawn node boxes and its own size.
let canvas = null;
// The canvas element's size the last time it was read, kept after the editor unmounts so a
// node added from the workspace view is centred on the view the canvas will reopen at.
let lastViewSize = null;

/**
 * Called by WorkflowEditor on mount: `boxes` returns every node's drawn box (canvas
 * coordinates), `viewSize` the canvas element's size in screen px. Returns the unregister
 * function (for unmount).
 * @param {{ boxes: () => Array<{id?:string,x:number,y:number,w:number,h:number}>,
 *           viewSize: () => ({w:number,h:number}|null) }} c
 */
export function registerCanvas(c) {
	canvas = c;
	readViewSize();
	return () => {
		if (canvas === c) {
			readViewSize();
			canvas = null;
		}
	};
}

/** The canvas size: live while mounted, else the last one seen, else null. */
export function readViewSize() {
	const s = canvas?.viewSize?.();
	if (s?.w > 0 && s?.h > 0) lastViewSize = { w: s.w, h: s.h };
	return lastViewSize;
}

/** Forget the remembered canvas size (tests). */
export function resetPlacementState() {
	canvas = null;
	lastViewSize = null;
}

/** Everything on the canvas now: drawn boxes, plus saved layout for anything not drawn. */
function liveObstacles() {
	const drawn = canvas?.boxes?.() ?? [];
	const drawnIds = new Set(drawn.map((d) => d.id));
	// Saved layout covers what is not drawn: the editor is not mounted, or a group created in
	// this same tick has not rendered yet.
	const saved = layoutObstacles({ groups: core.groups, nodeLayout: core.nodeLayout }).filter(
		(b) => !drawnIds.has(b.id)
	);
	return [...drawn, ...saved];
}

/**
 * Position for one new node of size `{ w, h }`, from the live session (see the file comment).
 * @param {{ w: number, h: number }} size
 * @param {{ exclude?: Iterable<string> }} [opts] node ids not to count as already there
 * @returns {{x:number,y:number}}
 */
export function newNodePosition(size, { exclude = [] } = {}) {
	const skip = new Set(exclude);
	const others = liveObstacles().filter((b) => !skip.has(b.id));
	return placeNewNodes([size], {
		viewport: appState.workflowViewport,
		viewSize: readViewSize(),
		others
	})[0];
}

/**
 * Position for a new group with `rows` column rows (an import, a palette group). Pass the
 * result to createGroup.
 * @param {{ rows?: number }} [opts]
 * @returns {{x:number,y:number}}
 */
export function newGroupPosition({ rows = 0 } = {}) {
	return newNodePosition({ w: GROUP_W, h: Math.max(GROUP_MIN_H, nodePortAreaHeight(rows)) });
}
