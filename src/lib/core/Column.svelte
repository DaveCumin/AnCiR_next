<script module>
	import { Process } from '$lib/core/Process.svelte';
	import { core, appConsts } from '$lib/core/theCore.svelte.js';
	import { timeParse } from 'd3-time-format';

	export function getColumnByID(id) {
		const theColumn = core.data.find((column) => column.columnID === id);
		return theColumn;
	}

	let _columnidCounter = 0;

	export class Column {
		columnID; //Unique ID for the column
		refDataID = $state(null); //if it is a column that is based on another
		rawData = null; //if it has raw data, store that here
		compression = $state(null); //if any compression is used, store the info here
		//Where the data are from (references all the way to the primary source [importd (file) or simulated (params)])
		provenance = $derived.by(() => {
			if (this.isReferencial()) {
				return (
					'refers to ' +
					getColumnByID(this.refDataID)?.name +
					' which is ' +
					getColumnByID(this.refDataID)?.provenance
				);
			}
		});
		//Name for the column - make it the referenced one if it is referencial
		name = $derived.by(() => {
			if (this.isReferencial()) {
				return getColumnByID(this.refDataID)?.name + '*';
			}
		});
		//Type of data - if it is referencial, then get the type from the reference
		type = $derived.by(() => {
			if (this.isReferencial()) {
				return getColumnByID(this.refDataID)?.type;
			}
		});
		//time format for converting time data
		timeformat = $derived(this.type === 'time' ? 0 : null);

		//The associated processes that are applied to the data
		processes = $state([]);

		constructor({ ...columnData }, id = null) {
			if (id === null) {
				this.columnID = _columnidCounter;
				_columnidCounter++;
			} else {
				this.columnID = id;
				_columnidCounter = Math.max(id + 1, _columnidCounter + 1);
			}
			//Assign the other data
			Object.assign(this, structuredClone(columnData));
		}

		//To add and remove processes
		addProcess(processName) {
			this.processes.push(new Process({ name: processName }, this));
		}
		removeProcess(id) {
			this.processes = this.processes.filter((p) => p.processid !== id);
		}

		//Helper function to see if the column is referencial
		isReferencial() {
			return this.refDataID != null;
		}

		//Magic function to get the data, apply time formatting, and apply procesess; will recursively follow the refDataID if needed
		getData() {
			let out = [];
			//if there is a reference, then just get that data
			if (this.refDataID != null) {
				out = core.data.find((column) => column.columnID === this.refDataID)?.getData();
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
			}

			//deal with timestamps
			if (this.type === 'time' && !this.isReferencial()) {
				out = out.map((x) => Number(timeParse(this.timeformat)(x))); // Turn into UNIX values of time
			}

			//If no data, return empty
			if (out == []) return [];

			//otherwise apply the processes
			for (const p of this.processes) {
				out = p.doProcess(out);
			}
			return out;
		}

		getHoursSinceStart() {
			const raw = this.getData();
			if (this.type == 'number') return raw.map((x) => x - raw[0]); //If a number, then assume it's in hours and take difference from the start
			if (this.type == 'time') return raw.map((x) => (x - raw[0]) / 3600000); //if it's a time, then assume it's in milliseconds and take difference from the start, then convert to hours
		}

		//Save and load the column to and from JSON
		toJSON() {
			let jsonOut = { columnID: this.columnID, name: this.name };
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
			jsonOut.provenance = this.provenance;
			jsonOut.processes = this.processes;

			return jsonOut;
		}
		static fromJSON(json) {
			const {
				columnID,
				name,
				type,
				refDataID,
				rawData,
				timeformat,
				processes,
				compression,
				provenance
			} = json;
			let column = new Column(
				{
					name,
					type,
					refDataID: refDataID ?? null,
					rawData: rawData ?? null,
					compression: compression ?? null,
					timeformat: timeformat ?? '',
					provenance: provenance ?? null,
					processes: []
				},
				columnID
			);
			if (processes?.length > 0) {
				processes.map((p) => column.processes.push(Process.fromJSON(p, column)));
			}
			return column;
		}
	}
</script>

<script>
	import Processcomponent from '$lib/core/Process.svelte'; //Need to rename it because Process is used as the class name in the module, above
	import Icon from '$lib/icon/Icon.svelte';
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	let { col, canChange = false } = $props();
</script>

<details open style="margin-left: 1rem">
	<summary>
		{#if canChange}
			<ColumnSelector bind:value={col.refDataID} />
		{/if}
		{#if !col.isReferencial()}
			<strong>{col.name}</strong><br /> <italic>{col.provenance}</italic><br />
		{/if}
		type:
		<select name="datatype" bind:value={col.type}>
			<option value="time">Time</option>
			<option value="number">Number</option>
			<option value="category">Category</option>
		</select></summary
	>
	<ul>
		{col.type}
		{#if col.type == 'number'}[{Math.min(...col.getData())},{Math.max(...col.getData())}]{/if}
		{#if col.type == 'time'}
			<br />
			Time format:
			{#if !canChange}
				<input bind:value={col.timeformat} />
			{:else}
				{getColumnByID(col.refDataID)?.timeformat}
			{/if}
		{/if}
		{#if col.compression != null}
			<br />
			Compression: {col.compression}
		{/if}
		<li>
			{#if !col.isReferencial() && Array.isArray(col.rawData)}
				<p>raw: {col.rawData.slice(0, 5)}</p>
			{/if}
			data: {col.getData()?.slice(0, 5)}
			hoursSince: {col.getHoursSinceStart()?.slice(0, 5)}
			<button
				onclick={() => {
					const proc = [...appConsts.processMap.entries()][
						Math.floor(Math.random() * [...appConsts.processMap.entries()].length)
					];
					console.log(proc[0]);
					col.addProcess(proc[0]);
				}}><Icon name="add" width={16} height={16} /></button
			>
		</li>
		{#each col.processes as p}
			<Processcomponent {p} />
			<button onclick={() => col.removeProcess(p.processid)}>
				<Icon name="close" width={16} height={16} /></button
			>
		{/each}
	</ul>
</details>
