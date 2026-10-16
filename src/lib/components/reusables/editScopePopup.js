// @ts-nocheck
// Floating parts of a control that are moved to <body> (the colour picker's window, a column
// menu) still belong to the control they were opened from. An edit recorder that listens to
// the gestures inside one element (plots/plotEditScope.js) would not see events from a
// floating part, so the part names its anchor: the in-place element it was opened from.
//
//   markPopup(container, anchor)   when the part is floated
//   popupAnchor(target)            the anchor of the floating part `target` is in, or null

const ATTR = 'data-edit-scope-popup';
const anchors = new WeakMap();

/** Mark `container` (moved to <body>) as a floating part of the control at `anchor`. */
export function markPopup(container, anchor) {
	if (!container) return;
	container.setAttribute(ATTR, '');
	if (anchor) anchors.set(container, anchor);
}

/** The anchor of the floating part `target` is inside, or null when it is in none. */
export function popupAnchor(target) {
	const el = target?.nodeType === 1 ? target : target?.parentElement;
	const popup = el?.closest?.(`[${ATTR}]`);
	return popup ? (anchors.get(popup) ?? null) : null;
}
