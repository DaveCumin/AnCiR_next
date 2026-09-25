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
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- the holder is $state and a FRESH Set is assigned to zoomMode.ids below; reactivity comes from that reassignment, so a SvelteSet would be churn
	const next = new Set(zoomMode.ids);
	if (next.has(plotId)) next.delete(plotId);
	else next.add(plotId);
	zoomMode.ids = next;
}

/** @param {number|string} plotId @param {boolean} on */
export function setZoomMode(plotId, on) {
	// No-op when already in the target state, so callers (e.g. a deselect effect)
	// can call this freely without churning the Set / triggering re-renders.
	if (zoomMode.ids.has(plotId) === on) return;
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- same as toggleZoomMode: a fresh Set is assigned to the $state holder, which is what drives the reactive reads
	const next = new Set(zoomMode.ids);
	if (on) next.add(plotId);
	else next.delete(plotId);
	zoomMode.ids = next;
}
