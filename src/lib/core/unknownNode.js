// A node whose registry key no longer exists must FAIL LOUDLY.
//
// WHY THIS EXISTS
//
// The registries (tableProcessMap / processMap / plotMap) are keyed by FILENAME,
// and every saved session stores that key in each node's `name` / `type`. The
// filename is therefore not an implementation detail — it is a persisted
// identifier, effectively part of the file format. Any rename, any hand-edited
// session, or any session written by a newer build and opened in an older one
// can produce a key the registry cannot resolve.
//
// Before this, the three node kinds each failed differently, and two of them
// failed silently:
//
//   TableProcess  doProcess() hit `if (!entry?.func) return null` and quietly
//                 did nothing. The node loaded, sat on the canvas under its
//                 stored name, and produced no output — with no warning, no
//                 error, and no visible marker. Measured: 0 console.warn and
//                 0 console.error calls.
//   Process       set `args = { error: 'no function X' }` but logged nothing and
//                 passed the data through unchanged.
//   Plot          `plotMap.get(type).plot` had no optional chaining, so it threw
//                 a bare "Cannot read properties of undefined" at render.
//
// A silent no-op is the worst of the three: the session opens, the node is
// there, and the numbers are simply stale — which is indistinguishable from a
// node the user forgot to wire.
//
// Deduplicated per (kind, key) because these lookups run inside reactive
// effects and would otherwise flood the console on every recompute.

const seen = new Set();

/**
 * Report a node whose registry key cannot be resolved. Safe to call from a
 * render path or an effect: it logs at most once per kind+key.
 *
 * @param {string} kind 'table process' | 'column process' | 'plot'
 * @param {string} key the unresolvable registry key
 * @returns {string} the message logged, so callers can also show it in the UI
 */
export function reportUnknownNode(kind, key) {
	const message =
		`Unknown ${kind} "${key}". This session refers to a node this build does not have — ` +
		`it may have been renamed or removed, or the session may come from a newer version. ` +
		`The node will load but cannot compute.`;
	const id = `${kind}:${key}`;
	if (!seen.has(id)) {
		seen.add(id);
		console.error(`[AnCiR] ${message}`);
	}
	return message;
}

/** Test seam: forget what has already been reported. */
export function resetUnknownNodeReports() {
	seen.clear();
}
