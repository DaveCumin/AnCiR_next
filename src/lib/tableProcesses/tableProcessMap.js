import { normalizeNodeDefinition } from '$lib/core/NodeDefinition.svelte.js';
import { getNodeMeta } from '$lib/core/nodeMeta.js';

export async function loadTableProcesses() {
	const sveltePaths = import.meta.glob('$lib/tableProcesses/*.svelte', { eager: false });
	const tableProcessMap = new Map();
	for (const sveltePath in sveltePaths) {
		const fileName = sveltePath.split('/').pop().replace('.svelte', '');

		try {
			const svelteModule = await sveltePaths[sveltePath]();
			const component = svelteModule.default;

			const def = svelteModule.definition;
			const nodeSpec = normalizeNodeDefinition('tableprocess', fileName, def);
			if (!def) {
				console.warn(`Table process ${fileName} is missing a \`definition\` export`);
				continue;
			}

			const nodeMeta = getNodeMeta(fileName);
			tableProcessMap.set(fileName, {
				component,
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
			});
		} catch (error) {
			console.error(`Error loading ${sveltePath}:`, error);
		}
	}
	return tableProcessMap;
}

// Helper function to convert camelCase/PascalCase to readable format
function formatDisplayName(name) {
	return name
		.replace(/([A-Z])/g, ' $1') // Add space before capital letters
		.replace(/^./, (str) => str.toUpperCase()) // Capitalize first letter
		.trim();
}
