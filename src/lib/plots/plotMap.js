export async function loadPlots() {
	const sveltePaths = import.meta.glob('$lib/plots/**/*.svelte', { eager: false });
	const plotMap = new Map();
	for (const sveltePath in sveltePaths) {
		const fileName = sveltePath.split('/').pop();
		const folderName = sveltePath.split('/').slice(-2)[0];

		// Only load the folder's main plot file (other .svelte files are imported by it).
		if (folderName.toLowerCase() !== fileName?.toLowerCase().slice(0, -7)) continue;

		try {
			const svelteModule = await sveltePaths[sveltePath]();
			const def = svelteModule.definition;
			if (!def) {
				console.warn(`Plot ${sveltePath} is missing a \`definition\` export`);
				continue;
			}
			if (!def.plotClass) {
				console.warn(`Plot ${sveltePath} definition is missing \`plotClass\``);
				continue;
			}

			plotMap.set(folderName.toLowerCase(), {
				plot: svelteModule.default,
				data: def.plotClass,
				defaultInputs: def.defaultDataInputs ?? [],
				controlHeaders: def.controlHeaders ?? [],
				displayName: def.displayName ?? formatDisplayName(folderName),
				definition: def
			});
		} catch (error) {
			console.error(`Error loading ${sveltePath}:`, error);
		}
	}
	return plotMap;
}

function formatDisplayName(name) {
	return name
		.replace(/([A-Z])/g, ' $1')
		.replace(/^./, (str) => str.toUpperCase())
		.trim();
}
