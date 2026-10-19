// @ts-nocheck
// The output display labels (review finding UI-4) bound to the live session. The tables and
// the resolution rules live in core/outputLabels.js; this file only supplies `core`, so the
// Data panel, column pickers, mini tables and table plots share one answer.
//
// For a list, build one namer per render (`const namer = $derived(columnNamer())`) and call
// `namer(col)`; for a single column, columnDisplayName(col). Both read core reactively.
import { core } from './core.svelte.js';
import { getColumnById } from './Column.svelte';
import { createColumnNamer } from './outputLabels.js';
import { applyOp } from './operations.js';

/** A `(col) => displayName` resolver over the current session. */
export function columnNamer() {
	return createColumnNamer(core);
}

/** The name to SHOW for one column (user name, else node output label, else its own name). */
export function columnDisplayName(col, namer) {
	if (!col) return '';
	return (namer ?? createColumnNamer(core))(col);
}

/**
 * The name to SHOW for any column-like value, wherever a column is labelled (plot legends,
 * series and axis labels, quick plot titles, node rows, result tables, stored-value names):
 *   - a node output reads its label ("amplitude", "Binned: temperature", "R²"), never its
 *     internal name (`joined_483_38`), unless someone renamed it;
 *   - a REFERENCE (a plot's wired series, a `{ refId }` wrapper) reads the referenced column's
 *     display name, without the `*` that Column.name adds to mark a reference; a name a person
 *     gave the wrapper itself (customName) still wins; a reference to nothing reads '';
 *   - a plain stand-in object (`{ name }`, used by tests and stubs) reads its name.
 * Column.name stays the stored identity (saved, matched by style presets, exported); this is
 * the one place that turns it into words.
 */
export function displayNameOf(col, namer, depth = 0) {
	if (!col) return '';
	if (typeof col.isReferencial !== 'function') return col.name ?? '';
	if (col.isReferencial()) {
		if (col.customName != null && col.customName !== '') return col.customName;
		// A cyclic reference chain must not recurse forever.
		if (depth > 8) return '';
		return displayNameOf(col.refColumn, namer, depth + 1);
	}
	return columnDisplayName(col, namer);
}

/**
 * displayNameOf for a column id (a number, or a numeric string from an object key);
 * `fallback` when there is no such column.
 */
export function displayNameById(id, fallback = '', namer) {
	const col = getColumnById(Number(id));
	return (col && displayNameOf(col, namer)) || String(fallback ?? '');
}

/**
 * The display names of input columns `ids`, for a node that writes them into an output column
 * as DATA (Describe data and Normality test `variable`, Correlation `var_i`/`var_j`, Logistic
 * regression `term`). Also bakes them into the node's args as `_inputLabels` ({ id: label }):
 * the Python and R ports, and so the exported scripts, read the baked labels, because they
 * cannot work out a node output's display name ("Residuals: y" for `resid_191_15`) themselves.
 * The same pattern as Join Data's `_sourceLabels`. `_` = internal, never an undo step; written
 * only when it changed, so a recompute with the same labels leaves the args alone.
 * @param {Record<string, any>} args  the node's args
 * @param {Array<number|string>} ids  input column ids, in output order
 * @returns {string[]} one label per id
 */
export function bakeInputLabels(args, ids) {
	const labels = ids.map((id) => displayNameById(id, String(id)));
	const baked = Object.fromEntries(ids.map((id, i) => [String(id), labels[i]]));
	if (JSON.stringify(args._inputLabels ?? null) !== JSON.stringify(baked)) {
		args._inputLabels = baked;
	}
	return labels;
}

/**
 * The display name of every column whose display name differs from its stored name, as
 * { id: label }, for the Python export (pythonExport.js, which imports nothing and so cannot
 * work them out) to label plot legends the way the app does.
 * @returns {Record<number, string>}
 */
export function exportColumnLabels() {
	const namer = createColumnNamer(core);
	const labels = {};
	for (const col of core.data ?? []) {
		const label = displayNameOf(col, namer);
		if (label && label !== col.name) labels[col.id] = label;
	}
	return labels;
}

/**
 * Rename a column from a display-name editor. Text equal to the column's output label restores
 * the seeded auto name (so the label stays live); anything else is the user's name.
 * Returns true when it handled the write as a label restore, false when the caller should
 * store `next` its usual way.
 */
export function restoreAutoNameIfLabel(col, next, namer) {
	const auto = (namer ?? createColumnNamer(core)).autoNameFor(col, next);
	if (auto == null) return false;
	col.customName = auto;
	return true;
}

/**
 * The `customName` a column rename editor's committed text means: text equal to the column's
 * output label restores the seeded auto name (as restoreAutoNameIfLabel does), an empty field
 * clears the user's name (null, the derived name shows again) or, for a column with no derived
 * name, changes nothing (undefined); anything else is the user's name, trimmed.
 */
export function renameTarget(col, next, namer) {
	const auto = (namer ?? createColumnNamer(core)).autoNameFor(col, next ?? '');
	if (auto != null) return auto;
	const trimmed = (next ?? '').trim();
	if (trimmed !== '') return trimmed;
	// Empty: back to the derived name, for a column that has one (a node output or a
	// reference). An imported column has none; clearing it would show "Unnamed", so an empty
	// field leaves its name alone.
	return hasDerivedName(col) ? null : undefined;
}

/** Does the column work out a name of its own when it has no user name? */
function hasDerivedName(col) {
	if (col?.isReferencial?.()) return true;
	return col?.producerNodeId != null && col?.refId == null;
}

/**
 * Commit a column rename typed into one of the editors (a group card row, a node output row,
 * the Data panel, a data node's header, a Table header): ONE renameColumn operation, so the
 * rename is an undo step and the session counts as edited (unsaved). Call it once, when the
 * edit is committed (Enter or blur), never per keystroke: each call is its own undo step.
 * Returns the inverse op, or null when nothing changed.
 */
export function commitColumnRename(col, next, namer) {
	if (!col) return null;
	const name = renameTarget(col, next, namer);
	if (name === undefined) return null;
	return applyOp({ kind: 'renameColumn', id: col.id, name });
}
