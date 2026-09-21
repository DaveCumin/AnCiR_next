// Reorder a plot's series, UNDOABLY. The Data tab's drag handle and its Alt+Arrow
// keyboard path (SeriesBlockHeader.svelte) both land here.
//
// WHAT ORDER MEANS. A plot's series live in `inner.data`, and that one array is
// read for BOTH the legend (each class's getLegendItems walks `this.data`) AND the
// draw order (series are rendered in array order, so a later series draws on top
// of an earlier one). Reordering therefore changes both at once. This is the same
// coupling the Data-view Plots list has, where dragging a plot row changes its
// stacking order on the worksheet; there is no separate "legend order" to keep.
// The canvas node's `xN`/`ysN` series ports are also derived from this order
// (groupPlotData), so a reorder renumbers the series groups on the node; wires are
// recomputed from column refIds on every graph build, so they still resolve.
//
// HOW IT RECORDS. Exactly like series deletion (seriesDelete.js): the whole inner
// is snapshotted through its toJSON contract, mutated in place, reverted, and the
// after-state replayed through the `setPlotInner` op, so the move is one undo
// step and undo restores the previous order with every series' wiring, styling
// and label intact. Colour pinning lives in core.seriesAppearance keyed by COLUMN
// id and is never touched, so a moved series keeps its colour: the only series
// whose colour follows its POSITION is one with no wired column (palette-index
// fallback in resolveColour), and such a series draws nothing.
//
// Drop semantics mirror the Plots list: the moved series TAKES the target's
// position (splice out, splice in at `toIndex`), so dropping on the last block
// moves the series to the end.
import { recordInnerEdit } from './seriesDelete.js';

/**
 * Pure reorder: a new array with the item at `fromIndex` moved so it sits at
 * `toIndex` in the result. Returns null for a no-op or an invalid index, so
 * callers can skip recording without a second range check.
 *
 * @template T
 * @param {T[] | null | undefined} arr
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {T[] | null}
 */
export function reorderSeries(arr, fromIndex, toIndex) {
	if (!Array.isArray(arr)) return null;
	const n = arr.length;
	const valid = (i) => Number.isInteger(i) && i >= 0 && i < n;
	if (!valid(fromIndex) || !valid(toIndex) || fromIndex === toIndex) return null;
	const out = arr.slice();
	const [moved] = out.splice(fromIndex, 1);
	out.splice(toIndex, 0, moved);
	return out;
}

/**
 * Move series `fromIndex` of a plot's inner data object so it sits at `toIndex`,
 * as ONE undoable history step. Quiet on purpose (no toast): the move is visible
 * in the Data tab and on the plot, and Ctrl+Z reverts it, the same as a plot row
 * drag in the Data view.
 *
 * @param {any} inner the plot's inner data object (`theData` in a plot's controls
 *   snippet) — must carry `parentBox` (the wrapper Plot) and a `data` array
 * @param {number} fromIndex position of the series in `inner.data`
 * @param {number} toIndex position it should end up at
 * @returns {boolean} whether the order changed
 */
export function reorderSeriesWithUndo(inner, fromIndex, toIndex) {
	if (reorderSeries(inner?.data, fromIndex, toIndex) == null) return false;
	// Mutate in place (splice works on $state arrays and plain ones alike) so the
	// fallback path, where the type has no fromJSON, still reorders the live array.
	const result = recordInnerEdit(inner, (i) => {
		const [moved] = i.data.splice(fromIndex, 1);
		i.data.splice(toIndex, 0, moved);
	});
	return result != null;
}

/**
 * Keyboard step: move series `index` by `delta` positions (-1 up, +1 down).
 *
 * @returns {number | null} the series' new index, or null when the step would
 *   leave the array (nothing changes, nothing is recorded)
 */
export function moveSeriesWithUndo(inner, index, delta) {
	const target = index + delta;
	return reorderSeriesWithUndo(inner, index, target) ? target : null;
}
