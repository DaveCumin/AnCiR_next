// @ts-nocheck
// The output display labels (review finding UI-4) bound to the live session. The tables and
// the resolution rules live in core/outputLabels.js; this file only supplies `core`, so the
// Data panel, column pickers, mini tables and table plots share one answer.
//
// For a list, build one namer per render (`const namer = $derived(columnNamer())`) and call
// `namer(col)`; for a single column, columnDisplayName(col). Both read core reactively.
import { core } from './core.svelte.js';
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
