// @ts-nocheck
// The output display labels (review finding UI-4) bound to the live session. The tables and
// the resolution rules live in core/outputLabels.js; this file only supplies `core`, so the
// Data panel, column pickers, mini tables and table plots share one answer.
//
// For a list, build one namer per render (`const namer = $derived(columnNamer())`) and call
// `namer(col)`; for a single column, columnDisplayName(col). Both read core reactively.
import { core } from './core.svelte.js';
import { createColumnNamer } from './outputLabels.js';

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
