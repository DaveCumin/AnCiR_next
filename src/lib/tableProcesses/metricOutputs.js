// @ts-nocheck
// Shared reconcile for scalar-METRIC output columns (the "stored values as
// output ports" model): each metric out-key holds a column with one value per
// y input, in yIN order, written by the node's engine func via
// writeOutputColumn. This helper owns the CREATE/REMOVE side — keeping
// `p.args.out` in sync with the metric keys the node currently wants — so
// nodes don't hand-roll it (see .claude/skills/ancir-new-node).
//
// Call it from onMount (backfills sessions saved before a node had metric
// ports) or from a microtask-deferred $effect (model/analysis switches).
// NEVER call it synchronously inside an $effect: it constructs Columns, whose
// $derived fields go inert when created under an active reaction
// (Svelte derived_inert).
import { Column, getColumnById, removeColumn } from '$lib/core/Column.svelte';
import { core, pushObj } from '$lib/core/core.svelte.js';

/** True when the process is committed to the graph (free nodes have no parent). */
export function isCommittedTP(p) {
	return p?.id != null && (core.tableProcesses ?? []).some((tp) => tp.id === p.id);
}

/**
 * Reconcile a node's metric out-keys to `desiredKeys`.
 *
 * `managedPredicate(key)` decides which existing out-keys belong to this
 * metric family — only those are ever removed, so series outputs and other
 * families are never touched. Stale metric columns are deleted rather than
 * reused: when the metric SET changes (e.g. TrendFit linear → exponential)
 * the old metric's meaning is gone, and silently rebinding its consumers to a
 * different quantity would be worse than orphaning them.
 *
 * @param {object} p - the table process (`p.args.out` is mutated)
 * @param {string[]} desiredKeys - metric keys that should exist
 * @param {(key: string) => boolean} managedPredicate - which keys this family owns
 * @returns {boolean} true if anything changed (caller should recompute)
 */
export function syncMetricOutColumns(p, desiredKeys, managedPredicate) {
	if (!isCommittedTP(p)) return false;
	if (!p.args.out || typeof p.args.out !== 'object') p.args.out = {};
	let changed = false;

	const desired = new Set(desiredKeys);
	for (const key of Object.keys(p.args.out)) {
		if (!managedPredicate(key) || desired.has(key)) continue;
		const colId = p.args.out[key];
		if (colId != null && colId >= 0) {
			core.rawData.delete(colId);
			removeColumn(colId);
			if (p.parent && Array.isArray(p.parent.columnRefs)) {
				p.parent.columnRefs = p.parent.columnRefs.filter((id) => id !== colId);
			}
		}
		delete p.args.out[key];
		changed = true;
	}

	for (const key of desired) {
		if (Number(p.args.out[key]) >= 0 && getColumnById(p.args.out[key])) continue;
		const col = new Column({});
		// Same naming convention as the TableProcess constructor's out-key seeding.
		col.name = `${key}_${p.id}`;
		pushObj(col);
		if (p.parent && Array.isArray(p.parent.columnRefs)) {
			p.parent.columnRefs = [col.id, ...p.parent.columnRefs];
		}
		p.args.out[key] = col.id;
		changed = true;
	}

	return changed;
}
