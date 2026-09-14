// Delete one series from a plot, UNDOABLY, with a toast that offers the undo.
//
// The one shared implementation behind every plot's per-series trash button. The
// buttons used to call `theData.removeData(i)` directly, which bypassed the op layer
// entirely: deletion was the only Data-tab wiring edit that was NOT undoable, and its
// only feedback was a 500ms slide-out.
//
// HOW IT RECORDS (the recordPlotEdit pattern, see WorkflowEditor.svelte)
//
// Plot series live inside the plot's inner data object (plot.plot), which wiring
// edits already make undoable by snapshotting the whole inner through the
// `setPlotInner` op: snapshot before, mutate in place, snapshot after, revert, then
// replay the after-state through the op. Deletion is exactly such an edit, so it uses
// exactly that mechanism — the restore payload is the inner's own toJSON snapshot,
// the same contract session save/load relies on, so undo rebuilds the series with its
// column wiring (refIds), styling, position and label all intact. Colour pinning
// survives because the identity map (core.seriesAppearance) is keyed by COLUMN id and
// is never touched here: the restored series resolves to the record it already had.
//
// THE TOAST'S UNDO TARGETS THE TOP OF THE STACK, OR HIDES
//
// The Undo button captures the history entry this delete produced and calls the
// global `history.undo()` only while that entry is still the top of the undo stack.
// Anything else would be dishonest: the history is strictly linear, so once another
// op lands on top, undoing "just the delete" would first have to undo that newer op
// too. Rather than surprise the user with a multi-step rollback (or silently reorder
// history), the button simply disappears — `enabled` reads the reactive stack, so the
// hide happens live while the toast is showing. Ctrl+Z still works, of course; the
// delete stays on the stack either way.
import { appConsts } from '$lib/core/core.svelte';
import { mutationService } from '$lib/core/mutationService.js';
import { history } from '$lib/core/opHistory.svelte.js';
import { addNotification } from '$lib/core/notifications.svelte.js';
import { seriesDisplayLabel } from '$lib/components/plotbits/helpers/seriesLabel.js';

const TOAST_MS = 6000;

function serializeInner(inner) {
	return JSON.parse(JSON.stringify(inner, (k, v) => (typeof v === 'function' ? undefined : v)));
}

/**
 * Remove series `index` from a plot's inner data object as ONE undoable step,
 * then toast the removal with an Undo action.
 *
 * @param {any} inner the plot's inner data object (`theData` in a plot's controls
 *   snippet) — must carry `parentBox` (the wrapper Plot) and `removeData(i)`
 * @param {number} index position of the series in `inner.data`
 */
export function removeSeriesWithUndo(inner, index) {
	const datum = inner?.data?.[index];
	if (!datum) return;
	const name = seriesDisplayLabel(datum);

	const plotObj = inner.parentBox;
	const entry = plotObj && appConsts.plotMap.get(plotObj.type);
	if (typeof entry?.data?.fromJSON !== 'function' || plotObj.plot !== inner) {
		// No round-trip contract to record through (or a stale inner): fall back to
		// the old direct removal rather than corrupting history.
		inner.removeData(index);
		return;
	}

	const before = serializeInner(inner);
	inner.removeData(index);
	const after = serializeInner(plotObj.plot);
	if (JSON.stringify(before) === JSON.stringify(after)) return; // nothing removed

	// Revert the direct mutation, then route the after-state through the op so the
	// deletion lands on the undo stack as a single step. fromJSON rebuilds plot.plot
	// (a $state field, so the swap is reactive and facet reconcile / metric outputs
	// re-run off it exactly as they do for a wiring edit).
	plotObj.plot = entry.data.fromJSON(plotObj, before);
	mutationService.setPlotInner(plotObj.id, after);

	// Read the entry back from the $state stack so later `===` checks compare the
	// same proxy (state_proxy_equality_mismatch otherwise).
	const recorded = history.undoStack[history.undoStack.length - 1];
	const isTop = () =>
		recorded != null && history.undoStack[history.undoStack.length - 1] === recorded;

	addNotification(`Series "${name}" removed`, 'info', TOAST_MS, {
		label: 'Undo',
		enabled: isTop,
		run: () => {
			if (isTop()) history.undo();
		}
	});
}
