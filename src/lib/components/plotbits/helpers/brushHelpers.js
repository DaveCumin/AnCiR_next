// brushHelpers.js
//
// Pure geometry for the plot brush-zoom gesture. Converts a pixel rectangle
// (drawn over the plot area, in the plot's own user-unit coordinates) into the
// data-space axis limits that a zoom should apply. Kept free of Svelte/DOM so it
// can be unit-tested against plain d3 scales.

/**
 * Coerce a d3 `scale.invert()` result into a stored numeric limit. Time scales
 * (scaleUtc/scaleTime) invert to a Date; linear/log scales invert to a number.
 * The plot stores limits as numbers (ms for time axes), so normalise here.
 * @param {number|Date} v
 * @returns {number}
 */
export function toLimitNumber(v) {
	return v instanceof Date ? v.getTime() : v;
}

/**
 * Compute new axis limits from a brushed pixel rectangle.
 *
 * The rectangle is given in plot-area local pixels where (0,0) is the top-left
 * of the plotting region: x grows right across `[0, plotwidth]`, y grows down
 * across `[0, plotheight]`. X uses a single shared scale; Y is inverted per the
 * usual SVG convention, and the left/right axes invert independently so the same
 * pixel band zooms each axis to whatever is visually inside the box.
 *
 * @param {{x0:number,y0:number,x1:number,y1:number}} px  raw corners (any order)
 * @param {{xScale:any, yScaleLeft?:any, yScaleRight?:any}} scales
 * @returns {{xlims:[number,number], ylimsLeft:([number,number]|null), ylimsRight:([number,number]|null)}}
 */
export function limitsFromBrush(px, scales) {
	const { xScale, yScaleLeft, yScaleRight } = scales;
	const pxLeft = Math.min(px.x0, px.x1);
	const pxRight = Math.max(px.x0, px.x1);
	const pxTop = Math.min(px.y0, px.y1);
	const pxBottom = Math.max(px.y0, px.y1);

	const xa = toLimitNumber(xScale.invert(pxLeft));
	const xb = toLimitNumber(xScale.invert(pxRight));
	const xlims = /** @type {[number,number]} */ ([Math.min(xa, xb), Math.max(xa, xb)]);

	const yFor = (scale) => {
		if (!scale) return null;
		const a = toLimitNumber(scale.invert(pxTop));
		const b = toLimitNumber(scale.invert(pxBottom));
		return /** @type {[number,number]} */ ([Math.min(a, b), Math.max(a, b)]);
	};

	return { xlims, ylimsLeft: yFor(yScaleLeft), ylimsRight: yFor(yScaleRight) };
}

/**
 * Is the brushed box big enough to act on? Guards against a click or a hairline
 * drag zooming to a degenerate domain. Threshold is in plot user-units; either
 * dimension clearing it is enough (a thin tall box = an x-range zoom).
 * @param {{x0:number,y0:number,x1:number,y1:number}} px
 * @param {number} [minPx]
 * @returns {boolean}
 */
export function brushIsSignificant(px, minPx = 3) {
	return Math.abs(px.x1 - px.x0) >= minPx || Math.abs(px.y1 - px.y0) >= minPx;
}
