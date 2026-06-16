// @ts-nocheck

// Edge-pan engine: while a drag is active, nudge the host canvas's pan offset
// whenever the cursor approaches a viewport edge. Both the worksheet
// (Draggable.svelte) and the workflow (WorkflowEditor.svelte) use this so a
// node/plot being dragged toward an edge brings the canvas with it.
//
// Why a shared module: the two canvases have completely different drag
// pipelines, but the "follow the cursor with the canvas" math is identical and
// purely geometric. Centralising it keeps both call sites tiny and ensures the
// two views feel the same.

const EDGE_BAND_PX = 60; // distance from edge at which auto-pan starts
const MAX_PAN_PER_FRAME = 12; // px/frame at the very edge

let rafId = null;
let active = false;
let lastClientX = 0;
let lastClientY = 0;
let getRect = null; // () => DOMRect | null  — viewport bounds in client coords
let nudge = null; // (dx, dy) => void       — apply pan delta in screen px

function tick() {
	rafId = null;
	if (!active) return;
	const rect = getRect?.();
	if (rect && rect.width > 0 && rect.height > 0) {
		const leftDist = lastClientX - rect.left;
		const rightDist = rect.right - lastClientX;
		const topDist = lastClientY - rect.top;
		const bottomDist = rect.bottom - lastClientY;

		// Ramp linearly inside EDGE_BAND_PX; clamp at MAX_PAN_PER_FRAME.
		const ramp = (d) => {
			if (d >= EDGE_BAND_PX) return 0;
			const k = Math.max(0, 1 - d / EDGE_BAND_PX);
			return k * MAX_PAN_PER_FRAME;
		};

		const dx = ramp(leftDist) - ramp(rightDist);
		const dy = ramp(topDist) - ramp(bottomDist);

		if (dx !== 0 || dy !== 0) nudge?.(dx, dy);
	}
	rafId = requestAnimationFrame(tick);
}

/**
 * Begin edge-panning. Pass an object describing the host canvas:
 *   getViewportRect: () => DOMRect           — clipping element in client coords
 *   applyPan:        (dx, dy) => void        — add (dx, dy) screen-px to pan
 *
 * Idempotent: re-calling while already active just swaps the handlers.
 */
export function startEdgePan({ getViewportRect, applyPan }) {
	getRect = getViewportRect;
	nudge = applyPan;
	if (active) return;
	active = true;
	if (rafId == null) rafId = requestAnimationFrame(tick);
}

/** Update the cursor position the engine uses for distance-to-edge math. */
export function noteEdgePanMouse(clientX, clientY) {
	lastClientX = clientX;
	lastClientY = clientY;
}

/** Stop the RAF loop. Safe to call when not active. */
export function stopEdgePan() {
	active = false;
	if (rafId != null) {
		cancelAnimationFrame(rafId);
		rafId = null;
	}
	getRect = null;
	nudge = null;
}
