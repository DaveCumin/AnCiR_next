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
			this.columnID = id;
			_counter = Math.max(id + 1, _counter + 1);
		}
		//Assign the other data
		Object.assign(this, structuredClone(columnData));
	}

	// Simulate new dataField based on type
    simulateColumn(type, fs_min, startDate, period, maxHeight, dataLength) {
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
			out = out.map((x) => x + this.timeformat); // TODO: Update to force time by format
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
		let jsonOut = { columnId: this.columnId, columnName: this.name };
		
		if (this.refId != null) {
			jsonOut.columnRefId = this.refId;
		} else {
			jsonOut.columnData = this.data;
		}

		jsonOut.columnType = this.type;

		if (this.type == 'time') {
			jsonOut.columnTimeFormat = this.timeFormat;
		}
		if (this.compression != null) {
			jsonOut.columnCompression = this.compression;
		}
		jsonOut.columnProvenance = this.provenance;
		jsonOut.columnProcesses = this.processes;

		return jsonOut;
	}

	static fromJSON(json) {
		const {
			columnId,
			columnName,
			columnType,
			columnRefId,
			columnData,
			columnTimeFormat,
			columnProcesses,
			columnCompression,
			columnProvenance
		} = json;

		let column = new Column(
			{
				name,
				type,
				refId: refId ?? null,
				data: data ?? null,
				compression: compression ?? null,
				timeFormat: timeformat ?? '',
				provenance: provenance ?? null,
				processes: []
			},
			columnId
		);
		if (processes?.length > 0) {
			processes.map((p) => column.processes.push(Process.fromJSON(p, column)));
		}
		return column;
	}
}
