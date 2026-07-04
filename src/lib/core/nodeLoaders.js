// Shared plumbing for the three node-map loaders (processMap / tableProcessMap /
// plotMap). Each still owns its own `import.meta.glob(...)` call — Vite analyses
// that glob string statically, so it must stay literal in each file — but the
// iterate-resolve-collect loop and the display-name formatter live here.

/** camelCase/PascalCase file name → readable "Title Case" display name. */
export function formatDisplayName(name) {
	return name
		.replace(/([A-Z])/g, ' $1') // space before capitals
		.replace(/^./, (str) => str.toUpperCase()) // capitalise first letter
		.trim();
}

/**
 * Resolve every module in a glob result and collect the map entries.
 * @param {Record<string, () => Promise<any>>} sveltePaths - an eager:false
 *   `import.meta.glob` result (the caller creates it so Vite can analyse it)
 * @param {(path: string, module: any) => ([string, any] | null)} buildEntry -
 *   maps a resolved module to a `[key, value]` pair, or null to skip it (e.g.
 *   a missing `definition`; buildEntry is expected to warn in that case)
 * @returns {Promise<Map<string, any>>}
 */
export async function loadNodeMap(sveltePaths, buildEntry) {
	const map = new Map();
	for (const path in sveltePaths) {
		try {
			const module = await sveltePaths[path]();
			const entry = buildEntry(path, module);
			if (entry) map.set(entry[0], entry[1]);
		} catch (error) {
			console.error(`Error loading ${path}:`, error);
		}
	}
	return map;
}
