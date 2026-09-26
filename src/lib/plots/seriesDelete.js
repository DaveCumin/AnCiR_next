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
 * The shared recording mechanism, with no toast: apply `mutate(inner)` (a direct
 * in-place edit) to a plot's inner data object as ONE undoable history step.
 * Series delete (here) and series reorder (seriesReorder.js) both record
 * through this; only the mutation and the feedback differ.
 *
 * @param {any} inner the plot's inner data object (`theData` in a plot's controls
 *   snippet) — must carry `parentBox` (the wrapper Plot)
 * @param {(inner: any) => void} mutate performs the edit directly on `inner`
 * @returns {{ recorded: any } | null} the history entry the edit produced, or null
 *   when nothing changed. When the plot type has no fromJSON contract (or the inner
 *   is stale) the mutation is applied directly and `recorded` is null.
 */
export function recordInnerEdit(inner, mutate) {
	const plotObj = inner?.parentBox;
	const entry = plotObj && appConsts.plotMap.get(plotObj.type);
	if (typeof entry?.data?.fromJSON !== 'function' || plotObj.plot !== inner) {
		// No round-trip contract to record through (or a stale inner): fall back to
		// the old direct edit rather than corrupting history.
		mutate(inner);
		return { recorded: null };
	}

	const before = serializeInner(inner);
	mutate(inner);
	const after = serializeInner(plotObj.plot);
	if (JSON.stringify(before) === JSON.stringify(after)) return null; // nothing changed

	// Revert the direct mutation, then route the after-state through the op so the
	// edit lands on the undo stack as a single step. fromJSON rebuilds plot.plot
	// (a $state field, so the swap is reactive and the facet panel projection / metric
	// outputs re-run off it exactly as they do for a wiring edit).
	plotObj.plot = entry.data.fromJSON(plotObj, before);
	mutationService.setPlotInner(plotObj.id, after);

	// Read the entry back from the $state stack so later `===` checks compare the
	// same proxy (state_proxy_equality_mismatch otherwise).
	return { recorded: history.undoStack[history.undoStack.length - 1] };
}

/**
 * Apply `mutate(inner)` (a direct in-place removal) to a plot's inner data object
 * as ONE undoable step, then toast `message` with an Undo action. Series and
 * overlays both delete through here; only the mutation and the wording differ.
 *
 * @param {any} inner the plot's inner data object (`theData` in a plot's controls
 *   snippet) — must carry `parentBox` (the wrapper Plot)
 * @param {(inner: any) => void} mutate performs the removal directly on `inner`
 * @param {string} message the toast text, e.g. `Series "activity" removed`
 */
export function removeFromInnerWithUndo(inner, mutate, message) {
	const result = recordInnerEdit(inner, mutate);
	if (!result || !result.recorded) return; // nothing removed, or the direct fallback
	const { recorded } = result;
	const isTop = () =>
		recorded != null && history.undoStack[history.undoStack.length - 1] === recorded;

	addNotification(message, 'info', TOAST_MS, {
		label: 'Undo',
		enabled: isTop,
		run: () => {
			if (isTop()) history.undo();
		}
	});
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
	removeFromInnerWithUndo(inner, (i) => i.removeData(index), `Series "${name}" removed`);
}

/**
 * Remove the overlay (reference line / band) with `id` from a scatterplot's
 * inner data object as ONE undoable step, with the same toast + Undo.
 *
 * @param {any} inner the plot's inner data object — must carry `parentBox`,
 *   `overlays` and `removeOverlay(id)`
 * @param {number} id the overlay's `id`
 */
export function removeOverlayWithUndo(inner, id) {
	const overlay = inner?.overlays?.find((o) => o.id === id);
	if (!overlay) return;
	const what = overlay.kind === 'band' ? 'Band' : 'Line';
	removeFromInnerWithUndo(inner, (i) => i.removeOverlay(id), `${what} "${overlay.name}" removed`);
}
