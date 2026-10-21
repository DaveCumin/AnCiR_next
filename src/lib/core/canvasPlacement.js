// @ts-nocheck
// Where a new group (an imported table, or one added from the palette) goes on the workflow
// canvas. Every import used to call createGroup() with its fixed default (80, 80), so a second
// import covered the first and hid it, and after a pan the new table landed off screen. Now
// the wanted spot is that same 80, 80 measured from the top left of what the user can see,
// and the group takes the nearest free place there (right of or below what is in the way).
//
// The geometry is pure (freeCanvasSpot, layoutObstacles). newGroupPosition reads the live
// session: the canvas's rendered node boxes when the workflow editor is mounted (it registers
// them, so expanded nodes count at their drawn size), otherwise the saved layout, with group
// sizes from their rows and other nodes at a generous default size.
import { core, appState } from '$lib/core/core.svelte.js';
import { clientToCanvasPoint } from '$lib/core/canvasCoords.js';
import { boxesOverlap } from '$lib/core/workspaceLayout.js';
import { nodePortAreaHeight } from '$lib/components/workflow/nodeRows.js';

/** createGroup's default spot, now an offset from the visible top left of the canvas. */
export const NEW_GROUP_OFFSET = 80;
/** Clear space between a new group and what it is placed beside. */
export const NEW_GROUP_GAP = 40;
/** A new group's frame (createGroup's width and minimum height). */
export const GROUP_W = 240;
export const GROUP_MIN_H = 180;
/** A saved node with no saved size: wider and taller than most collapsed or data nodes. */
export const DEFAULT_NODE_BOX = { w: 240, h: 160 };

/**
 * The canvas point `offset` px in from the top left of the visible canvas, for a viewport
 * `{ x, y, z }` (pan in px and zoom, appState.workflowViewport).
 */
export function visibleTopLeft(viewport, offset = NEW_GROUP_OFFSET) {
	const vp = viewport ?? {};
	return clientToCanvasPoint(offset, offset, {
		scale: vp.z,
		offset: { x: vp.x ?? 0, y: vp.y ?? 0 }
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

/**
 * Where a box of size w x h goes when the caller wants it at `want`: there if it covers
 * nothing; otherwise the nearest free spot that is flush right of or below an obstacle (or
 * in line with `want`), never left of or above `want`, so it stays in the part of the canvas
 * the user is looking at. Something is always free (right of the rightmost obstacle).
 *
 * @param {{x:number,y:number,w:number,h:number}} want
 * @param {Array<{x:number,y:number,w:number,h:number}>} obstacles
 * @param {{ gap?: number }} [opts]
 * @returns {{x:number,y:number}}
 */
export function freeCanvasSpot(want, obstacles, { gap = NEW_GROUP_GAP } = {}) {
	const { w, h } = want;
	const isFree = (x, y) => !obstacles.some((o) => boxesOverlap({ x, y, w, h }, o));
	if (isFree(want.x, want.y)) return { x: want.x, y: want.y };
	const xs = new Set([want.x]);
	const ys = new Set([want.y]);
	for (const o of obstacles) {
		if (o.x + o.w + gap >= want.x) xs.add(o.x + o.w + gap);
		if (o.y + o.h + gap >= want.y) ys.add(o.y + o.h + gap);
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
	return best ?? { x: Math.max(...obstacles.map((o) => o.x + o.w)) + gap, y: want.y };
}

// The workflow editor, while mounted, supplies its rendered node boxes (canvas coordinates).
let renderedBoxes = null;

/**
 * Called by WorkflowEditor on mount with a function returning every node's drawn box; the
 * returned function unregisters it (on unmount).
 * @param {() => Array<{x:number,y:number,w:number,h:number}>} fn
 */
export function registerCanvasBoxes(fn) {
	renderedBoxes = fn;
	return () => {
		if (renderedBoxes === fn) renderedBoxes = null;
	};
}

/**
 * Position for a new group with `rows` column rows: the nearest free spot to the visible top
 * left of the workflow canvas. Pass the result to createGroup.
 * @param {{ rows?: number }} [opts]
 * @returns {{x:number,y:number}}
 */
export function newGroupPosition({ rows = 0 } = {}) {
	const want = {
		...visibleTopLeft(appState.workflowViewport),
		w: GROUP_W,
		h: Math.max(GROUP_MIN_H, nodePortAreaHeight(rows))
	};
	const drawn = renderedBoxes?.();
	const obstacles = [
		...(drawn ?? []),
		// Saved layout for anything not drawn (the editor is not mounted, or a group created
		// in this same tick has not rendered yet).
		...layoutObstacles({ groups: core.groups, nodeLayout: core.nodeLayout }).filter(
			(b) => !drawn?.some((d) => d.id === b.id)
		)
	];
	const spot = freeCanvasSpot(want, obstacles);
	return { x: Math.round(spot.x), y: Math.round(spot.y) };
}
