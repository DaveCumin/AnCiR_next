export async function loadTableProcesses() {
	const sveltePaths = import.meta.glob('$lib/tableProcesses/*.svelte', { eager: false });
	const tableProcessMap = new Map();
	for (const sveltePath in sveltePaths) {
		const fileName = sveltePath.split('/').pop().replace('.svelte', '');
		const funcName = fileName.toLowerCase();

		try {
			const svelteModule = await sveltePaths[sveltePath]();
			const component = svelteModule.default;

			// Prefer the consolidated `definition` export; fall back to the old
			// scattered named exports so existing files keep working during migration.
			const def = svelteModule.definition;
			const tableProcessFunc = def?.func ?? svelteModule[funcName];
			const displayName =
				def?.displayName ?? svelteModule[`${funcName}_displayName`] ?? formatDisplayName(fileName);
			const xOutKey = def?.xOutKey ?? svelteModule[`${funcName}_xOutKey`] ?? null;
			const yOutKeyPrefix =
				def?.yOutKeyPrefix ?? svelteModule[`${funcName}_yOutKeyPrefix`] ?? null;
			const defaults = def?.defaults ?? svelteModule[`${funcName}_defaults`] ?? new Map();

			tableProcessMap.set(fileName, {
				component,
				defaults,
				func: tableProcessFunc,
				displayName,
				xOutKey,
				yOutKeyPrefix
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
