// @ts-nocheck
// Shared helpers for the Column Set node.
//
// A Column Set curates a live subset of its wired candidate columns (`colsIN`)
// via a name/label predicate, and exposes that subset as ONE output wire. A
// consumer (table-process or plot) records which Column Sets feed which of its
// many-in ports in a parallel `setRefs` map, and a reconcile (syncTPSets /
// syncPlotSets) materialises the selected columns into the consumer's real
// inputs — so the consumer's compute, UI, and output-columns all see concrete
// columns, while the canvas shows a single bundle wire. These helpers are the
// single source of truth for the predicate, a set's selection, and the
// combined candidate/selection across several sets wired to one channel.
//
// No import cycle: neither core.svelte nor Column.svelte import this module.
import { core } from '$lib/core/core.svelte';
import { getColumnById } from '$lib/core/Column.svelte';

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
export function candidateIds(args) {
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

/**
 * Combined ownership domain + ordered selection across several Column Sets wired
 * to one channel. `candidates` (the union of every wired set's colsIN) is the
 * ownership domain: a consumer input is "set-owned" iff its column is a
 * candidate, which is how the reconcile knows which inputs it manages without
 * tagging. `selected` is the union of the sets' current selections, in order.
 * @param {number[]} colsetIds - Column Set table-process ids.
 * @returns {{candidates: Set<number>, selected: number[]}}
 */
export function setSelection(colsetIds) {
	const candidates = new Set();
	const selected = [];
	const seen = new Set();
	for (const csId of colsetIds ?? []) {
		const node = (core.tableProcesses ?? []).find((tp) => tp.id === csId);
		if (!node) continue;
		for (const id of candidateIds(node.args)) candidates.add(id);
		for (const id of selectedColumnIds(node.args)) {
			if (!seen.has(id)) {
				seen.add(id);
				selected.push(id);
			}
		}
	}
	return { candidates, selected };
}
