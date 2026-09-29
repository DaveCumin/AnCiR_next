// Where the workspace selection toolbar sits (PlotDisplay.svelte).
//
// The toolbar is anchored to the selection, like Figma: right-aligned with the selection's
// right edge and just above its top. All rects are in one coordinate space (PlotDisplay
// uses the canvas element's own box, so the view's origin is 0,0) as
// { left, top, right, bottom }.
//
// Order of preference:
//   1. above: just above the selection's top-right corner, when there is room above.
//   2. inside: inside the selection, just under the header bands of the selected cards (so
//      it never covers a header's note / maximise / delete controls), when the selection
//      is tall enough. If the headers have scrolled above the view, it pins to the view's
//      top instead, still dropping below any header band it would land on.
//   3. below: just under the selection's bottom edge.
//   4. otherwise: clamped inside the view.
// Then it is clamped horizontally inside the view, and nudged off any occluder (a card
// such as the zoom controls) by moving left, or up when moving left has no room.

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
 * @param {Array<{left:number, top:number, right:number, bottom:number}>} [args.headers] the
 *   header bands of the selected cards; the inside placement never overlaps one
 * @param {number} [args.gap]
 * @param {number} [args.margin]
 * @returns {{left:number, top:number, placement:'above'|'inside'|'below'|'clamped', visible:boolean}}
 */
export function placeSelectionToolbar({
	selection,
	view,
	toolbar,
	occluders = [],
	headers = [],
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

	// Right-aligned with the selection; inside, it is inset by the gap so its border
	// does not sit on the selection's border.
	const outsideLeft = clampLeft(selection.right - w, minLeft, maxLeft);
	const insideLeft = clampLeft(selection.right - gap - w, minLeft, maxLeft);

	// Inside: start at the selection's top (or the view's), then step below every header
	// band the toolbar would overlap, top to bottom.
	let insideTop = Math.max(selection.top + gap, minTop);
	for (const band of [...headers].sort((a, b) => a.top - b.top)) {
		const box = { left: insideLeft, top: insideTop, right: insideLeft + w, bottom: insideTop + h };
		if (intersects(box, band)) insideTop = band.bottom + gap;
	}

	let top;
	let left = outsideLeft;
	let placement;
	const aboveTop = selection.top - gap - h;
	const belowTop = selection.bottom + gap;
	if (aboveTop >= minTop) {
		top = aboveTop;
		placement = 'above';
	} else if (insideTop + h <= Math.min(selection.bottom - gap, maxTop)) {
		top = insideTop;
		left = insideLeft;
		placement = 'inside';
	} else if (belowTop <= maxTop) {
		top = belowTop;
		placement = 'below';
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
