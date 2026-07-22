// Pure (de)serialisation for the workflow-canvas layout. Shared by the
// WorkflowEditor mirror effect (which writes core.nodeLayout + the localStorage
// cache) and the adopt-on-import effect that reads it back. No Svelte/runtime
// state here — keep it unit-testable.
//
// Persisted shape, keyed by canvas node id:
//   { x, y, collapsed?, w?, h? }
//
// `w`/`h` are the workflow node's own preview box (currently only plot nodes are
// resizable this way). They are deliberately NOT the plot's real width/height —
// that belongs to the workspace view and must not be changed by a canvas resize.
// Older sessions carry no w/h; those nodes simply fall back to their defaults.

const finite = (v) => Number.isFinite(Number(v));

/**
 * Build the persisted layout from the editor's live state.
 *
 * @param {{positions?: Record<string,{x:number,y:number}>,
 *          collapsedIds?: Set<string>|Iterable<string>,
 *          sizes?: Record<string,{w:number,h:number}>}} [state]
 * @returns {Record<string, {x?:number, y?:number, collapsed?:true, w?:number, h?:number}>}
 */
export function buildNodeLayout(state) {
	const { positions = {}, collapsedIds = [], sizes = {} } = state ?? {};
	const layout = {};

	for (const [id, pos] of Object.entries(positions ?? {})) {
		if (finite(pos?.x) && finite(pos?.y)) layout[id] = { x: Number(pos.x), y: Number(pos.y) };
	}

	for (const id of collapsedIds ?? []) {
		layout[id] = { ...(layout[id] ?? {}), collapsed: true };
	}

	// A node can be resized before it has a pinned position, so size entries are
	// merged in independently rather than only onto known positions.
	for (const [id, size] of Object.entries(sizes ?? {})) {
		const w = Number(size?.w);
		const h = Number(size?.h);
		if (!finite(w) || !finite(h) || w <= 0 || h <= 0) continue;
		layout[id] = { ...(layout[id] ?? {}), w, h };
	}

	return layout;
}

/**
 * Split a persisted layout back into the editor's separate state buckets.
 * Malformed entries are dropped rather than throwing, so a hand-edited or
 * partially-written session still loads.
 *
 * @param {unknown} layout
 * @returns {{positions: Record<string,{x:number,y:number}>,
 *            collapsedIds: Set<string>,
 *            sizes: Record<string,{w:number,h:number}>}}
 */
export function parseNodeLayout(layout) {
	const positions = {};
	const collapsedIds = new Set();
	const sizes = {};

	if (!layout || typeof layout !== 'object') return { positions, collapsedIds, sizes };

	for (const [id, v] of Object.entries(layout)) {
		if (!v || typeof v !== 'object') continue;

		if (finite(v.x) && finite(v.y)) positions[id] = { x: Number(v.x), y: Number(v.y) };
		if (v.collapsed === true) collapsedIds.add(id);

		const w = Number(v.w);
		const h = Number(v.h);
		if (finite(v.w) && finite(v.h) && w > 0 && h > 0) sizes[id] = { w, h };
	}

	return { positions, collapsedIds, sizes };
}
