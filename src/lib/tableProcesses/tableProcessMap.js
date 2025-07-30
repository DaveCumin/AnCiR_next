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
			tableProcessMap.set(fileName, {
				component: component,
				defaults: svelteModule[`${funcName}_defaults`] || new Map()
			});
		} catch (error) {
			console.error(`Error loading ${sveltePath}:`, error);
		}
	}
	return tableProcessMap;
}
