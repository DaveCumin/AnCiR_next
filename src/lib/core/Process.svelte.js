async function loadProcesses() {
	const processes_paths = import.meta.glob('$lib/processes/*.js');
	const processMap = new Map();
	for (const path in processes_paths) {
		const process = await processes_paths[path]();
		const fileName = path.split('/').pop().split('.').shift();
		processMap.set(fileName, {
			func: process[fileName],
			defaults: process[fileName + '_defaults']
		});
	}

	return processMap;
}

let processidCounter = 0;

export class Process {
	static processFuncMap;
	processid;
	name = '';
	processFunc;
	args = $state({});

	//Set up the process function map
	static async init() {
		this.processFuncMap = await loadProcesses();
	}

	constructor({ ...dataIN }, id = null) {
		if (id === null) {
			this.processid = id ?? processidCounter;
			processidCounter++;
		} else {
			this.processid = id;
			processidCounter = Math.max(id + 1, processidCounter + 1);
		}
		//set the name
		this.name = dataIN.name;
		//set the function and return an error if it doesn't exist
		const funcEntry = Process.processFuncMap.get(this.name);
		if (!funcEntry) {
			this.processFunc = (x) => {
				return x;
			};
			this.args = { error: `no function ${name}` };
		} else {
			this.processFunc = funcEntry.func;

			//Now put in the args
			if (dataIN.args) {
				this.args = dataIN.args;
			} else {
				this.args = Object.fromEntries(
					Array.from(funcEntry.defaults.entries()).map(([key, value]) => [key, value.val])
				);
			}
		}
	}

	doProcess(data) {
		return this.processFunc(data, this.args);
	}

	toJSON() {
		return {
			processid: this.processid,
			name: this.name,
			args: this.args
		};
	}
	static fromJSON(json) {
		const { processid, name, args } = json;
		return new Process({ name, args }, processid);
	}
}
