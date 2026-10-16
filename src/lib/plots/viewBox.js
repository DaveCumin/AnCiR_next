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

import { tick } from 'svelte';

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
 * Padding held back from scaling: the room the tick marks and the tick-to-label gap take at
 * full size (6 + 4 px on the sides that carry ticks and labels; a token amount for a stroke and
 * a little air on top and right).
 *
 * Axis.svelte used to draw that chrome at fixed pixel sizes in every view, which is why it had
 * to be held back here. It now shrinks it with the type (plotbits/axisLayout.js axisChrome),
 * so everything an axis draws needs `fontScale` times its full-size room, and the held-back
 * pixels are a small extra margin in a node rather than a requirement. Kept so a node's plot
 * area, and everything pinned to it, did not move when the axis started scaling.
 */
const AXIS_CHROME = { top: 4, right: 4, bottom: 10, left: 10 };

/**
 * The figure's padding as a VIEW needs it.
 *
 * Padding is stored in the figure's own units and exists mostly to make room for TEXT: axis
 * labels, tick labels, a title. When a view draws the type at `fontScale`, the room that text
 * needs scales with it. Leaving padding alone made a 240px node spend ~40% of its width on
 * margins for labels drawn at half size.
 *
 * ONLY THE TEXT-DEPENDENT PART SCALES. Scaling the whole thing was the first attempt and it
 * clipped: at fontScale 0.48 a "20,000" tick label measured 25.4px and the axis needed 35.4px
 * of room (label + 6px tick + 4px gap), but a figure padding of 72 scaled to 34.56. The tick
 * and the gap were fixed pixels then, so squeezing them proportionally left the labels hanging
 * off the left edge, where the node's `overflow: hidden` cut them in half. Holding the chrome
 * back and scaling only the remainder gives 10 + 62 × 0.48 = 39.8, which fits. (The axis title
 * still clipped until its buffer and the tick chrome scaled too; see AXIS_CHROME above.)
 *
 * Multiplied, not re-measured. Re-measuring per view would be more exact but would mean a node
 * writing a figure property (see the `renderBox` guard in `autoScalePadding`), and the whole
 * point is that a node describes itself, not the figure.
 *
 * Returns the SAME object at scale 1, so the workspace path allocates nothing and no downstream
 * `$derived` sees a fresh identity on every read. Otherwise returns a write-through view (below).
 */
export function scalePadding(padding, fontScale) {
	if (!padding || !(fontScale > 0) || fontScale === 1) return padding;
	const side = (name) => {
		const chrome = AXIS_CHROME[name];
		const value = padding[name] ?? 0;
		// A padding already smaller than the chrome is left alone rather than grown: the caller
		// asked for less room than the ticks need, and this is not the place to overrule them.
		if (value <= chrome) return value;
		return chrome + (value - chrome) * fontScale;
	};
	// A live VIEW of `padding`, not a snapshot: each side reads the stored value when asked (so
	// it stays reactive through the store's proxy) and an assignment writes the FIGURE value
	// through. Anything that writes `plot.padding.top = v` while a node view is mounted (the
	// shared multi-plot panel, an AI edit, a facet override) therefore changes the stored figure
	// padding instead of a throwaway copy.
	return {
		get top() {
			return side('top');
		},
		set top(v) {
			padding.top = v;
		},
		get right() {
			return side('right');
		},
		set right(v) {
			padding.right = v;
		},
		get bottom() {
			return side('bottom');
		},
		set bottom(v) {
			padding.bottom = v;
		},
		get left() {
			return side('left');
		},
		set left(v) {
			padding.left = v;
		}
	};
}

/**
 * Measure a figure's automatic padding (`plot.autoScalePadding('all')`) once the plot's draw
 * has settled, for a plot component's `onMount`. Returns the cleanup.
 *
 * Measuring once, IN onMount, read a drawing that was about to change. After a switch from the
 * canvas to the workspace, an axis's first draw places its title from tick labels measured
 * while the view was still being set up (a Scatterplot's x title at y = 37 instead of 38), and
 * the padding measured from that came out short (bottom 51 instead of 53). The new padding
 * redraws the axis, correctly this time, but nothing measured again until the control panel
 * opened (its effect re-measures). That moved the plot area and every automatic limit with
 * it: demo-process-add's auto Y min read -0.955752, then -0.964286 once the panel was open,
 * so cancelling an edit there looked as if it had changed the plot.
 *
 * So: measure after the draw has landed, and again after each redraw the new padding causes,
 * until it stops changing (a few passes at most; one or two in practice).
 *
 * @param {{ autoScalePadding?: (side: string) => void, figurePadding?: object, padding?: object }} plot
 * @param {{ maxPasses?: number }} [opts]
 * @returns {() => void}
 */
export function autoPadWhenDrawn(plot, { maxPasses = 4 } = {}) {
	let live = true;
	const stored = () => JSON.stringify(plot?.figurePadding ?? plot?.padding ?? null);
	const pass = (left) =>
		tick().then(() => {
			if (!live || typeof plot?.autoScalePadding !== 'function') return;
			const before = stored();
			plot.autoScalePadding('all');
			if (left > 1 && stored() !== before) return pass(left - 1);
		});
	pass(maxPasses);
	return () => {
		live = false;
	};
}
