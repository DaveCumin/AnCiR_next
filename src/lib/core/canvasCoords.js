// Screen ↔ canvas coordinate conversion for the workspace canvas.
//
// The workspace renders content inside `.canvas-inner`, which carries
// `translate(offset) scale(zoom)` relative to `.canvas-viewport`. Anything that
// drags an item (plots via Draggable, notes via NoteCard) has to convert the
// pointer's client coords into that canvas space, otherwise the item slides out
// from under the cursor whenever the canvas pans or is zoomed mid-drag.
//
// Deliberately clamp-free: the canvas is infinite in every direction, exactly
// like the workflow canvas, so negative coordinates are legitimate positions and
// not an error to be corrected.

/**
 * Convert client (viewport) coordinates into canvas coordinates.
 *
 * @param {number} clientX
 * @param {number} clientY
 * @param {{ rect?: {left: number, top: number} | null, scale?: number, offset?: {x: number, y: number} | null }} view
 * @returns {{x: number, y: number}}
 */
export function clientToCanvasPoint(clientX, clientY, view = {}) {
	const left = view.rect?.left ?? 0;
	const top = view.rect?.top ?? 0;
	// A zero/absent scale would divide to Infinity; treat it as "unzoomed".
	const z = view.scale || 1;
	const offX = view.offset?.x ?? 0;
	const offY = view.offset?.y ?? 0;
	return {
		x: (clientX - left - offX) / z,
		y: (clientY - top - offY) / z
	};
}
