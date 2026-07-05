// plotZoomMode.svelte.js
//
// Transient, per-plot "zoom mode" flag for the workspace. When a plot's zoom
// mode is ON, drag-to-box-zoom (brush) and scroll-to-zoom are active on it;
// when OFF, the plot doesn't capture those gestures so plain scroll pans the
// canvas. Shift+wheel always zooms regardless (handled in the plot itself).
//
// Deliberately NOT part of `core`/`appState`, so it never serialises into a
// saved session — it's an interaction mode, not document state. Module-level
// $state means reads in components stay reactive.

const zoomMode = $state({ ids: new Set() });

/** @param {number|string} plotId */
export function isZoomMode(plotId) {
	return zoomMode.ids.has(plotId);
}

/** Toggle zoom mode for a plot. @param {number|string} plotId */
export function toggleZoomMode(plotId) {
	const next = new Set(zoomMode.ids);
	if (next.has(plotId)) next.delete(plotId);
	else next.add(plotId);
	zoomMode.ids = next;
}

/** @param {number|string} plotId @param {boolean} on */
export function setZoomMode(plotId, on) {
	const next = new Set(zoomMode.ids);
	if (on) next.add(plotId);
	else next.delete(plotId);
	zoomMode.ids = next;
}
