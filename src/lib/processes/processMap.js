export async function loadProcesses() {
	const sveltePaths = import.meta.glob('$lib/processes/*.svelte', { eager: false });
	const processMap = new Map();
	for (const sveltePath in sveltePaths) {
		const fileName = sveltePath.split('/').pop().replace('.svelte', '');

		try {
			const svelteModule = await sveltePaths[sveltePath]();
			const def = svelteModule.definition;
			if (!def) {
				console.warn(`Process ${fileName} is missing a \`definition\` export`);
				continue;
			}

			processMap.set(fileName, {
				component: svelteModule.default,
				func: def.func,
				defaults: def.defaults ?? new Map(),
				displayName: def.displayName ?? formatDisplayName(fileName),
				definition: def
			});
		} catch (error) {
			console.error(`Error loading ${sveltePath}:`, error);
		}
	}
	return processMap;
}

function formatDisplayName(name) {
	return name
		.replace(/([A-Z])/g, ' $1')
		.replace(/^./, (str) => str.toUpperCase())
		.trim();
}
