export async function loadPlots() {
	// Same loadPlots implementation as above
	const sveltePaths = import.meta.glob('$lib/plots/**/*.svelte', { eager: false });
	const plotMap = new Map();
	for (const sveltePath in sveltePaths) {
		const fileName = sveltePath.split('/').pop();
		const folderName = sveltePath.split('/').slice(-2)[0];

		try {
			const svelteModule = await sveltePaths[sveltePath]();
			const component = svelteModule.default;
			const className = fileName;
			let plotClass = svelteModule[className];

			// Fallback: Check all named exports for a class with fromJSON
			if (!plotClass || typeof plotClass.fromJSON !== 'function') {
				for (const [exportName, value] of Object.entries(svelteModule)) {
					if (
						exportName !== 'default' &&
						typeof value === 'function' &&
						typeof value.fromJSON === 'function'
					) {
						plotClass = value;
						//console.log(`Found class ${exportName} in ${sveltePath}`);
						break;
					}
				}
			}

			if (!plotClass) {
				console.warn(
					`No valid plot class found in ${sveltePath}. Expected a named export like ${className}.`
				);
				continue;
			}

			plotMap.set(folderName.toLowerCase(), {
				plot: component,
				data: plotClass
			});
		} catch (error) {
			console.error(`Error loading ${sveltePath}:`, error);
		}
	}
	//console.log('plotMap:', plotMap);
	return plotMap;
}
