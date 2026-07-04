import { normalizeNodeDefinition } from '$lib/core/NodeDefinition.svelte.js';
import { getNodeMeta } from '$lib/core/nodeMeta.js';
import { loadNodeMap, formatDisplayName } from '$lib/core/nodeLoaders.js';

export async function loadProcesses() {
	// Keep the glob literal here — Vite analyses the pattern statically.
	const sveltePaths = import.meta.glob('$lib/processes/*.svelte', { eager: false });
	return loadNodeMap(sveltePaths, (sveltePath, svelteModule) => {
		const fileName = sveltePath.split('/').pop().replace('.svelte', '');
		const def = svelteModule.definition;
		const nodeSpec = normalizeNodeDefinition('process', fileName, def);
		if (!def) {
			console.warn(`Process ${fileName} is missing a \`definition\` export`);
			return null;
		}

		const nodeMeta = getNodeMeta(fileName);
		return [
			fileName,
			{
				component: svelteModule.default,
				func: def.func,
				defaults: def.defaults ?? new Map(),
				displayName: def.displayName ?? formatDisplayName(fileName),
				nodeSpec,
				definition: def,
				family: nodeMeta.family,
				nodeIcon: nodeMeta.nodeIcon,
				description: nodeMeta.description,
				kind: 'process'
			}
		];
	});
}
