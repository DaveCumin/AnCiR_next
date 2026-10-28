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
		`Unknown ${kind} "${key}". This session refers to a node this build does not have. ` +
		`It may have been renamed or removed, or the session may come from a newer version. ` +
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

/**
 * What a saved analysis node the registry cannot resolve says on the canvas and in its panel
 * (ROB-U6). The canvas used to show such a node like a working one: its stored title, its
 * wires, its saved outputs driving plots, and nothing saying it cannot compute.
 *
 * @param {string} name the unresolvable tableProcessMap key
 */
export function unknownAnalysisText(name) {
	return (
		`Unknown analysis "${name}": this version of AnCiR cannot run it. Its saved outputs ` +
		`are kept and saved with the session, but they will not update.`
	);
}

/**
 * True when `name` is not in a LOADED tableProcessMap. While the registry is still loading
 * (empty), nothing is unknown yet, so a session restored early is never flagged wrongly.
 *
 * @param {string} name
 * @param {Map<string, unknown> | undefined} map appConsts.tableProcessMap
 */
export function isUnknownAnalysis(name, map) {
	return !!map && map.size > 0 && !map.has(name);
}

/**
 * The load-time warning for every saved analysis the registry cannot resolve, or null.
 *
 * @param {Array<{ name: string }>} tableProcesses core.tableProcesses after a load
 * @param {Map<string, unknown> | undefined} map appConsts.tableProcessMap
 */
export function unknownAnalysesWarning(tableProcesses, map) {
	const names = [
		...new Set(
			(tableProcesses ?? []).map((tp) => tp?.name).filter((n) => isUnknownAnalysis(n, map))
		)
	];
	if (names.length === 0) return null;
	for (const n of names) reportUnknownNode('table process', n);
	const list = names.map((n) => `"${n}"`).join(', ');
	const one = names.length === 1;
	return (
		`This session uses ${one ? 'an analysis' : 'analyses'} this version of AnCiR does not ` +
		`know: ${list}. ${one ? 'It was' : 'They were'} renamed or removed, or the session comes ` +
		`from a newer version. The saved outputs are kept and saved with the session, but they ` +
		`will not update; the node${one ? ' is' : 's are'} marked on the canvas.`
	);
}
