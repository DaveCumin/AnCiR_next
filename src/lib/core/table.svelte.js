// @ts-nocheck
import { forceFormat, getPeriod } from '$lib/utils/time/TimeUtils';
import { core, pushObj } from '$lib/core/core.svelte.js';
import { Column } from './Column.svelte';

let _counter = 0;
function getNextId() {
	return _counter++;
}

function getColumnById(id) {
	return core.data.find((column) => column.id === id);
}

export class Table {
	id;
	name = $state('');

	// importedFrom = '';
	// dataLength = 0;

	columnRefs = $state([]); //Reference IDs for the raw data that are columns
	
	columns = $derived.by(() => {
		return this.columnRefs.map((colRef) => getColumnById(colRef));
	}); //The actual columns of data

	// constructor(name, importedFrom, dataLength) {
	// 	this.id = getNextId();
	// 	this.name = name;
	// 	this.importedFrom = importedFrom;
	// 	this.dataLength = dataLength;
	// }

	constructor(tableData = {}, id = null) {
		//deal with the id: if one is inputted, then use it and update _counter; else use _counter
		if (id === null) {
			this.id = getNextId();
		} else {
			this.id = id;
			_counter = Math.max(id + 1, _counter + 1);
		}
		//Assign the other data
		this.name = tableData.name ?? null;
		this.columnRefs = tableData.columnRefs ?? [];
	}


	// getter and setter methods
	setName = (name) => {
		this.name = name;
	}

	// Function to add or remove a column of data from the table
	addColumn(col) {
		pushObj(col);
		this.columnRefs.push(col.id);
	}

	// need testing
	removeColumn(col) {
		this.columnRefs = this.columnRefs.filter((_, i) => i !== col.id);
	}


	// create simulated data through static function
	static simulateTable(Ndays, fs_min, startDate, periods, maxHeights) {
		const item = new Table();
		//importedFrom = `simulated(${Ndays},${maxHeights[0]})`
		item.setName(`Simulated_${item.id}`);
		item.simulateData(Ndays, fs_min, startDate, periods, maxHeights);
		return item;
	}

	simulateData(Ndays, fs_min, startDate, periods, maxHeights) {
		const dataLength = Ndays * 24 * (60 / fs_min);

		//time
		const dft = new Column();
		dft.simulateColumn('time', fs_min, startDate, periods, maxHeights, dataLength);
		
		this.addColumn(dft);

		//value
		for (let i = 0; i < periods.length; i++) {
			const dfv = new Column();
			dfv.simulateColumn('value', fs_min, startDate, periods[i], maxHeights[i], dataLength);
			
			this.addColumn(dfv);
		}
	}

	// Import and Export JSON
	toJSON() {
		return {
			id: this.id,
			name: this.name,
			columnRefs: this.columnRefs,
		};
	}

	static fromJSON(json) {
		// const { id, name, columnRefs } = json;
		// uncomment above and delete bottom after full transfer
		const id = json.id ?? json.tableid;
		const name = json.name ?? 'Untitled Table';
		const columnRefs = json.columnRefs ?? json.columnRefs ?? [];

		let table = new Table({ name, columnRefs }, id);
		return table;
	}
}

/*
	collection.push(new Ob(3, '✅ Class.toObj()').toObj())
*/