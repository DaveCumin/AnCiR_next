//Dynamically loads the plotMap. Assumes that the folder name is the same as the svelte and svelte.js files
async function loadPlots() {
	const sveltePaths = import.meta.glob('$lib/plots/**/*.svelte', { eager: false });
	const jsPaths = import.meta.glob('$lib/plots/**/*.js', { eager: false });

	const plotMap = new Map();

	for (const sveltePath in sveltePaths) {
		const fileName = sveltePath.split('/').pop();
		const folderName = sveltePath.split('/').slice(-2)[0];
		const jsFileName = fileName.replace('.svelte', '.svelte.js');
		const jsPath = sveltePath.replace(fileName, jsFileName);
		if (folderName != 'plots') {
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

let plotidCounter = 0;

export class Plot {
	static processFuncMap;

	plotid;
	name = '';
	plot;

	static async init() {
		this.processFuncMap = await loadPlots();
	}

	constructor({ ...dataIN }, id = null) {
		if (id === null) {
			this.plotid = id ?? plotidCounter;
			plotidCounter++;
		} else {
			this.plotid = id;
			plotidCounter = Math.max(id + 1, plotidCounter + 1);
		}
		//set the name
		this.name = dataIN.name;
		//need to make the plot
		this.type = dataIN.type;
		this.plot = Plot.processFuncMap.get(dataIN.type).data.fromJSON(dataIN.plot);
	}

	toJSON() {
		return {
			plotid: this.plotid,
			name: this.name,
			type: this.type,
			plot: this.plot
		};
	}
	static fromJSON(json) {
		//TODO
		const { plotid, name, type, plot } = json;
		return new Plot({ name, type, plot }, plotid);
	}
}
