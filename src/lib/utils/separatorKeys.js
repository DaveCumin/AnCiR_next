// Keyboard behaviour of a focusable resize handle: the WAI-ARIA window splitter
// (https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/). One rule for every splitter in
// the app (the data and control panel edges, the Table plot's and the preview table's column
// edges), so they all answer the same keys:
//
//   ArrowLeft / ArrowRight   move the edge one step (Shift: a big step)
//   Home / End               the smallest / largest size
//   Enter                    the default size, where the splitter has one
//
// The value is the size of the pane the splitter controls, in px. Which arrow GROWS it
// depends on the side the pane is on: a pane left of its edge grows to the right, a pane right
// of its edge (the control panel) grows to the left.

/** Default step sizes in px. */
export const SEPARATOR_STEP = 10;
export const SEPARATOR_BIG_STEP = 50;

/**
 * The size a key press asks for, clamped to [min, max], or null when the key is not a
 * splitter key (let it through).
 *
 * @param {{ key: string, shiftKey?: boolean, altKey?: boolean, ctrlKey?: boolean, metaKey?: boolean }} e
 * @param {{ value: number, min: number, max: number, grow?: 'right' | 'left',
 *   step?: number, bigStep?: number, defaultValue?: number | null }} opts
 * @returns {number | null}
 */
export function separatorKeyValue(e, opts) {
	const {
		value,
		min,
		max,
		grow = 'right',
		step = SEPARATOR_STEP,
		bigStep = SEPARATOR_BIG_STEP,
		defaultValue = null
	} = opts;
	// A modified key belongs to something else (a browser or app shortcut).
	if (e.altKey || e.ctrlKey || e.metaKey) return null;
	const clamp = (v) => Math.min(max, Math.max(min, Math.round(v)));
	const d = e.shiftKey ? bigStep : step;
	switch (e.key) {
		case 'ArrowRight':
			return clamp(value + (grow === 'right' ? d : -d));
		case 'ArrowLeft':
			return clamp(value + (grow === 'right' ? -d : d));
		case 'Home':
			return min;
		case 'End':
			return max;
		case 'Enter':
			return defaultValue == null ? null : clamp(defaultValue);
		default:
			return null;
	}
}
