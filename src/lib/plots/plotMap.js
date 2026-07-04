import { getNodeMeta } from '$lib/core/nodeMeta.js';
import { loadNodeMap, formatDisplayName } from '$lib/core/nodeLoaders.js';

export async function loadPlots() {
	// Keep the glob literal here — Vite analyses the pattern statically.
	const sveltePaths = import.meta.glob('$lib/plots/**/*.svelte', { eager: false });

	// Only the folder's main plot file (e.g. Boxplot/Boxplot.svelte); the other
	// .svelte files in a plot folder are imported by it. Filter BEFORE resolving
	// so sub-components are never dynamically imported here.
	const mainPaths = {};
	for (const sveltePath in sveltePaths) {
		const fileName = sveltePath.split('/').pop();
		const folderName = sveltePath.split('/').slice(-2)[0];
		if (folderName.toLowerCase() === fileName?.toLowerCase().slice(0, -7)) {
			mainPaths[sveltePath] = sveltePaths[sveltePath];
		}
	}

	return loadNodeMap(mainPaths, (sveltePath, svelteModule) => {
		const folderName = sveltePath.split('/').slice(-2)[0];
		const def = svelteModule.definition;
		if (!def) {
			console.warn(`Plot ${sveltePath} is missing a \`definition\` export`);
			return null;
		}
		if (!def.plotClass) {
			console.warn(`Plot ${sveltePath} definition is missing \`plotClass\``);
			return null;
		}

		const plotKey = folderName.toLowerCase();
		const nodeMeta = getNodeMeta(plotKey);
		return [
			plotKey,
			{
				plot: svelteModule.default,
				data: def.plotClass,
				defaultInputs: def.defaultDataInputs ?? [],
				controlHeaders: def.controlHeaders ?? [],
				displayName: def.displayName ?? formatDisplayName(folderName),
				definition: def,
				family: nodeMeta.family,
				nodeIcon: nodeMeta.nodeIcon,
				description: nodeMeta.description,
				kind: 'plot'
			}
		];
	});
}
