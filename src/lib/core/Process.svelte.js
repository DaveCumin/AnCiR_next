import { add, add_defaults } from '$lib/processes/add.js'; //TODO: Make this dynamic
import { sub, sub_defaults } from '$lib/processes/sub.js'; //TODO: Make this dynamic

let processidCounter = 0;

export class Process {
	static processFuncMap = new Map([
		['add', { func: add, defaults: add_defaults }],
		['sub', { func: sub, defaults: sub_defaults }]
	]); //TODO: Make this dynamic

	processid;
	name = '';
	processFunc;
	args = $state({});

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
