// @ts-nocheck
// Shared helpers for the Column Set node and for anything that has to expand a
// "column set" reference back into concrete column ids.
//
// A Column Set node curates a live subset of its wired candidate columns
// (`colsIN`) via a name/label predicate, and exposes that subset as ONE output
// wire. Downstream, a consumer's many-in array (e.g. Split's `args.yIN`) stores
// a lightweight token `{ setRef: <columnSetTpId> }` in place of the individual
// column ids. These helpers are the single source of truth for:
//   · testing a column against the predicate,
//   · computing a Column Set's currently-selected column ids, and
//   · expanding a many-in array's `setRef` tokens back to concrete ids at
//     read/compute time.
//
// No import cycle: neither core.svelte nor Column.svelte import tpArgHelpers or
// this module, so tpArgHelpers → columnSet → {core, Column} is one-directional.
import { core } from '$lib/core/core.svelte';
import { getColumnById } from '$lib/core/Column.svelte';

// --- setRef token -----------------------------------------------------------
// A bundle reference stored inline in a consumer's many-in id array. Kept as a
// plain object so it serializes as JSON and is skipped by every existing path
// that only rewrites/matches numeric ids (column remap, splice indexOf, …).

/** Build the token stored in a consumer's many-in array for a wired column set. */
export function makeSetRef(columnSetTpId) {
	return { setRef: columnSetTpId };
}

/** True when `v` is a column-set reference token (not a plain column id). */
export function isSetRef(v) {
	return !!v && typeof v === 'object' && typeof v.setRef === 'number';
}

/** The Column Set table-process id a token points at (or -1). */
export function setRefId(v) {
	return isSetRef(v) ? v.setRef : -1;
}

// --- predicate --------------------------------------------------------------

/**
 * Does a column match the Column Set predicate?
 * @param {object} col - a Column instance (has `name`, `groupLabel`).
 * @param {string} pattern - case-insensitive substring; '' matches everything.
 * @param {'name'|'label'|'either'} matchField
 */
export function matchesPredicate(col, pattern, matchField = 'either') {
	const p = (pattern ?? '').trim().toLowerCase();
	if (!p) return true; // empty rule → pass-through (select all candidates)
	if (!col) return false;
	const name = (col.name ?? '').toLowerCase();
	const label = (col.groupLabel ?? '').toLowerCase();
	if (matchField === 'name') return name.includes(p);
	if (matchField === 'label') return label.includes(p);
	return name.includes(p) || label.includes(p);
}

/** Normalize a `colsIN` arg to a plain array of candidate column ids. */
function candidateIds(args) {
	const raw = args?.colsIN;
	if (Array.isArray(raw)) return raw.filter((id) => typeof id === 'number' && id >= 0);
	return typeof raw === 'number' && raw >= 0 ? [raw] : [];
}

/**
 * The column ids a Column Set currently selects: its wired candidates filtered
 * by the predicate. Live — reads column name/groupLabel via getColumnById, so a
 * rename or re-label upstream changes the result.
 * @param {object} args - the Column Set's `p.args`.
 * @returns {number[]}
 */
export function selectedColumnIds(args) {
	const pattern = args?.pattern ?? '';
	const matchField = args?.matchField ?? 'either';
	return candidateIds(args).filter((id) => {
		const col = getColumnById(id);
		// A candidate whose column no longer exists is never in the set, even under
		// an empty (pass-through) rule.
		return col && matchesPredicate(col, pattern, matchField);
	});
}

// --- expansion --------------------------------------------------------------

/**
 * Expand a many-in id array, replacing each `setRef` token with the referenced
 * Column Set's currently-selected column ids and passing plain ids through. A
 * token pointing at a missing/deleted Column Set node expands to nothing.
 * Order is preserved; a set expands in place.
 * @param {Array<number|{setRef:number}>} arr
 * @returns {number[]}
 */
export function expandColumnRefs(arr) {
	if (!Array.isArray(arr)) return [];
	const out = [];
	for (const item of arr) {
		if (isSetRef(item)) {
			const node = (core.tableProcesses ?? []).find((tp) => tp.id === item.setRef);
			if (node) {
				for (const id of selectedColumnIds(node.args)) out.push(id);
			}
		} else if (typeof item === 'number') {
			out.push(item);
		}
	}
	return out;
}
