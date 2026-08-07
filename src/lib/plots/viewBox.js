// @ts-nocheck
// Drawing a plot at a size that is NOT the figure's size.
//
// A workflow-canvas node shows the plot in a box whose shape the user sets there, and that box
// has nothing to do with the figure's published dimensions. The canvas used to draw the plot at
// the FIGURE's size and CSS-scale it down, which is why a node could only be resized on the
// plot's own aspect ratio: any other shape letterboxed. A plot that lays out to the box instead
// can take any shape, and its axes and legend arrange for it.
//
// Each plot class declares its own `renderBox` / `viewWidth` / `viewHeight` / `fontScale` /
// `viewStyle` fields, because `$derived` has to be declared on the class. What lives HERE is the
// POLICY those fields share, so eleven plots cannot drift into eleven slightly different answers
// about how type should shrink.
//
// The usual shape, copied into a plot class as-is:
//
//     renderBox = $state(null);
//     viewWidth = $derived(this.renderBox?.w ?? this.parentBox.width);
//     viewHeight = $derived(this.renderBox?.h ?? this.parentBox.height);
//     fontScale = $derived(viewFontScale(this.renderBox, this.parentBox));
//     viewStyle = $derived(viewStyleFor(this.parentBox?.style, this.fontScale));
//
// `renderBox` is set by EmbeddedPlot while the canvas owns the render and CLEARED on teardown.
// It is safe as shared state only because the two views are mutually exclusive: +page.svelte
// mounts WorkflowEditor or PlotDisplay, never both. It is deliberately never serialised — it
// describes a view, not the figure, and the node's box size is already persisted separately in
// core.nodeLayout.

/** Never shrink type past this: it should degrade to a hint of itself, not vanish. */
export const MIN_FONT_SCALE = 0.2;

/**
 * How much to scale TYPE when drawing into `box` instead of at the figure's size.
 *
 * The SMALLER of the two ratios, so text cannot overflow the tighter dimension: a wide, short
 * node has width to spare and almost no height, and sizing type off the width would fill it
 * with labels. This also matches what the old scaled thumbnail did (`Math.min`), so a node
 * nobody has reshaped looks the same as it did before it could lay out at all.
 *
 * Capped at 1: a node BIGGER than the figure should show more plot, not bigger words.
 *
 * @param {{w: number, h: number}|null} box the view's size, or null to draw at figure size
 * @param {{width: number, height: number}|null} figure the plot's own box (`parentBox`)
 * @returns {number} 1 when drawing at figure size
 */
export function viewFontScale(box, figure) {
	const fw = figure?.width;
	const fh = figure?.height;
	if (!box || !(box.w > 0) || !(box.h > 0) || !(fw > 0) || !(fh > 0)) return 1;
	return Math.min(1, Math.max(MIN_FONT_SCALE, Math.min(box.w / fw, box.h / fh)));
}

/**
 * The figure style as a view needs it: the figure's own style, plus the type multiplier.
 *
 * Returns the style OBJECT UNCHANGED at scale 1, so the workspace passes exactly what it always
 * did and no downstream `$derived` sees a new object identity on every render.
 *
 * `fontScale` is not one of FIGURE_STYLE_FIELDS, so `normaliseFigureStyle` drops it: it can ride
 * down to the components that draw text, and can never reach a saved session or a style preset.
 */
export function viewStyleFor(style, fontScale) {
	if (!(fontScale > 0) || fontScale === 1) return style;
	return { ...style, fontScale };
}

/**
 * The figure's padding as a VIEW needs it.
 *
 * Padding is stored in the figure's own units, and it exists to make room for text: axis
 * labels, tick labels, a title. When a view draws the type at `fontScale`, the room that text
 * needs scales with it. Leaving padding alone made a 240px node spend ~40% of its width on
 * margins for labels drawn at half size.
 *
 * Multiplied, not re-measured. Re-measuring per view would be more exact but would mean a node
 * writing a figure property (see the `renderBox` guard in `autoScalePadding`), and the whole
 * point is that a node describes itself, not the figure.
 *
 * Returns the SAME object at scale 1, so the workspace path allocates nothing and no downstream
 * `$derived` sees a fresh identity on every read.
 */
export function scalePadding(padding, fontScale) {
	if (!padding || !(fontScale > 0) || fontScale === 1) return padding;
	return {
		top: padding.top * fontScale,
		right: padding.right * fontScale,
		bottom: padding.bottom * fontScale,
		left: padding.left * fontScale
	};
}
