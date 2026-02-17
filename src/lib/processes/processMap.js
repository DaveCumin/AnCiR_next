export async function loadProcesses() {
	// Same loadPlots implementation as above
	const sveltePaths = import.meta.glob('$lib/processes/*.svelte', { eager: false });
	const processMap = new Map();
	for (const sveltePath in sveltePaths) {
		const fileName = sveltePath.split('/').pop().replace('.svelte', '');
		const funcName = fileName.toLowerCase();

		try {
			const svelteModule = await sveltePaths[sveltePath]();
			const component = svelteModule.default;
			const processFunc = svelteModule[funcName];
			const displayName = svelteModule[`${funcName}_displayName`] || formatDisplayName(fileName);

			processMap.set(fileName, {
				component: component,
				func: processFunc,
				defaults: svelteModule[`${funcName}_defaults`] || new Map(),
				displayName: displayName
			});
		} catch (error) {
			console.error(`Error loading ${sveltePath}:`, error);
		}
	}
	return processMap;
}

// Helper function to convert camelCase/PascalCase to readable format
function formatDisplayName(name) {
	return name
		.replace(/([A-Z])/g, ' $1') // Add space before capital letters
		.replace(/^./, str => str.toUpperCase()) // Capitalize first letter
		.trim();
}
