<script module>
	// @ts-nocheck
	import { forceFormat, getPeriod } from '$lib/utils/time/TimeUtils';
	import { appState, core, pushObj } from '$lib/core/core.svelte.js';
	import { getColumnById, Column, removeColumn } from './Column.svelte';
	import { removeColumnFromPlots } from '$lib/core/Plot.svelte';
	import { TableProcess, deleteTableProcess } from '$lib/core/TableProcess.svelte';

	export function getTableById(id) {
		const theTable = core.tables.find((table) => table.id === id);
		return theTable;
	}

	export function exportTable(id) {
		//export the table as a csv file with the data
		const table = getTableById(id);
		if (!table) {
			console.error('Table not found with id:', id);
			return;
		}
		// Create a CSV string from the table data with headers (Column names) at the top and data below
		const headers = table.columns.map((col) => col.name).join(',') + '\n';
		const dataRows = table.columns[0]
			.getData()
			.map((_, rowIndex) => {
				return table.columns.map((col) => col.getData()[rowIndex]).join(',');
			})
			.join('\n');
		const csvString = headers + dataRows;
		const blob = new Blob([csvString], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = table.name + '.csv';
		a.click();
		URL.revokeObjectURL(url);
	}

	export function deleteTable(id) {
		appState.AYStext = `Are you sure you want to delete table ${getTableById(id).name}?`;
		appState.AYScallback = function handleAYS(option) {
			if (option === 'Yes') {
				const tableIdx = core.tables.findIndex((table) => table.id === id);

				//remove each table process in the table
				core.tables[tableIdx].processes.forEach((p) => {
					deleteTableProcess(p);
				});

				//store the columns to remove
				const columnsToRemove = $state.snapshot(core.tables[tableIdx].columnRefs);

				//remove the table
				core.tables = core.tables.splice(tableIdx, 1);

				//Remove the columns in the table
				columnsToRemove.forEach((colID) => {
					//need to check if the columns are used in any plots first
					removeColumnFromPlots(colID);
					//remove the column itself
					removeColumn(colID);
				});
			}
		};
		appState.showAYSModal = true;
	}

	let _counter = 0;
	function getNextId() {
		return _counter++;
	}

	export class Table {
		id;
		name = $state('');
		contents = $state([]);

		columnRefs = $state([]); //Reference Ids for the raw data that are columns

		columns = $derived.by(() => {
			console.log(this.columnRefs);
			return this.columnRefs.map((colRef) => getColumnById(colRef));
		}); //The actual columns of data

		processes = $state([]);

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
			this.processes = tableData.processes ?? [];
		}

		// getter and setter methods
		setName = (name) => {
			this.name = name;
		};

		// Function to add or remove a column of data from the table
		addColumn(col) {
			pushObj(col);
			this.columnRefs.push(col.id);
		}

		// need testing
		removeColumn(col) {
			this.columnRefs = this.columnRefs.filter((_, i) => i !== col.id);
		}

		// Import and Export JSON
		toJSON() {
			return {
				id: this.id,
				name: this.name,
				columnRefs: this.columnRefs,
				processes: this.processes
			};
		}

		static fromJSON(json) {
			// const { id, name, columnRefs } = json;
			// uncomment above and delete bottom after full transfer
			const id = json.id ?? json.tableid;
			const name = json.name ?? 'Untitled Table';
			const columnRefs = json.columnRefs ?? json.columnRefs ?? [];

			let table = new Table({ name, columnRefs }, id);
			if (json.processes) {
				json.processes.forEach((process) => {
					const tempProcess = new TableProcess(process, table, process.id);

					//add the process
					table.processes.push(tempProcess);
					//remove the columns that are in the process so they aren't duplicated.
					Object.keys(tempProcess.args.out).forEach((key) => {
						table.columnRefs = table.columnRefs.filter((col) => col !== tempProcess.args.out[key]);
					});
				});
			}
			return table;
		}
	}
</script>
