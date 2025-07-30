<script module>
	// @ts-nocheck

	import { Process } from '$lib/core/Process.svelte';
	import { core, appConsts } from '$lib/core/core.svelte.js';
	// import { timeParse } from 'd3-time-format';
	import { getUNIXDate } from '$lib/utils/time/TimeUtils.js';

	export function getColumnById(id) {
		const theColumn = core.data.find((column) => column.id === id);
		return theColumn;
	}

	let _columnIdCounter = 0;

	export class Column {
		id; //Unique Id for the column
		refId = $state(null); //if it is a column that is based on another
		tableProcessGUId = $state('');
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
				this.id = _columnIdCounter;
				_columnIdCounter++;
			} else {
				this.id = id;
				_columnIdCounter = Math.max(id + 1, _columnIdCounter + 1);
			}
			this.tableProcessGUId = '';

			//Assign the other data
			if (columnData) {
				console.log('CD: ', columnData);
				Object.assign(this, columnData);
			}

			// Object.assign(this, JSON.parse(JSON.stringify(columnData)));
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

		// DEBUG: Simulate data
		simulateColumn(type, fs_min, startDate, period, maxHeight, dataLength) {
			if (!this.name) {
				this.name = type;
			}

			this.type = type;
			switch (this.type) {
				case 'time':
					this.generateTimeData(fs_min, startDate, dataLength);
					break;
				case 'value':
					this.generateValueData(fs_min, period, maxHeight, dataLength);
					break;
				default:
					// TODO: UI warn user
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
			this.timeFormat = timefmt; //TODO: fix take DC-edits

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
					timeFormat: timeFormat ?? '',
					tableProcessGUId: tableProcessGUId ?? '',

					compression: compression ?? null,
					timeFormat: timeFormat ?? '',
					provenance: provenance ?? null
				},
				id
			);

			column.processes = [];
			if (Array.isArray(processes)) {
				for (const p of processes) {
					column.processes.push(Process.fromJSON(p, column));
				}
			}

			return column;
		}
	}
</script>

<script>
	import Processcomponent from '$lib/core/Process.svelte'; //Need to rename it because Process is used as the class name in the module, above
	import Icon from '$lib/icons/Icon.svelte';
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import AddProcess from '$lib/components/iconActions/AddProcess.svelte';

	import TypeSelector from '$lib/components/reusables/TypeSelector.svelte';

	let { col = $bindable(), canChange = false } = $props();

	let addBtnRef;
	let showAddProcess = $state(false);
	let dropdownTop = $state(0);
	let dropdownLeft = $state(0);

	function recalculateDropdownPosition() {
		if (!addBtnRef) return;
		const rect = addBtnRef.getBoundingClientRect();

		dropdownTop = rect.top + window.scrollY;
		dropdownLeft = rect.right + window.scrollX + 12;
	}

	let columnSelected = $state(-1);
	function openDropdown(e, id) {
		e.stopPropagation();
		columnSelected = id;
		recalculateDropdownPosition();
		requestAnimationFrame(() => {
			showAddProcess = true;
		});
		window.addEventListener('resize', recalculateDropdownPosition);
	}
</script>

{#if col == undefined}
	<p>Column is undefined</p>
{:else}
	<details open>
		<summary>
			<!-- Id: {col.id} -->
			{#if canChange}
				<ColumnSelector bind:value={col.refId} />
			{/if}

			<div class="data-collapsible-title-container">
				<TypeSelector bind:value={col.type} />
				<strong><input bind:value={col.name} /></strong>
				{col.type}
			</div>

			{#if !col.isReferencial()}
				<div class="data-component-info">
					<italic>{col.provenance}</italic>
				</div>
			{/if}
		</summary>
		<ul>
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

			{#each col.processes as p}
				{#key p.id}
					<!-- Force the refresh when a process is added or removed (mostly the latter)-->
					<Processcomponent {p} />
					<button onclick={() => col.removeProcess(p.id)}>
						<Icon name="close" width={16} height={16} /></button
					>
				{/key}
			{/each}
			<div class="add">
				<button bind:this={addBtnRef} onclick={(e) => openDropdown(e, col.id)}>
					<Icon name="add" width={16} height={16} />
				</button>
			</div>
		</ul>
	</details>
{/if}

{#if showAddProcess}
	<AddProcess
		bind:showDropdown={showAddProcess}
		columnSelected={col}
		{dropdownTop}
		{dropdownLeft}
	/>
{/if}

<style>
	.data-collapsible-title-container {
		display: flex;
		align-items: center;
		justify-content: flex-start;

		margin: 0;
	}

	.data-component-info p {
		font-size: 12px;
		text-align: left;
		color: var(--color-lightness-35);
		margin: 0;
	}

	.data-component-input p {
		font-size: 12px;
		text-align: left;
		color: var(--color-lightness-35);
		margin: 0;
	}

	/* General container for details */
	details {
		border: 1px solid var(--color-lightness-85);
		border-radius: 4px;
		padding: 0.5rem 0.75rem;
		background: var(--color-lightness-98);
	}

	/* Summary section clickable area */
	summary {
		display: flex;
		flex-direction: column;

		cursor: pointer;
		list-style: circle;
		font-size: 1rem;
		font-weight: 500;
		margin-bottom: 0.5rem;
	}

	summary strong input {
		border: none;
		background: transparent;
		font-size: 14px;

		font-weight: 600;
		color: inherit;
		padding: 0px;
		width: 100%;
		outline: none;
	}

	/* Provenance italic style */
	summary italic {
		font-style: italic;
		font-size: 12px;
		color: var(--color-lightness-35);
	}

	/* Select and input controls */
	select,
	input {
		font-size: 14px;
		font-weight: lighter;
		padding: 0.2rem 0.5rem;
		border: solid 1px transparent;

		border: solid 1px var(--color-lightness-85);
		border-radius: 2px;
		box-sizing: border-box;
		transition: border-color 0.2s;

		width: 100%;
		min-width: 0;
	}

	select:focus,
	input:focus {
		border: 1px solid #0275ff;
		box-shadow: 0 2px 5px rgba(2, 117, 255, 0.5);
		outline: none;
	}

	/* UL structure and list items */
	ul {
		margin: 0.5rem 0 0 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-size: 0.9rem;
	}

	ul li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.25rem 0;
		border-bottom: 1px solid #eee;
	}

	ul li:last-child {
		border-bottom: none;
	}
</style>
