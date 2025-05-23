async function loadPlots() {
	// Same loadPlots implementation as above
	const sveltePaths = import.meta.glob('$lib/plots/**/*.svelte', { eager: false });
	const jsPaths = import.meta.glob('$lib/plots/**/*.js', { eager: false });
	const plotMap = new Map();
	for (const sveltePath in sveltePaths) {
		const fileName = sveltePath.split('/').pop();
		const folderName = sveltePath.split('/').slice(-2)[0];
		const jsFileName = fileName.replace('.svelte', '.svelte.js');
		const jsPath = sveltePath.replace(fileName, jsFileName);
		if (folderName !== 'plots') {
			try {
				const svelteModule = await sveltePaths[sveltePath]();
				const component = svelteModule.default;
				const jsModule = await jsPaths[jsPath]();
				const plotClass = jsModule.default || Object.values(jsModule)[0];
				plotMap.set(folderName, {
					plot: component,
					data: plotClass
				});
			} catch (error) {
				console.error(`Error loading ${sveltePath} or ${jsPath}:`, error);
			}
		}
	}
	return plotMap;
}

export const plotMap = await loadPlots();
