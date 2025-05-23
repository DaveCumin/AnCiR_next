<script module>
	import { getColumnByID } from '$lib/core/Column.svelte';
	let _tableidCounter = 0;

	export class Table {
		tableid; //Unique ID for the table
		name = $state(); //name of the table
		columnRefs = $state([]); //Reference IDs for the raw data that are columns
		columns = $derived.by(() => {
			return this.columnRefs.map((colRef) => getColumnByID(colRef));
		}); //The actual columns of data
		constructor({ ...dataIN }, id = null) {
			//deal with the id: if one is inputted, then use it and update _tableidCounter; else use _tableidCounter
			if (id === null) {
				this.tableid = id ?? _tableidCounter;
				_tableidCounter++;
			} else {
				this.tableid = id;
				_tableidCounter = Math.max(id + 1, _tableidCounter + 1);
			}
			//Assign the other data
			Object.assign(this, structuredClone(dataIN));
		}

		//Function to add or remove a column of data from the table
		addColumn(dataIN) {
			this.columnRefs.push(dataIN);
		}
		removeColumn(idx) {
			this.columnRefs = this.columnRefs.filter((_, i) => i !== idx);
		}

		//Write to JSON (for saving state)
		toJSON() {
			return {
				tableid: this.tableid,
				name: this.name,
				columnRefs: this.columns.map((col) => col.columnID)
			};
		}
		//Read from JSON (for loading state)
		static fromJSON(json) {
			const { tableid, name, columnRefs } = json;
			let table = new Table({ name, columnRefs }, tableid);
			return table;
		}
	}
</script>

<script>
	//Each instance of the component to render
	import Column from './Column.svelte';
	let { table } = $props();
</script>

<details open>
	<summary>{table.tableid} - {table.name}</summary>
	{#each table.columns as col}
		<Column {col} />
	{/each}
</details>
