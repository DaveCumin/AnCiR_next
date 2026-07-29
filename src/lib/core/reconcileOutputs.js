// Per-Y output columns must not outlive the input they describe.
//
// WHY THIS IS CENTRAL
//
// An input can go away by at least four different routes: deleting the source
// column, deleting the wire, clearing the Y selection in the picker, and loading a
// session that already lost one. Each used to clean up (or not) on its own:
//
//   - removeColumn scrubbed args[*IN] but left the outputs standing.
//   - disconnectInputPort set `tp.args[port] = []` and returned WITHOUT touching
//     args.out at all — which is the reported bug: delete a wire and the node keeps
//     its output ports, its columns, and any plot drawn from them.
//   - the picker relied on each node's syncYColumns(), which runs from an $effect,
//     so it only fired when that node's component happened to be MOUNTED. A
//     collapsed node renders through CompactNode and never mounts its editor.
//     Re-expanding did not heal it either, because useMultiYTP seeds prevYIds from
//     the CURRENT args.yIN and so sees no transition to react to.
//
// Four sites, three different behaviours, one invariant. This module states the
// invariant once — an out key naming an input id that is no longer an input is
// orphaned — so every route can enforce it, including on load, which is what
// repairs sessions that already carry orphans.
//
// Deliberately pure and dependency-free: `removeColumn` lives in Column.svelte,
// which is itself a caller, so importing it here would be a cycle. Callers pass
// their own remover.

/**
 * Every column id this node currently takes as input.
 *
 * Reads the `*IN` ports plus the two bespoke input arrays (`colIds` for
 * CollectColumns, `valueColIds` for LongToWide). Those matter: CollectColumns names
 * its outputs `col_<colId>` off `colIds`, not `yIN`, so keying only on `yIN` would
 * declare every one of its outputs orphaned.
 */
export function liveInputIds(tp) {
	const ids = new Set();
	for (const [key, value] of Object.entries(tp?.args ?? {})) {
		if (!(key.endsWith('IN') || key === 'colIds' || key === 'valueColIds')) continue;
		for (const v of Array.isArray(value) ? value : [value]) {
			const n = Number(v);
			if (Number.isFinite(n) && n >= 0) ids.add(n);
		}
	}
	return ids;
}

/**
 * Output-key prefixes that really are per-input, i.e. `<prefix><columnId>`.
 *
 * A CLOSED LIST, not a shape rule. Inferring "ends in _<digits>" from the key alone
 * looked general and was wrong in a way that destroys data: LongToWide builds its
 * keys as `value_<category>`, where the category is a DATA VALUE. Numeric categories
 * are entirely normal — hive 1, 2, 3 — so `value_1` would be read as "column 1's
 * output", found not to be one of LongToWide's inputs (categoryIN/timeIN/valueIN),
 * and deleted.
 *
 * Split is excluded for the opposite reason: it names outputs `<yId>_<segment>`, so
 * the id is the PREFIX. Nothing here matches it, which is the intent.
 *
 * Kept in step with the useMultiYTP call sites by perYPrefixes.test.js — the same
 * enumeration that found removeInputColumn, rather than trusting anyone to
 * remember.
 */
export const PER_INPUT_PREFIXES = [
	'avgprof_',
	'avgprofsem_',
	'binnedy_',
	'col_',
	'cosinory_',
	'dlogy_',
	'fity_',
	'interpy_',
	'npcray_',
	'permstats_',
	'rectwavey_',
	'resid_',
	'smoothedy_',
	'sortedy_',
	'trendy_'
];

/**
 * `args.out` keys whose per-input id is no longer an input.
 *
 * Only keys carrying a known per-input prefix are considered. Anything else —
 * a shared output (`smoothedx`, `time`), a category-keyed output (`value_hiveA`),
 * a Split segment (`799_1`) — is never orphaned by this rule; clearing those is the
 * owning node's business.
 */
export function orphanedOutputKeys(tp) {
	const out = tp?.args?.out;
	if (!out) return [];
	const live = liveInputIds(tp);
	return Object.keys(out).filter((key) => {
		const prefix = PER_INPUT_PREFIXES.find((p) => key.startsWith(p));
		if (!prefix) return false;
		const rest = key.slice(prefix.length);
		// The remainder must be exactly a column id. "value_12a" or "resid_1_2" are
		// not this node's per-input outputs however much they look like it.
		if (!/^\d+$/.test(rest)) return false;
		return !live.has(Number(rest));
	});
}

/**
 * Drop every orphaned per-input output of `tp`, deleting the column behind it.
 *
 * @param tp        the table process
 * @param removeColumn (id) => void — passed in to avoid a circular import
 * @returns the column ids removed, for logging and tests
 */
export function reconcileOutputs(tp, removeColumn) {
	const removed = [];
	for (const key of orphanedOutputKeys(tp)) {
		const id = Number(tp.args.out[key]);
		delete tp.args.out[key];
		if (Number.isFinite(id) && id >= 0) removed.push(id);
	}
	// Removal happens after the keys are gone, because removing a column re-enters
	// the very sweep that produced this list.
	for (const id of removed) removeColumn(id);
	return removed;
}

/** Reconcile every table process. Cheap enough to run on load and after any rewire. */
export function reconcileAllOutputs(tableProcesses, removeColumn) {
	const removed = [];
	for (const tp of tableProcesses ?? []) removed.push(...reconcileOutputs(tp, removeColumn));
	return removed;
}
