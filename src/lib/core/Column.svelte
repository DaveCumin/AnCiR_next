<script module>
	import { Process } from '$lib/core/Process.svelte';
	import { core, appConsts } from '$lib/core/core.svelte.js';
	// import { timeParse } from 'd3-time-format';
	import { getUNIXDate } from '$lib/utils/time/TimeUtils.js';

	export function getColumnById(id) {
		const theColumn = core.data.find((column) => column.id === id);
		return theColumn;
	}

	let _columnidCounter = 0;

	export class Column {
		id; //Unique Id for the column
		refId = $state(null); //if it is a column that is based on another
		tableProcessGUId = $state([]);
		data = null; //if it has raw data, store that here
		compression = $state(null); //if any compression is used, store the info here
		//Where the data are from (references all the way to the primary source [importd (file) or simulated (params)])
		provenance = $derived.by(() => {
			if (this.isReferencial()) {
				return (
					'refers to ' +
					getColumnById(this.refId)?.name +
					' which is ' +
					getColumnById(this.refId)?.provenance
				);
			}
		});
		//Name for the column - make it the referenced one if it is referencial
		name = $derived.by(() => {
			if (this.customName !== null) {
				return this.customName; // Prioritize custom name if set
			}
			if (this.isReferencial()) {
				this.customName = getColumnById(this.refId)?.name + '*';
				return getColumnById(this.refId)?.name + '*';
			}
		});
		customName = null;
		//Type of data - if it is referencial, then get the type from the reference
		type = $derived.by(() => {
			if (this.isReferencial()) {
				return getColumnById(this.refId)?.type;
			}
		});
		//time format for converting time data
		timeFormat = $state([]);

		//The associated processes that are applied to the data
		processes = $state([]);

		hoursSinceStart = $derived.by(() => {
			const thedata = this.getData();
			if (this.type == 'number') return thedata.map((x) => x - thedata[0]); //If a number, then assume it's in hours and take difference from the start
			if (this.type == 'time') return thedata.map((x) => (x - thedata[0]) / 3600000); //if it's a time, then assume it's in milliseconds and take difference from the start, then convert to hours
			//console.warn('that was hoursSinceStart');
		});

		constructor(columnData = null, id = null) {
			if (id === null) {
				this.id = _columnidCounter;
				_columnidCounter++;
			} else {
				this.id = id;
				_columnidCounter = Math.max(id + 1, _columnidCounter + 1);
			}
			this.tableProcessGUId = '';
			//Assign the other data
			if (columnData) {
				console.log('CD: ', columnData);
				Object.assign(this, columnData);
			}
		}

		//To add and remove processes
		addProcess(processName) {
			const newProcess = new Process({ name: processName }, this);
			this.processes.push(newProcess);
			return newProcess.id;
		}

		removeProcess(id) {
			this.processes = this.processes.filter((p) => p.id !== id);
		}

		//Helper function to see if the column is referencial
		isReferencial() {
			return this.refId != null;
		}

		//For caching of the data - important for efficiency
		#cachedData = null;
		#lastDataHash = null;

		getDataHash() {
			const processHash =
				this.tableProcessGUId +
				':' +
				this.processes.map((p) => `${p.id}:${p.name}:${JSON.stringify(p.args)}`).join('|');

			const refColumn = this.isReferencial() ? getColumnById(this.refId) : null;
			const refDataHash = refColumn ? refColumn.getDataHash() : '';
			return `${this.refId ?? '_'}:${this.data?.length || ''}:${this.compression || ''}:${this.type}:${this.timeFormat}:${processHash}:${refDataHash}`;
		}

		//--- FUNCTION TO GET THE DATA
		getData() {
			// Create a hash of all inputs to detect changes
			const dataHash = this.getDataHash();
			// console.log('data hash: ', dataHash, ' for ', this.id, this.name);
			// console.log('last hash: ', this.#lastDataHash);
			if (this.#lastDataHash === dataHash && this.#cachedData) {
				// console.log('returning cached');
				return this.#cachedData;
			}

			// console.warn('recalculating');

			let out = [];
			//if there is a reference, then just get that data
			if (this.refId != null) {
				out = core.data.find((column) => column.id === this.refId)?.getData();
			} else {
				//deal with compressed data
				if (this.compression === 'awd') {
					out = [];
					for (let a = 0; a < this.data.length; a += this.data.step) {
						out.push(this.data.start + a);
					}
				} else {
					//get the raw data
					out = this.data;
				}
			}

			//deal with timestamps
			if (this.type === 'time' && !this.isReferencial()) {
				// out = out.map((x) => Number(timeParse(this.timeFormat)(x))); // Turn into UNIX values of time
				out = out.map((x) => Number(getUNIXDate(x, this.timeFormat))); // Turn into UNIX values of time
			}

			//If no data, return empty
			if (out == []) return [];

			//otherwise apply the processes
			for (const p of this.processes) {
				out = p.doProcess(out);
			}

			//save hash
			this.#cachedData = out;
			this.#lastDataHash = dataHash;

			//return data
			return out;
		}

		//Save and load the column to and from JSON
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
			jsonOut.tableProcessGUId = this.tableProcessGUId;
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
				tableProcessGUId,
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
					tableProcessGUId: tableProcessGUId ?? '',
					processes: []
				},
				id
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
	import Icon from '$lib/icons/Icon.svelte';
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	let { col, canChange = false } = $props();
</script>

{#if col == undefined}
	<p>Column is undefined</p>
{:else}
	<details open style="margin-left: 1rem">
		<summary>
			Id: {col.id}
			{#if canChange}
				<ColumnSelector bind:value={col.refId} />
			{/if}
			<strong><input bind:value={col.name} /></strong><br />
			{#if !col.isReferencial()}
				<italic>{col.provenance}</italic><br />
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
			<!-- {#if col.type == 'number'}[{Math.min(...col.getData())},{Math.max(...col.getData())}]{/if} -->
			{#if col.type == 'time'}
				<br />
				Time format:
				{#if !canChange}
					<input bind:value={col.timeFormat} />
				{:else}
					{getColumnById(col.refId)?.timeFormat}
				{/if}
			{/if}
			{#if col.compression != null}
				<br />
				Compression: {col.compression}
			{/if}
			<li>
				{#if !col.isReferencial() && Array.isArray(col.data)}
					<p>raw: {col.data.slice(0, 5)}</p>
				{/if}
				data: {col.getData()?.slice(0, 5)}
				N: {col.getData().length}
				hoursSince: {col.hoursSinceStart?.slice(0, 5)}
				<button
					onclick={() => {
						const proc = [...appConsts.processMap.entries()][
							Math.floor(Math.random() * [...appConsts.processMap.entries()].length)
						];

						col.addProcess(proc[0]);
					}}><Icon name="add" width={16} height={16} /></button
				>
			</li>
			{#each col.processes as p}
				{#key p.id}
					<!-- Force the refresh when a process is added or removed (mostly the latter)-->
					<Processcomponent {p} />
					<button onclick={() => col.removeProcess(p.id)}>
						<Icon name="close" width={16} height={16} /></button
					>
				{/key}
			{/each}
		</ul>
	</details>
{/if}
