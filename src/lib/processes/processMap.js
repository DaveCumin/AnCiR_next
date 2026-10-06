import { normalizeNodeDefinition } from '$lib/core/NodeDefinition.svelte.js';
import { getNodeMeta } from '$lib/core/nodeMeta.js';
import { loadNodeMap, memoiseNodeMap, formatDisplayName } from '$lib/core/nodeLoaders.js';

/** The column-process registry: `key -> { component, func, ... }`, keyed by file name or `definition.registryKey`. Memoised; see memoiseNodeMap. */
export const loadProcesses = memoiseNodeMap(async () => {
	// Keep the glob literal here — Vite analyses the pattern statically.
	const sveltePaths = import.meta.glob('$lib/processes/*.svelte', { eager: false });
	return loadNodeMap(sveltePaths, (sveltePath, svelteModule) => {
		const def = svelteModule.definition;
		// The registry key is what a session stores as the process name. It is the file name,
		// unless the definition pins `registryKey`: Normalize.svelte keeps its historical
		// lower-case key 'normalize' so saved sessions, the MCP tools and the Python/R ports
		// still resolve it after the file was renamed.
		const fileName = sveltePath.split('/').pop().replace('.svelte', '');
		const key = def?.registryKey ?? fileName;
		const nodeSpec = normalizeNodeDefinition('process', key, def);
		if (!def) {
			console.warn(`Process ${fileName} is missing a \`definition\` export`);
			return null;
		}

		const nodeMeta = getNodeMeta(key);
		return [
			key,
			{
				component: svelteModule.default,
				func: def.func,
				defaults: def.defaults ?? new Map(),
				displayName: def.displayName ?? formatDisplayName(key),
				nodeSpec,
				definition: def,
				family: nodeMeta.family,
				nodeIcon: nodeMeta.nodeIcon,
				description: nodeMeta.description,
				keywords: nodeMeta.keywords,
				kind: 'process'
			}
		];
	});
});
