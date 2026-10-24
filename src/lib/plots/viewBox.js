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
 * A view's own measured FLOOR (fitViewPadding, below) raises a side the scaled figure padding
 * leaves too small for what the view draws. The figure padding is measured in the workspace
 * (autoPadWhenDrawn); a session opened straight into the canvas (every demo) still carries the
 * padding it was saved with, so a node scaled THAT and clipped its axis titles (the Join Data
 * demo's left title was half cut off). The floor is the view's, never the figure's.
 *
 * Returns the SAME object at scale 1 with no floor, so the workspace path allocates nothing and
 * no downstream `$derived` sees a fresh identity on every read. Otherwise returns a
 * write-through view (below).
 *
 * @param {object} padding the stored figure padding
 * @param {number} fontScale
 * @param {Partial<Record<'top'|'right'|'bottom'|'left', number>>|null} [floor] view px per side
 */
export function scalePadding(padding, fontScale, floor = null) {
	const scaled = fontScale > 0 && fontScale !== 1;
	if (!padding || (!scaled && !floor)) return padding;
	const side = (name) => {
		const chrome = AXIS_CHROME[name];
		const value = padding[name] ?? 0;
		// A padding already smaller than the chrome is left alone rather than grown: the caller
		// asked for less room than the ticks need, and this is not the place to overrule them.
		const view = !scaled || value <= chrome ? value : chrome + (value - chrome) * fontScale;
		const min = floor?.[name];
		return Number.isFinite(min) && min > view ? min : view;
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
 * The floor a view measured for its padding (fitViewPadding), while it is for the box the view
 * is drawn at now: a floor measured for one node size is not applied to another (an export
 * drawn at its own size, a resize not yet re-measured), and none without a box.
 *
 * @param {{box: {w: number, h: number}, sides: object}|null} stored the class's `viewPadFloor`
 * @param {{w: number, h: number}|null} renderBox
 */
export function viewPadFloorFor(stored, renderBox) {
	if (!stored || !renderBox) return null;
	return stored.box?.w === renderBox.w && stored.box?.h === renderBox.h ? stored.sides : null;
}

/**
 * The air every plot's getAutoScaleValues adds past its outermost axis text, at full size (6 px
 * on the left, right and top, 12 px under the x axis). A view shrinks it with its type, as it
 * does the rest of the axis chrome, so a node is not left with a full-size margin.
 */
const AUTO_PAD_BUFFER = { top: 6, right: 6, bottom: 12, left: 6 };

/**
 * How far the text a plot drew runs past its SVG's edges, per side, in view px (0 where none
 * does). For a plot that places its labels itself (the correlation heatmap and pairs plot's
 * variable names, the CWT's key), the general measure of a margin too small for its text.
 * @param {{parentBox?: {id: unknown}, viewWidth?: number}} plot
 */
export function textOverflow(plot) {
	const root =
		typeof document === 'undefined' ? null : document.getElementById('plot' + plot?.parentBox?.id);
	if (!root) return null;
	const r = root.getBoundingClientRect();
	const userWidth = Number(root.getAttribute('width')) || plot.viewWidth;
	if (!(r.width > 0) || !(userWidth > 0)) return null;
	const scale = r.width / userWidth;
	const over = { top: 0, right: 0, bottom: 0, left: 0 };
	for (const t of root.querySelectorAll('text')) {
		const b = t.getBoundingClientRect();
		if (!(b.width > 0) || !t.textContent.trim()) continue;
		over.left = Math.max(over.left, (r.left - b.left) / scale);
		over.right = Math.max(over.right, (b.right - r.right) / scale);
		over.top = Math.max(over.top, (r.top - b.top) / scale);
		over.bottom = Math.max(over.bottom, (b.bottom - r.bottom) / scale);
	}
	return over;
}

/** Room kept between text a view had to make room for and the view's edge, px. */
const OVERFLOW_AIR = 2;

/**
 * Measure what a VIEW (a workflow node: the plot drawn at `renderBox`) needs on each side for
 * the text it drew, and keep it as the view's padding floor (`viewPadFloor`, never saved, never
 * the figure's padding). Returns whether the floor changed (the plot then redraws, and is
 * measured again).
 *
 * A plot with axes measures them itself (getAutoScaleValues, the measurement autoScalePadding
 * uses in the workspace, in view units): the floor is the room its axes need. Any other plot
 * places its own labels, so the floor only grows a side its text runs past (textOverflow) by
 * that much, and is otherwise kept, so it settles once nothing is cut off.
 *
 * @param {{renderBox?: object|null, viewPadFloor?: object|null, padding?: object,
 *   fontScale?: number, getAutoScaleValues?: () => object}} plot
 */
export function fitViewPadding(plot) {
	const box = plot?.renderBox;
	if (!box || !('viewPadFloor' in plot)) return false;
	const sides = {};
	if (typeof plot.getAutoScaleValues === 'function') {
		const need = plot.getAutoScaleValues();
		const fs = Math.min(1, plot.fontScale > 0 ? plot.fontScale : 1);
		for (const name of ['top', 'right', 'bottom', 'left']) {
			if (!(Number.isFinite(need?.[name]) && need[name] > 0)) continue;
			sides[name] = Math.max(0, need[name] - AUTO_PAD_BUFFER[name] * (1 - fs));
		}
	} else {
		const over = textOverflow(plot);
		if (!over) return false;
		const kept = viewPadFloorFor(plot.viewPadFloor, box) ?? {};
		for (const name of ['top', 'right', 'bottom', 'left']) {
			const now = plot.padding?.[name] ?? 0;
			if (over[name] > 0.5) sides[name] = Math.ceil(now + over[name] + OVERFLOW_AIR);
			else if (kept[name] != null) sides[name] = kept[name];
		}
	}
	const next = { box: { w: box.w, h: box.h }, sides };
	if (JSON.stringify(next) === JSON.stringify(plot.viewPadFloor)) return false;
	plot.viewPadFloor = next;
	return true;
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
