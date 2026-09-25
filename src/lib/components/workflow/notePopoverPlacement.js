// Viewport placement for the per-node note popover (NodeNoteButton.svelte).
//
// The popover is portalled to <body> and positioned with `position: fixed`, so
// every coordinate here is a viewport coordinate (getBoundingClientRect space).
// Pure function so the flip/clamp rules are unit-testable without a DOM.

export const NOTE_POPOVER_GAP = 6;
export const NOTE_POPOVER_MARGIN = 8;

/**
 * @param {{top:number,bottom:number,left:number,right:number}} anchor
 *   The badge's viewport rect.
 * @param {{width:number,height:number}} size  The popover's rendered size.
 * @param {{width:number,height:number}} viewport  window.innerWidth/innerHeight.
 * @returns {{top:number,left:number,placement:'below'|'above'}}
 */
export function placeNotePopover(anchor, size, viewport) {
	const gap = NOTE_POPOVER_GAP;
	const margin = NOTE_POPOVER_MARGIN;

	// Prefer opening below the badge, left-aligned with it (the badge sits at the
	// LEFT of every header that hosts it, so growing rightwards keeps the popover
	// over the node/plot it belongs to).
	let top = anchor.bottom + gap;
	let placement = /** @type {'below'|'above'} */ ('below');
	const fitsBelow = top + size.height <= viewport.height - margin;
	const fitsAbove = anchor.top - gap - size.height >= margin;
	if (!fitsBelow && fitsAbove) {
		top = anchor.top - gap - size.height;
		placement = 'above';
	}

	let left = anchor.left;
	const maxLeft = viewport.width - margin - size.width;
	if (left > maxLeft) left = maxLeft;
	if (left < margin) left = margin;

	const maxTop = viewport.height - margin - size.height;
	if (top > maxTop) top = maxTop;
	if (top < margin) top = margin;

	return { top: Math.round(top), left: Math.round(left), placement };
}
