// @ts-nocheck
// Default args for a new table process, built from its registry `defaults` map.
//
// Extracted from WorkflowEditor so every path that spawns a node — the palette and the AI
// edit — uses ONE recipe. Three details here are load-bearing and easy to get subtly wrong in a
// reimplementation:
//
//   - `defaults` values are wrapped (`{val}`); `out` is a NESTED map of them.
//   - `out` must be a FRESH object. The TableProcess constructor writes the ids of the columns
//     it materialises straight into `args.out`, so handing it the registry's own template
//     object would poison the template for every node created afterwards.
//   - `definition.newNodeArgs` (optional) adds args only a NEW node gets, never a loaded one.
//     They must not live in `defaults`, which fillDefaults also writes into every saved
//     session's node on load. Used by the free-period fits' `periodRangeAuto`
//     (tableProcesses/periodRangeAuto.svelte.js). A function form receives the args the
//     creator set explicitly, so e.g. an AI edit that names a range keeps it.

/**
 * @param {{defaults?: Map<string, any>, definition?: object}} entry a tableProcessMap registry entry
 * @param {object} [explicit] args the creator sets on top (passed to a `newNodeArgs` function)
 * @returns {object} plain args: params unwrapped, `out` a fresh deep copy of the template
 */
export function buildTableProcessDefaults(entry, explicit = {}) {
	const fromNested = (obj) => {
		const r = {};
		for (const [k, v] of Object.entries(obj)) {
			r[k] = v && v.val !== undefined ? v.val : fromNested(v ?? {});
		}
		return r;
	};
	const args = Object.fromEntries(
		Array.from(entry.defaults?.entries() ?? []).map(([key, value]) =>
			key === 'out' ? ['out', fromNested(value)] : [key, value?.val]
		)
	);
	const extra = entry.definition?.newNodeArgs;
	const fresh = typeof extra === 'function' ? extra(explicit ?? {}) : extra;
	return fresh ? { ...args, ...fresh } : args;
}
