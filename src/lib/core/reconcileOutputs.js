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
 * `args.out` keys whose per-input id is no longer an input.
 *
 * A key counts as per-input when it ends in `_<digits>` AND the part before
 * contains a non-digit — "smoothedy_12", "resid_12", "permstats_12", "col_12".
 *
 * The non-digit requirement is load-bearing. Split names its outputs the other way
 * round, `<yId>_<segment>` (Split.svelte), so "799_1" would otherwise read as
 * "column 1's output" and be deleted whenever column 1 went away, taking another
 * series' first segment with it.
 *
 * Keys with no id at all (`smoothedx`, `time`) are shared across inputs and are
 * never orphaned by this rule — clearing them is the owning node's business.
 */
export function orphanedOutputKeys(tp) {
	const out = tp?.args?.out;
	if (!out) return [];
	const live = liveInputIds(tp);
	return Object.keys(out).filter((key) => {
		const m = /^(.*)_(\d+)$/.exec(key);
		if (!m) return false;
		// The PREFIX must contain a letter. Testing the whole key is not enough — "_"
		// is itself a non-digit, so "799_1" would pass and Split's segment outputs
		// would be read as "column 1's output".
		if (!/[A-Za-z]/.test(m[1])) return false;
		return !live.has(Number(m[2]));
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
