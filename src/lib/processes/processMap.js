async function loadProcesses() {
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
			processMap.set(fileName, {
				component: component,
				func: processFunc,
				defaults: svelteModule[`${funcName}_defaults`] || new Map()
			});
		} catch (error) {
			console.error(`Error loading ${sveltePath}:`, error);
		}
	}
	return processMap;
}

export const processMap = await loadProcesses();
