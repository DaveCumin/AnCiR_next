// Where the workspace selection toolbar sits (PlotDisplay.svelte): the layout toolbar of
// two or more selected plots (one plot's own actions are docked in its card's header,
// Draggable.svelte).
//
// The toolbar is anchored to the selection, like Figma: right-aligned with the selection's
// right edge and just above its top. All rects are in one coordinate space (PlotDisplay
// uses the canvas element's own box, so the view's origin is 0,0) as
// { left, top, right, bottom }.
//
// It is never placed over the selection, where it would cover the plots' legends and data
// (it used to drop inside the top-right corner when there was no room above). Order of
// preference:
//   1. above: just above the selection's top-right corner, when there is room above.
//   2. below: just under the selection's bottom edge.
//   3. right: beside the selection's right edge, level with its top (or the view's).
//   4. left: beside its left edge.
//   5. otherwise (the selection fills the view): clamped to the view's top.
// Above and below are clamped horizontally inside the view; then the toolbar is nudged off
// any occluder (a card such as the zoom controls) by moving left, or up when moving left
// has no room.

/** Default gap between the toolbar and the thing it is anchored to, in px. */
export const TOOLBAR_GAP = 8;
/** Minimum distance kept from the view's edges, in px. */
export const VIEW_MARGIN = 8;

const intersects = (a, b) =>
	a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * The bounding box of several rects, or null when there are none.
 *
 * @param {Array<{left:number, top:number, right:number, bottom:number}>} rects
 */
export function unionRect(rects) {
	if (!rects?.length) return null;
	return {
		left: Math.min(...rects.map((r) => r.left)),
		top: Math.min(...rects.map((r) => r.top)),
		right: Math.max(...rects.map((r) => r.right)),
		bottom: Math.max(...rects.map((r) => r.bottom))
	};
}

/**
 * @param {object} args
 * @param {{left:number, top:number, right:number, bottom:number}} args.selection
 * @param {{left:number, top:number, right:number, bottom:number}} args.view
 * @param {{width:number, height:number}} args.toolbar
 * @param {Array<{left:number, top:number, right:number, bottom:number}>} [args.occluders]
 * @param {number} [args.gap]
 * @param {number} [args.margin]
 * @returns {{left:number, top:number, placement:'above'|'below'|'right'|'left'|'clamped', visible:boolean}}
 */
export function placeSelectionToolbar({
	selection,
	view,
	toolbar,
	occluders = [],
	gap = TOOLBAR_GAP,
	margin = VIEW_MARGIN
}) {
	const w = toolbar.width;
	const h = toolbar.height;
	const minLeft = view.left + margin;
	const maxLeft = view.right - margin - w;
	const minTop = view.top + margin;
	const maxTop = view.bottom - margin - h;

	// A selection wholly outside the view has nothing to point at.
	const visible = intersects(selection, view);

	// Right-aligned with the selection, kept inside the view.
	const alignedLeft = clampLeft(selection.right - w, minLeft, maxLeft);
	// Beside the selection, level with its top (or the view's top when that has scrolled away).
	const besideTop = Math.min(Math.max(selection.top, minTop), maxTop);

	let top;
	let left = alignedLeft;
	let placement;
	const aboveTop = selection.top - gap - h;
	const belowTop = selection.bottom + gap;
	const rightLeft = selection.right + gap;
	const leftLeft = selection.left - gap - w;
	if (aboveTop >= minTop) {
		top = aboveTop;
		placement = 'above';
	} else if (belowTop <= maxTop) {
		top = belowTop;
		placement = 'below';
	} else if (rightLeft <= maxLeft) {
		top = besideTop;
		left = rightLeft;
		placement = 'right';
	} else if (leftLeft >= minLeft) {
		top = besideTop;
		left = leftLeft;
		placement = 'left';
	} else {
		top = Math.min(Math.max(aboveTop, minTop), maxTop);
		placement = 'clamped';
	}

	for (const occ of occluders) {
		const box = { left, top, right: left + w, bottom: top + h };
		if (!intersects(box, occ)) continue;
		const shifted = occ.left - gap - w;
		if (shifted >= minLeft) left = shifted;
		else top = Math.max(minTop, occ.top - gap - h);
	}

	return { left: Math.round(left), top: Math.round(top), placement, visible };
}

function clampLeft(left, minLeft, maxLeft) {
	// A view narrower than the toolbar keeps the toolbar's left edge in view.
	if (maxLeft < minLeft) return minLeft;
	return Math.min(Math.max(left, minLeft), maxLeft);
}
