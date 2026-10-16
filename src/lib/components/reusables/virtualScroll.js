// The scroll maths of VirtualList: which rows to render for a scroll position, and where.
//
// Browsers cap an element's height (about 17.9 million px in Firefox, 33.5 million in
// Chrome; taller is silently clamped), so a list of `total * itemHeight` px stops being
// scrollable to its end past a few hundred thousand rows: the last rows exist but no scroll
// position reaches them. Above MAX_SCROLL_HEIGHT the scrollable spacer is therefore held at
// that height and the scroll position is SCALED: a scrollTop that is a fraction f of the way
// down the spacer shows the rows a fraction f of the way down the list, so the first row is
// at the top at scrollTop 0 and the last row is at the bottom at the end of the scroll.
// Below the cap the mapping is the identity (one scroll px is one row px), as before.

/** The tallest spacer used, in px: under every browser's element-height cap. */
export const MAX_SCROLL_HEIGHT = 10_000_000;

/**
 * The rows to render and where to put them.
 *
 * @param {object} o
 * @param {number} o.scrollTop the container's scrollTop
 * @param {number} o.viewportH the container's visible height
 * @param {number} o.total number of rows
 * @param {number} o.itemHeight fixed row height in px
 * @param {number} [o.overscan] extra rows rendered above and below the visible ones
 * @param {number} [o.maxScrollHeight] the spacer cap (tests pass a small one)
 * @returns {{ spacerHeight: number, startIndex: number, endIndex: number, offsetY: number,
 *   scaled: boolean }} render rows [startIndex, endIndex) with the first at offsetY px
 *   from the top of the spacer
 */
export function scrollWindow({
	scrollTop,
	viewportH,
	total,
	itemHeight,
	overscan = 6,
	maxScrollHeight = MAX_SCROLL_HEIGHT
}) {
	const n = Math.max(0, Math.floor(total || 0));
	const h = itemHeight > 0 ? itemHeight : 1;
	const vh = Math.max(0, viewportH || 0);
	const fullHeight = n * h;
	const scaled = fullHeight > maxScrollHeight;
	const spacerHeight = scaled ? maxScrollHeight : fullHeight;

	// Where the top of the viewport is in the FULL list, in px.
	const top = Math.max(0, scrollTop || 0);
	let virtualTop = top;
	if (scaled) {
		const realRange = Math.max(1, spacerHeight - vh);
		const virtualRange = Math.max(0, fullHeight - vh);
		virtualTop = (Math.min(top, realRange) / realRange) * virtualRange;
	}

	const first = Math.floor(virtualTop / h);
	const startIndex = Math.min(n, Math.max(0, first - overscan));
	const visibleCount = Math.ceil(vh / h) + 1 + overscan * 2;
	const endIndex = Math.min(n, startIndex + visibleCount);
	// Row startIndex sits (startIndex * h - virtualTop) px from the viewport top, and the
	// viewport top is at scrollTop in the spacer. Unscaled this is just startIndex * h.
	const offsetY = scaled ? top + (startIndex * h - virtualTop) : startIndex * h;
	return { spacerHeight, startIndex, endIndex, offsetY, scaled };
}
