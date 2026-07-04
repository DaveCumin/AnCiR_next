import { normalizeNodeDefinition } from '$lib/core/NodeDefinition.svelte.js';
import { getNodeMeta } from '$lib/core/nodeMeta.js';
import { loadNodeMap, formatDisplayName } from '$lib/core/nodeLoaders.js';

export async function loadTableProcesses() {
	// Keep the glob literal here — Vite analyses the pattern statically.
	const sveltePaths = import.meta.glob('$lib/tableProcesses/*.svelte', { eager: false });
	return loadNodeMap(sveltePaths, (sveltePath, svelteModule) => {
		const fileName = sveltePath.split('/').pop().replace('.svelte', '');
		const def = svelteModule.definition;
		const nodeSpec = normalizeNodeDefinition('tableprocess', fileName, def);
		if (!def) {
			console.warn(`Table process ${fileName} is missing a \`definition\` export`);
			return null;
		}

		const nodeMeta = getNodeMeta(fileName);
		return [
			fileName,
			{
				component: svelteModule.default,
				defaults: def.defaults ?? new Map(),
				func: def.func,
				displayName: def.displayName ?? formatDisplayName(fileName),
				nodeSpec,
				xOutKey: def.xOutKey ?? null,
				yOutKeyPrefix: def.yOutKeyPrefix ?? null,
				columnIdFields: def.columnIdFields ?? {},
				definition: def,
				family: nodeMeta.family,
				nodeIcon: nodeMeta.nodeIcon,
				description: nodeMeta.description,
				hideFromPalette: nodeMeta.hideFromPalette ?? false,
				kind: 'tableProcess'
			}
		];
	});
}
