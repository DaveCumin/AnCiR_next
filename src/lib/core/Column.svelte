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
		refColumn = $derived(getColumnById(this.refId)); // Direct reference to the referenced column
		tableProcessGUId = $state('');
		data = null; //if it has raw data, store that here
		compression = $state(null); //if any compression is used, store the info here
		//Where the data are from (references all the way to the primary source [importd (file) or simulated (params)])
		provenance = $derived.by(() => {
			if (this.isReferencial()) {
				return `refers to ${this.refColumn?.name} which is ${this.refColumn?.provenance}`;
			}
			return ''; // Define default provenance for non-referential columns
		});
		//Name for the column - make it the referenced one if it is referencial
		name = $derived.by(() => {
			if (this.customName !== null) return this.customName;
			if (this.isReferencial()) {
				this.customName = this.refColumn?.name + '*';
				return this.refColumn?.name + '*';
			}
			return this.customName || 'Unnamed';
		});
		customName = null;
		//Type of data - if it is referencial, then get the type from the reference
		type = $derived.by(() => {
			if (this.isReferencial()) return this.refColumn?.type;
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

			//Assign the other data
			if (columnData) {
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

		getDataHash = $derived.by(() => {
			const processHash = this.processes
				.map((p) => {
					const argsStr = JSON.stringify(p.args); // Deep hash of process args
					return `${p.id}:${p.name}:${argsStr}`;
				})
				.join('|');
			const refDataHash = this.isReferencial() ? this.refColumn?.getDataHash : '';
			return `${this.refId ?? '_'}:${this.compression || ''}:${this.type}:${this.timeFormat}:${processHash}:${refDataHash}:${this.tableProcessGUId}`;
		});

		//--- FUNCTION TO GET THE DATA
		getData() {
			// Create a hash of all inputs to detect changes
			const dataHash = this.getDataHash;
			// console.log('data hash: ', dataHash, ' for ', this.id, this.name);
			// console.log('last hash: ', this.#lastDataHash);
			if (this.#lastDataHash === dataHash && this.#cachedData) {
				// console.log('returning cached');
				return this.#cachedData;
			}

			// console.warn('recalculating');

			let out = [];
			//if there is a reference, then just get that data
			if (this.refId != null && this.refColumn) {
				out = this.refColumn.getData();
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
	// @ts-nocheck
	import Icon from '$lib/icons/Icon.svelte';
	import Processcomponent from '$lib/core/Process.svelte'; //Need to rename it because Process is used as the class name in the module, above
	import AddProcess from '$lib/components/iconActions/AddProcess.svelte';
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import TypeSelector from '$lib/components/reusables/TypeSelector.svelte';

	import { appState } from '$lib/core/core.svelte.js';

	let { col = $bindable(), canChange = false, onChange = () => {} } = $props();

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
	let openClps = $state({});

	function openDropdown(e, id) {
		e.preventDefault();
		e.stopPropagation();

		columnSelected = id;

		const rect = event.currentTarget.getBoundingClientRect();
		dropdownTop = rect.top + window.scrollY;
		dropdownLeft = rect.right + window.scrollX + 12;
		showAddProcess = true;

		openClps[id] = true;
	}

	let openMenus = $state({});
	function toggleMenu(id) {
		openMenus[id] = !openMenus[id];
	}
</script>

{#if col == undefined}
	<p>Column is undefined</p>
{:else}
	<div class="clps-container">
		<details class="clps-item" bind:open={openClps[col.id]}>
			<summary class="clps-title-container">
				<div class="column-indicator"></div>

				<div
					class="clps-title"
					onclick={(e) => {
						e.preventDefault();
						e.stopPropagation();
					}}
				>
					<TypeSelector bind:value={col.type} />

					{#if canChange}
						<div>
							<ColumnSelector bind:value={col.refId} bind:onChange />
						</div>
					{:else}
						<p
							contenteditable="false"
							ondblclick={(e) => {
								e.target.setAttribute('contenteditable', 'true');
								e.target.focus();
							}}
							onfocusout={(e) => e.target.setAttribute('contenteditable', 'false')}
							bind:innerHTML={col.name}
						></p>
					{/if}
				</div>

				<div class="clps-title-button">
					<button
						class="icon"
						onclick={(e) => {
							e.stopPropagation();
							toggleMenu(col.id);
							openDropdown(e, col.id);
						}}
					>
						<Icon name="menu-horizontal-dots" width={20} height={20} className="menu-icon" />
					</button>

					{#if openClps[col.id]}
						<Icon name="caret-down" width={20} height={20} className="second-detail-title-icon" />
					{:else}
						<Icon name="caret-right" width={20} height={20} className="second-detail-title-icon" />
					{/if}
				</div>
			</summary>

			<div class="clps-content-container">
				<div class="data-component-info">
					{#if !canChange}
						{#if !col.isReferencial()}
							<div>
								<italic><p>{col.provenance}</p></italic>
							</div>
						{:else}
							<div>
								<italic><p>primary source</p></italic>
								<!-- TODO: check with DC how to name-->
							</div>
						{/if}
					{/if}
				</div>

				<div class="line"></div>

				<!-- {#if col.type == 'number'}[{Math.min(...col.getData())},{Math.max(...col.getData())}]{/if} -->
				<div class="control-input display">
					{#if col.type == 'time'}
						<p>Time Format</p>
						{#if !canChange}
							<input bind:value={col.timeFormat} />
						{:else}
							{getColumnById(col.refId)?.timeFormat}
						{/if}
					{/if}
				</div>

				<div class="process-container">
					{#each col.processes as p}
						{#key p.id}
							<!-- Force the refresh when a process is added or removed (mostly the latter)-->
							<div class="single-process-container">
								<div class="column-indicator"></div>
								<Processcomponent {p} />
							</div>
						{/key}
					{/each}
				</div>
			</div>

			<div class="block"></div>
		</details>
	</div>
{/if}

<AddProcess bind:showDropdown={showAddProcess} columnSelected={col} {dropdownTop} {dropdownLeft} />

<style>
	/* .data-collapsible-title-container {
		width: 100%;
		min-width: 0;

		display: flex;
		flex: 1 1 0;
		flex-direction: row;
		align-items: center;
		justify-content: flex-start;

		margin: 0;
		padding: 0;
	} */

	.data-component-info {
		display: flex;
		flex-direction: column;
		width: 100%;

		font-size: 12px;
		text-align: left;
		color: var(--color-lightness-35);

		margin: 0;
		padding: 0;

		gap: 0.25rem;
	}

	.data-component-info p {
		margin: 0;
		padding: 0;
	}

	.line {
		width: 100%;
		height: 1px;

		background-color: var(--color-lightness-85);

		margin: 0.25rem 0 0.5rem 0;
	}

	.block {
		width: 100%;
		height: 0.75rem;

		background-color: transparent;
	}

	/* General container */

	.clps-container {
		display: flex;
		flex: 1 1 0;
		position: relative;

		width: 100%;
		min-width: 0;

		border-radius: 4px;

		margin: 0.25rem 0;
	}

	.clps-container:hover {
		background-color: var(--color-lightness-97);
	}

	.clps-content-container {
		width: calc(100% - (0.5rem + 0.5rem) + 6px);
		/* note: width: calc(100% - (0.5rem + margin-left) + 6px)*/
		min-width: 0;

		display: flex;
		flex-direction: column;
		flex: 1 1 0;

		margin: 0 0 0 0.5rem;
		padding: 0;
	}

	.clps-title {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: center;

		min-width: 0;

		margin: 0;
		padding: 0;

		gap: 0.5rem;
	}

	details {
		width: 100%;
		min-width: 0;

		margin: 0.25rem 0.25rem 0.25rem 0.5rem;
		padding: 0;
	}

	summary {
		width: 100%;
		min-width: 0;

		list-style: none;

		display: flex;
		flex: 1 1 0;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;

		margin: 0;
		padding: 0;
	}

	summary p {
		margin: 0;
		padding: 0;
	}

	summary button {
		margin: 0;
		padding: 0;
	}

	summary .icon {
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.2s ease;
	}

	details:hover summary .icon {
		opacity: 1;
		pointer-events: auto;
	}

	/* Provenance italic style */
	italic {
		font-style: italic;
		font-size: 12px;
		color: var(--color-lightness-35);
	}

	/* Select and input controls */
	select,
	input {
		height: var(--control-input-height);
		width: auto;
		min-width: 0;
		box-sizing: border-box;

		padding: 0.2rem 0.5rem;
		background-color: transparent;

		font-size: 14px;
		font-weight: lighter;

		border: solid 1px transparent;
		border-radius: 2px;

		transition: border-color 0.2s;
	}

	input[readonly]:focus {
		border: 1px solid transparent;
		outline: none;
	}

	.display {
		margin: 0;
		margin-bottom: 0.5rem;
	}

	.process-container {
		display: flex;
		flex-direction: column;
		margin: 0;
		gap: 0.5rem;
	}
</style>
