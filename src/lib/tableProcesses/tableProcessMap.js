export async function loadTableProcesses() {
	// Same loadPlots implementation as above
	const sveltePaths = import.meta.glob('$lib/tableProcesses/*.svelte', { eager: false });
	const tableProcessMap = new Map();
	for (const sveltePath in sveltePaths) {
		const fileName = sveltePath.split('/').pop().replace('.svelte', '');
		const funcName = fileName.toLowerCase();

		try {
			const svelteModule = await sveltePaths[sveltePath]();
			const component = svelteModule.default;
			const tableProcessFunc = svelteModule[funcName];
			const displayName = svelteModule[`${funcName}_displayName`] || formatDisplayName(fileName);

			tableProcessMap.set(fileName, {
				component: component,
				defaults: svelteModule[`${funcName}_defaults`] || new Map(),
				func: tableProcessFunc,
				displayName: displayName
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
		.replace(/^./, str => str.toUpperCase()) // Capitalize first letter
		.trim();
}
