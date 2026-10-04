// @ts-nocheck
// Axis geometry that is not text: the tick marks, the gap between a tick and its label, and
// the buffer between the widest tick label and the axis title.
//
// Pure, so it can be tested without a browser, and the companion of legendLayout.legendChrome:
// a workflow-canvas node draws the plot at the node's size and shrinks the TYPE by its
// `fontScale` (plots/viewBox.js, carried on the view's style). These lengths must shrink by the
// same factor. At full size they took 26 px beside the tick labels on a plot whose padding a
// node had already scaled, so a y-axis title ("Count", "Magnitude") started a few px left of
// the node's edge and was clipped.

/** Length of a tick mark, in figure px. */
export const AXIS_TICK_LENGTH = 6;
/** Gap between a tick mark and its label, in figure px. */
export const AXIS_TICK_PADDING = 4;
/** Extra space between the widest tick label and the axis title, in figure px. */
export const AXIS_TITLE_BUFFER = 16;

/**
 * The axis's fixed-pixel geometry at a view scale.
 *
 * @param {number} [scale] the view's fontScale; 1 (or anything invalid) is the figure itself,
 *   where the values are exactly the constants above, so the workspace and exports are unchanged
 */
export function axisChrome(scale = 1) {
	const s = typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : 1;
	return {
		scale: s,
		tickLength: AXIS_TICK_LENGTH * s,
		tickPadding: AXIS_TICK_PADDING * s,
		titleBuffer: AXIS_TITLE_BUFFER * s
	};
}
