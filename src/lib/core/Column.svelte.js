// @ts-nocheck
import { forceFormat, getPeriod } from '$lib/utils/time/TimeUtils';
import { core } from '$lib/core/core.svelte.js';
import { Process } from '$lib/core/process.svelte.js';

let _counter = 0;
function getNextId() {
	return _counter++;
}

function getColumnById(id) {
	return core.data.find((column) => column.id === id);
}

export class Column {
	id;
	refId = $state(null); // if instance based on another instance

	name = $derived.by(() => {
		if (this.refId !== null) {
			return core.columns.find((column) => column.id === this.refId)?.name;
		}
	})

	type = $derived.by(() => {
		if (this.refId !== null) {
			return core.columns.find((column) => column.id === this.refId)?.type;
		}
	})

	provenance = $derived.by(() => {
		if (this.refId !== null) {
			return (
				'refers to ' +
				getColumnById(this.refId)?.name +
				' which is ' +
				getColumnById(this.refId)?.provenance
			);
		}
	});

	data = $state()
	processes = $state([]);
	timeFormat = $state();
	compression = $state(null); //if any compression is used, store the info here
	//Where the data are from (references all the way to the primary source [importd (file) or simulated (params)])

	// constructor(type) {
	// 	this.id = getNextId();
	// 	this.type = type;
	// }

	constructor(columnData = {}, id = null) {
		if (id === null) {
			this.id = getNextId();
		} else {
			this.id = id;
			_counter = Math.max(id + 1, _counter + 1);
		}
		//Assign the other data
		this.name = columnData.name ?? null;
		this.type = columnData.type ?? null;
		this.refId = columnData.refId ?? null;
		this.data = columnData.data ?? null;
		this.timeFormat = columnData.timeFormat ?? null;
		this.compression = columnData.compression ?? null;
		this.provenance = columnData.provenance ?? null;
		this.processes = columnData.processes ?? [];
	}

	// Simulate new dataField based on type
    simulateColumn(type, fs_min, startDate, period, maxHeight, dataLength) {
		if (!this.name) {
			this.name = type;
		}
		console.log(this.name);

        this.type = type;
		switch (this.type) {
            case 'time':
                this.generateTimeData(fs_min, startDate, dataLength);
                break;
            case 'value':
                this.generateValueData(fs_min, period, maxHeight, dataLength)
                break;
            default:
                console.log('error: double check type');
        }
    }

	// Data with type 'time'
	generateTimeData(fs_min, startDate, dataLength) {
		const timeData = [];

		for (let i = 0; i < dataLength; i++) {
			const time = new Date(startDate.getTime() + i * fs_min * 60 * 1000).toLocaleString('en-US');
			timeData.push(time);
		}

		const timefmt = 'M/D/YYYY, h:mm:s A';
		const processedTimeData = forceFormat(timeData, timefmt);
		const timePeriod = getPeriod(timeData, timefmt);

		this.data = processedTimeData;
		this.timeFormat = timefmt;

		// this.properties = {
		// 	timeFormat: timefmt,
		// 	recordPeriod: timePeriod
		// };

	}
	
	// Data with type 'value'
	generateValueData(fs_min, period, maxHeight, dataLength) {
		const valueData = [];

		const periodL = period * (60 / fs_min); //the length of the period

		for (let j = 0; j < dataLength; j++) {
			const isLowPeriod = j % periodL < periodL / 2;
			const mult = isLowPeriod ? maxHeight * 0.05 : maxHeight;

			const randomValue = Math.random() * mult;
			valueData.push(Math.round(randomValue));
		}
		this.data = valueData;

	}

	// Add and remove processes
	addProcess(processName) {
		this.processes.push(new Process({ name: processName }, this));
	}

	removeProcess(id) {
		this.processes = this.processes.filter((p) => p.processid !== id);
	}

	getData() {
		let out = [];
		//if there is a reference, then get parent/reference column data
		if (this.refId != null) {
			out = core.data.find((column) => column.columnId === this.refId)?.getData();
		} else {
			//get the raw data
			out = this.data;
			//deal with compressed data
			if (this.compression === 'awd') {
				out = [];
				for (let a = 0; a < this.rawData.length; a += this.rawData.step) {
					out.push(this.rawData.start + a);
				}
			}
		}

		//deal with timestamps
		if (this.type === 'time') {
			out = out.map((x) => x + this.timeFormat); // TODO: Update to force time by format
		}

		//If no data, return empty
		if (out == []) return [];

		//otherwise apply the processes
		for (const p of this.processes) {
			out = p.doProcess(out);
		}
		return out;
	}

	// Import and Export as JSON
	toJSON() {
		let jsonOut = { id: this.id, name: this.name };
		
		if (this.refId != null) {
			jsonOut.refId = this.refId;
		} else {
			jsonOut.data = this.data;
		}

		jsonOut.type = this.type;

		if (this.type == 'time') {
			jsonOut.timeFormat = this.timeFormat;
		}
		if (this.compression != null) {
			jsonOut.compression = this.compression;
		}
		jsonOut.provenance = this.provenance;
		jsonOut.processes = this.processes;

		return jsonOut;
	}

	static fromJSON(json) {
		const {
			id,
			name,
			type,
			refId,
			data,
			timeFormat,
			processes,
			compression,
			provenance
		} = json;

		let column = new Column(
			{
				name,
				type,
				refId: refId ?? null,
				data: data ?? null,
				compression: compression ?? null,
				timeFormat: timeFormat ?? '',
				provenance: provenance ?? null,
				processes: processes ?? []
			},
			id
		);
		if (processes?.length > 0) {
			processes.map((p) => column.processes.push(Process.fromJSON(p, column)));
		}
		return column;
	}
}
