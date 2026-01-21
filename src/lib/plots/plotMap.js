export async function loadPlots() {
	// Same loadPlots implementation as above
	const sveltePaths = import.meta.glob('$lib/plots/**/*.svelte', { eager: false });
	const plotMap = new Map();
	for (const sveltePath in sveltePaths) {
		const fileName = sveltePath.split('/').pop();
		//console.log('Loading plot from:', sveltePath, 'with file name:', fileName);
		const folderName = sveltePath.split('/').slice(-2)[0];

		try {
			if (folderName.toLowerCase() === fileName?.toLowerCase().slice(0, -7)) {
				// Make sure to only read in the file with the same name (other files should be imported by that one)
				const svelteModule = await sveltePaths[sveltePath]();
				const component = svelteModule.default;
				const className = fileName.split('.')[0] + 'class';
				const plotClass = svelteModule[className];
				const defaultInputs = svelteModule[fileName.split('.')[0] + '_defaultDataInputs'];
				const controlHeaders = svelteModule[fileName.split('.')[0] + '_controlHeaders'];
				if (!plotClass) {
					console.warn(
						`No valid plot class found in ${sveltePath}. Expected a named export like ${className}.`
					);
					continue;
				}

				plotMap.set(folderName.toLowerCase(), {
					plot: component,
					data: plotClass,
					defaultInputs: defaultInputs || [],
					controlHeaders: controlHeaders || []
				});
			}
		} catch (error) {
			console.error(`Error loading ${sveltePath}:`, error);
		}
	}
	//console.log('plotMap:', plotMap);
	return plotMap;
}
