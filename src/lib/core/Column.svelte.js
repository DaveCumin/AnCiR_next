import { Process } from '$lib/core/Process.svelte.js';
import { core } from '$lib/core/theCore.svelte.js';

let idCounter = 0;

export class Column {
	id;
	refDataID = $state(null); //if it is a column that is based on another
	rawData = null; //if it has raw data, store that here
	compression = $state(null);
	name = $derived.by(() => {
		if (this.refDataID !== null) {
			return core.data.find((column) => column.id === this.refDataID)?.name;
		}
	});
	type = $derived.by(() => {
		if (this.refDataID !== null) {
			return core.data.find((column) => column.id === this.refDataID)?.type;
		}
	});
	timeformat = $state();
	processes = $state([]);

	constructor({ ...columnData }, id = null) {
		if (id === null) {
			this.id = idCounter;
			idCounter++;
		} else {
			this.id = id;
			idCounter = Math.max(id + 1, idCounter + 1);
		}
		//Assign the other data
		Object.assign(this, structuredClone(columnData));
	}

	addProcess(processName) {
		this.processes.push(new Process({ name: processName }));
	}

	removeProcess(id) {
		this.processes = this.processes.filter((p) => p.processid !== id);
	}

	getProcessArgType(name, arg) {
		//TODO: change this so it looks up the correct type. (if we stick with this approach)
		if (name == 'add') {
			return 'number';
		} else {
			return this.type;
		}
	}

	getData() {
		let out = [];
		//if there is a reference, then just get that data
		if (this.refDataID != null) {
			out = core.data.find((column) => column.id === this.refDataID)?.getData();
		} else {
			//get the raw data
			out = this.rawData;
			//deal with compressed data
			if (this.compression === 'awd') {
				out = [];
				for (let a = 0; a < this.rawData.length; a += this.rawData.step) {
					out.push(this.rawData.start + a);
				}
			}
			//deal with timestamps
			if (this.type === 'time') {
				out = out.map((x) => x + this.timeformat); // TODO: Update to force time by format
			}
		}

		//If no data, return empty
		if (out == []) return [];

		//otherwise apply the processes
		for (const p of this.processes) {
			out = p.doProcess(out);
		}
		return out;
	}

	toJSON() {
		let jsonOut = { id: this.id, name: this.name };
		if (this.refDataID != null) {
			jsonOut.refDataID = this.refDataID;
		} else {
			jsonOut.rawData = this.rawData;
		}
		jsonOut.type = this.type;
		if (this.type == 'time') {
			jsonOut.timeformat = this.timeformat;
		}
		if (this.compression != null) {
			jsonOut.compression = this.compression;
		}
		jsonOut.processes = this.processes;
		return jsonOut;
	}

	static fromJSON(json) {
		const { id, name, type, refDataID, rawData, timeformat, processes, compression } = json;
		let column = new Column(
			{
				name,
				type,
				refDataID: refDataID ?? null,
				rawData: rawData ?? null,
				compression: compression ?? null,
				timeformat: timeformat ?? '',
				processes: []
			},
			id
		);
		processes.map((p) => column.processes.push(Process.fromJSON(p)));
		return column;
	}
}
