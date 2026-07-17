// @ts-nocheck
// Default args for a new table process, built from its registry `defaults` map.
//
// Extracted from WorkflowEditor so every path that spawns a node — the palette and the AI
// edit — uses ONE recipe. Two details here are load-bearing and easy to get subtly wrong in a
// reimplementation:
//
//   - `defaults` values are wrapped (`{val}`); `out` is a NESTED map of them.
//   - `out` must be a FRESH object. The TableProcess constructor writes the ids of the columns
//     it materialises straight into `args.out`, so handing it the registry's own template
//     object would poison the template for every node created afterwards.

/**
 * @param {{defaults?: Map<string, any>}} entry a tableProcessMap registry entry
 * @returns {object} plain args: params unwrapped, `out` a fresh deep copy of the template
 */
export function buildTableProcessDefaults(entry) {
	const fromNested = (obj) => {
		const r = {};
		for (const [k, v] of Object.entries(obj)) {
			r[k] = v && v.val !== undefined ? v.val : fromNested(v ?? {});
		}
		return r;
	};
	return Object.fromEntries(
		Array.from(entry.defaults?.entries() ?? []).map(([key, value]) =>
			key === 'out' ? ['out', fromNested(value)] : [key, value?.val]
		)
	);
}
