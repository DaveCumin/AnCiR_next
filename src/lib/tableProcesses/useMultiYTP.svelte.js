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

	// True once `p` is a real, committed TableProcess (has an id and is in
	// core.tableProcesses). The MakeNewColumn modal mounts the component against a
	// plain `{ name, args }` preview object with no id — we must NOT create output
	// columns in that context (they'd leak as orphan data nodes).
	function isCommitted() {
		return p?.id != null && (core.tableProcesses ?? []).some((tp) => tp.id === p.id);
	}

	// Create one output column for a Y input and return its id. Free-standing
	// table processes have no `parent`, so outputs live directly in core.data
	// (matching the TableProcess constructor). The legacy Table model kept a
	// `parent.columnRefs` list — still maintained when a parent is present so old
	// sessions keep working.
	function makeYColumn(yId) {
		const srcName = getColumnById(Number(yId))?.name ?? String(yId);
		const yCol = new Column({});
		yCol.name = yColNamePrefix + srcName;
		pushObj(yCol);
		if (p.parent && Array.isArray(p.parent.columnRefs)) {
			p.parent.columnRefs = [yCol.id, ...p.parent.columnRefs];
		}
		return yCol.id;
	}

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

		// Only materialise output columns for a COMMITTED table process (has an
		// id and lives in core.tableProcesses). In the MakeNewColumn modal the
		// component is mounted against a plain preview object with no id — creating
		// columns there leaks orphan data nodes (the TableProcess constructor
		// creates the real outputs on commit). We still report the change so the
		// preview recomputes.
		if (isCommitted()) {
			const removed = prevYIds.filter((id) => !newSet.has(id));
			const added = newIds.filter((id) => !oldSet.has(id));

			// Reuse-on-replace: transfer a removed Y's output column to a newly
			// added Y (rename it) instead of deleting one and minting another. This
			// keeps the output column *id* stable across an in-place Y swap — e.g.
			// when a node is spliced upstream, changing yIN from A to B — so any
			// downstream consumer wired to this output (a plot, another node) stays
			// connected instead of being orphaned.
			const reuseCount = Math.min(removed.length, added.length);
			for (let i = 0; i < reuseCount; i++) {
				const oldKey = yPrefix + removed[i];
				const colId = p.args.out[oldKey];
				delete p.args.out[oldKey];
				if (colId != null && colId >= 0) {
					p.args.out[yPrefix + added[i]] = colId;
					const col = getColumnById(colId);
					if (col) col.name = yColNamePrefix + (getColumnById(added[i])?.name ?? added[i]);
				}
			}

			// Delete leftover removed Ys that had no reuse target.
			for (let i = reuseCount; i < removed.length; i++) {
				const outKey = yPrefix + removed[i];
				const outColId = p.args.out[outKey];
				if (outColId != null && outColId >= 0) {
					core.rawData.delete(outColId);
					removeColumn(outColId);
				}
				delete p.args.out[outKey];
			}

			// Ensure every currently-selected Y has an output column (covers added
			// Ys with no reuse source, and any pre-existing Y missing a column).
			for (const newId of newIds) {
				const outKey = yPrefix + newId;
				if (p.args.out[outKey] == null || p.args.out[outKey] === -1) {
					p.args.out[outKey] = makeYColumn(newId);
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
		// Skip in the modal/preview context — only a committed TP materialises
		// outputs (the constructor handles the committed case up-front).
		if (!isCommitted()) {
			prevYIds = [...(p.args.yIN ?? [])].map(Number);
			return false;
		}
		let needsCompute = false;
		for (const yId of p.args.yIN ?? []) {
			const outKey = yPrefix + yId;
			if (p.args.out[outKey] == null || p.args.out[outKey] === -1) {
				p.args.out[outKey] = makeYColumn(yId);
				needsCompute = true;
			}
		}
		// Sync prevYIds to the current state after init.
		prevYIds = [...(p.args.yIN ?? [])].map(Number);
		return needsCompute;
	}

	return { syncYColumns, initYColumns };
}
