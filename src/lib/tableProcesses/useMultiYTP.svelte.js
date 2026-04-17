// @ts-nocheck
/**
 * useMultiYTP — shared Y-column management composable for multi-Y table processes.
 *
 * Handles adding and removing output columns reactively as the user changes
 * the Y-input selection (p.args.yIN). Eliminates the ~30-line onYSelectionChange
 * copy-paste present in BinnedData, Cosinor, SmoothedData, TrendFit,
 * RectangularWave and DoubleLogistic.
 *
 * Usage (inside component <script>):
 *
 *   const { syncYColumns, initYColumns } = useMultiYTP(p, 'binnedy_', 'bin_');
 *
 *   // When user changes Y selection:
 *   function onYSelectionChange() {
 *     if (syncYColumns()) recalculate();
 *   }
 *
 *   // In onMount — create any missing Y output columns for pre-existing yIN:
 *   onMount(() => {
 *     const needsCompute = initYColumns();
 *     if (needsCompute) recalculate(); else loadExisting();
 *   });
 */

import { core } from '$lib/core/core.svelte';
import { Column, getColumnById, removeColumn } from '$lib/core/Column.svelte';
import { pushObj } from '$lib/core/core.svelte.js';

/**
 * @param {object} p             - the reactive TableProcess prop (must be $bindable)
 * @param {string} yPrefix       - output-key prefix for Y columns, e.g. 'binnedy_'
 * @param {string} yColNamePrefix - display-name prefix for created Y columns, e.g. 'bin_'
 */
export function useMultiYTP(p, yPrefix, yColNamePrefix) {
	// prevYIds is a plain mutable variable — no reactivity needed, just change-tracking.
	let prevYIds = [...(p.args.yIN ?? [])].map(Number);

	/**
	 * Reconcile output Y columns with the current p.args.yIN selection.
	 * - Removes rawData + Column for any Y that was deselected.
	 * - Creates a new output Column for any Y that was newly selected.
	 * Returns true when the set of Y IDs actually changed (caller should recompute).
	 */
	function syncYColumns() {
		const newIds = (p.args.yIN ?? []).map(Number).filter((id) => id >= 0);
		const newSet = new Set(newIds);
		const oldSet = new Set(prevYIds);

		// No change — return early so callers skip unnecessary recomputes.
		if (newIds.length === prevYIds.length && newIds.every((id) => oldSet.has(id))) return false;

		// Remove output columns for deselected Y inputs.
		for (const oldId of prevYIds) {
			if (!newSet.has(oldId)) {
				const outKey = yPrefix + oldId;
				const outColId = p.args.out[outKey];
				if (outColId != null && outColId >= 0) {
					core.rawData.delete(outColId);
					removeColumn(outColId);
				}
				delete p.args.out[outKey];
			}
		}

		// Create output columns for newly selected Y inputs.
		for (const newId of newIds) {
			const outKey = yPrefix + newId;
			if (p.args.out[outKey] == null || p.args.out[outKey] === -1) {
				if (p.parent) {
					const srcName = getColumnById(newId)?.name ?? String(newId);
					const yCol = new Column({});
					yCol.name = yColNamePrefix + srcName;
					pushObj(yCol);
					p.parent.columnRefs = [yCol.id, ...p.parent.columnRefs];
					p.args.out[outKey] = yCol.id;
				}
			}
		}

		prevYIds = [...newIds];
		return true;
	}

	/**
	 * Call this from onMount to create any output Y columns that are missing for
	 * Y inputs that were pre-set (e.g. when loading a saved session that had yIN
	 * populated before output columns were committed, or when used in collected mode).
	 * Returns true when at least one column was created (caller should recompute).
	 */
	function initYColumns() {
		let needsCompute = false;
		for (const yId of p.args.yIN ?? []) {
			const outKey = yPrefix + yId;
			if (p.args.out[outKey] == null || p.args.out[outKey] === -1) {
				if (p.parent) {
					const srcName = getColumnById(Number(yId))?.name ?? String(yId);
					const yCol = new Column({});
					yCol.name = yColNamePrefix + srcName;
					pushObj(yCol);
					p.parent.columnRefs = [yCol.id, ...p.parent.columnRefs];
					p.args.out[outKey] = yCol.id;
					needsCompute = true;
				}
			}
		}
		// Sync prevYIds to the current state after init.
		prevYIds = [...(p.args.yIN ?? [])].map(Number);
		return needsCompute;
	}

	return { syncYColumns, initYColumns };
}
