<script module>
	// @ts-nocheck

	import { Process, nextLinkedGroupId, getLinkedProcesses } from '$lib/core/Process.svelte';
	import { core, appConsts } from '$lib/core/core.svelte.js';
	// import { timeParse } from 'd3-time-format';
	import { getUNIXDate } from '$lib/utils/time/TimeUtils.js';

	/**
	 * Add the same process to multiple columns at once.
	 * If more than one column is provided, the processes are linked
	 * so that changing args on one updates all the others.
	 * All linked processes share the same args object.
	 */
	export function addProcessToColumns(columns, processName) {
		const groupId = columns.length > 1 ? nextLinkedGroupId() : null;
		let sharedArgs = null;
		for (const col of columns) {
			const newProcess = new Process({ name: processName, linkedGroupId: groupId }, col);
			if (groupId != null) {
				if (sharedArgs === null) {
					sharedArgs = newProcess.args;
				} else {
					newProcess.args = sharedArgs;
				}
			}
			col.processes.push(newProcess);
		}
	}

	/**
	 * After deserializing from JSON, linked processes each have their own
	 * args copy. This function re-links them so they share the same object.
	 */
	export function relinkLinkedProcessArgs() {
		const seen = new Map();
		for (const col of core.data) {
			for (const p of col.processes) {
				if (p.linkedGroupId == null) continue;
				if (seen.has(p.linkedGroupId)) {
					p.args = seen.get(p.linkedGroupId);
				} else {
					seen.set(p.linkedGroupId, p.args);
				}
			}
		}
	}

	export function getColumnById(id) {
		const theColumn = core.data.find((column) => column.id === id);
		return theColumn;
	}

	function doRemoveColumn(columnId) {
		appState.AYStext = `Are you sure you want to delete ${getColumnById(columnId).name}?`;
		appState.AYScallback = function handleAYS(option) {
			if (option === 'Yes') {
				removeColumn(columnId);
			}
		};
		appState.showAYSModal = true;
	}
	export function removeColumn(columnId) {
		// Step 1: Find all columns that reference the column being removed
		const dependentColumns = core.data.filter((col) => col.refId === columnId);

		// Step 2: Recursively handle dependent columns
		// Set their refId to -1 to break the reference chain
		dependentColumns.forEach((col) => {
			col.refId = -1;
		});

		// Step 3: Remove from all table processes
		core.tables.forEach((table) => {
			table.processes.forEach((process) => {
				const args = process.args;

				// Handle single column inputs (xIN, yIN, etc.)
				if (args.xIN === columnId) args.xIN = -1;
				if (args.yIN === columnId) args.yIN = -1;

				// Handle array of column inputs (xsIN, etc.)
				if (Array.isArray(args.xsIN)) {
					args.xsIN = args.xsIN.filter((id) => id !== columnId);
				}

				// Handle output columns - if this is an output column, mark it invalid
				if (args.out) {
					Object.keys(args.out).forEach((outKey) => {
						if (args.out[outKey] === columnId) {
							args.out[outKey] = -1;
						}
					});
				}
			});

			// Remove from table's column references
			table.columnRefs = table.columnRefs.filter((colId) => colId !== columnId);
		});

		// Step 4: Remove from all plots/tables
		core.plots.forEach((plot) => {
			if (plot.plot && plot.plot.columnRefs) {
				plot.plot.columnRefs = plot.plot.columnRefs.filter((colId) => colId !== columnId);
			}

			// Handle plot-specific column references
			if (plot.plot.columnRefs) {
				plot.plot.columnRefs = plot.plot.columnRefs.filter((colId) => colId !== columnId);
			}
		});

		// Step 5: Remove the column itself from core.data
		core.rawData.delete(columnId);
		core.data = core.data.filter((col) => col.id !== columnId);

		return {
			success: true,
			removedColumnId: columnId,
			dependentColumnsAffected: dependentColumns.length,
			message: `Column ${columnId} safely removed. ${dependentColumns.length} dependent column(s) had their references cleared.`
		};
	}

	let _columnIdCounter = 0;

	export class Column {
		id; //Unique Id for the column
		refId = $state(null); //if it is a column that is based on another
		refColumn = $derived(getColumnById(this.refId)); // Direct reference to the referenced column
		tableProcessGUId = $state('');
		data = null; //if it has raw data, store the id here
		compression = $state(null); //if any compression is used, store the info here
		binWidth = $derived.by(() => {
			if (this.isReferencial()) return this.refColumn?.binWidth;
		});
		originTime_ms = $derived.by(() => {
			if (this.isReferencial()) return this.refColumn?.originTime_ms;
		});
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

		// Bump this to bust the getData() cache when rawData is mutated directly (e.g. time cell edits)
		rawDataVersion = $state(0);

		hoursSinceStart = $derived.by(() => {
			if (this.isReferencial()) {
				return this.refColumn?.hoursSinceStart;
			}

			if (!this.isReferencial() && this.compression === 'awd' && this.processes.length === 0) {
				const raw = core.rawData.get(this.data);
				const length = raw.length;
				const step = raw.step;
				const out = new Array(length);

				if (this.type === 'number') {
					for (let i = 0; i < length; i++) {
						out[i] = i * step;
					}
					return out;
				}
				if (this.type === 'bin') {
					for (let i = 0; i < length; i++) {
						out[i] = i * step;
					}
					return out;
				}
				if (this.type === 'time') {
					for (let i = 0; i < length; i++) {
						out[i] = (i * step) / 3600000;
					}
					return out;
				}
			}
			//Other cases
			const thedata = this.getData();
			if (this.type == 'number') {
				let out = Array(thedata.length);
				for (let i = 0; i < thedata.length; i++) {
					out[i] = thedata[i] - thedata[0];
				}
				return out;
			}
			if (this.type == 'bin') {
				let out = Array(thedata.length);
				for (let i = 0; i < thedata.length; i++) {
					out[i] = thedata[i] - thedata[0];
				}
				return out;
			}
			if (this.type == 'time') {
				let out = Array(thedata.length);
				for (let i = 0; i < thedata.length; i++) {
					out[i] = (thedata[i] - thedata[0]) / 3600000;
				}
				return out;
			}
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
			return `${this.refId ?? '_'}:${this.compression || ''}:${this.type}:${this.timeFormat}:${this.binWidth || ''}:${processHash}:${refDataHash}:${this.tableProcessGUId}:${this.rawDataVersion}`;
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

			if (this.refId === -1) {
				//broken reference
				console.warn('Column ', this.id, this.name, ' has a broken reference.');
				return [];
			}

			let out = [];
			//if there is a reference, then just get that data
			if (this.refId != null) {
				out = getColumnById(this.refId).getData();
			} else {
				//deal with compressed data
				if (this.compression === 'awd') {
					const raw = core.rawData.get(this.data);
					out = new Array(raw.length);
					for (let i = 0; i < raw.length; i++) {
						out[i] = raw.start + i * raw.step;
					}
				} else {
					//get the raw data
					out = core.rawData.get(this.data);
				}
			}

			//deal with timestamps (skip for AWD-compressed columns — already UNIX ms)
			if (this.type === 'time' && !this.isReferencial() && this.compression !== 'awd') {
				try {
					out = out.map((x) => Number(getUNIXDate(x, this.timeFormat))); // Turn into UNIX values of time
				} catch {
					console.warn('Error parsing time data for column ', this.id, this.name);
				}
			}

			//deal with bins
			if (this.type === 'bin') {
				out = out.map((x) => x + this.binWidth / 2);
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
			if (this.type == 'bin') {
				jsonOut.binWidth = this.binWidth;
			}
			if (this.originTime_ms != null) {
				jsonOut.originTime_ms = this.originTime_ms;
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
				binWidth,
				originTime_ms,
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
					binWidth: binWidth ?? null,
					tableProcessGUId: tableProcessGUId ?? '',
					originTime_ms: originTime_ms ?? null,

					compression: compression ?? null,
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
	import Editable from '$lib/components/inputs/Editable.svelte';
	import { get } from 'svelte/store';
	import { guessDateofArray } from '$lib/utils/time/TimeUtils.js';

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

	// Drag-to-reorder processes
	let dragIdx = $state(null);
	let dragOverIdx = $state(null);

	function onDragStart(e, idx) {
		dragIdx = idx;
		e.dataTransfer.effectAllowed = 'move';
	}

	function onDragOver(e, idx) {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		dragOverIdx = idx;
	}

	function onDrop(e, idx) {
		e.preventDefault();
		if (dragIdx != null && dragIdx !== idx) {
			const items = [...col.processes];
			const [moved] = items.splice(dragIdx, 1);
			items.splice(idx, 0, moved);
			col.processes = items;
		}
		dragIdx = null;
		dragOverIdx = null;
	}

	function onDragEnd() {
		dragIdx = null;
		dragOverIdx = null;
	}

	function onTypeChange(newType) {
		if (newType !== 'time') return;
		const fmt = col.timeFormat;
		const isEmpty = !fmt || (Array.isArray(fmt) ? fmt.length === 0 : fmt === '');
		if (!isEmpty) return;
		const rawData = core.rawData.get(col.data);
		if (!Array.isArray(rawData) || rawData.length === 0) return;
		const sample = rawData.slice(0, 10);
		const guessed = guessDateofArray(sample);
		if (guessed !== -1 && guessed.length > 0) {
			col.timeFormat = guessed;
		}
	}
</script>

{#if col == undefined}
	<p>Column is undefined</p>
{:else}
	<div class="clps-container">
		<details class="clps-item" bind:open={openClps[col.id]}>
			<summary
				class="clps-title-container"
				onclick={(e) => e.preventDefault()}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') e.preventDefault();
				}}
			>
				<!-- <div class="column-indicator"></div> -->

				<div class="clps-title">
					<TypeSelector bind:value={col.type} onChange={onTypeChange} />

					{#if canChange}
						<div>
							<ColumnSelector bind:value={col.refId} bind:onChange />
						</div>
					{:else}
						<p><Editable bind:value={col.name} /></p>
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
						<Icon name="add" width={18} height={18} className="menu-icon" />
					</button>

					{#if col.tableProcessGUId == '' && col.refId == null}
						<button class="icon" onclick={(e) => doRemoveColumn(col.id)}>
							<Icon name="minus" width={18} height={18} className="menu-icon" />
						</button>
					{/if}

					<button
						class="icon"
						onclick={() => {
							openClps[col.id] = !openClps[col.id];
						}}
					>
						{#if openClps[col.id]}
							<Icon name="caret-down" width={20} height={20} className="second-detail-title-icon" />
						{:else}
							<Icon name="caret-right" width={20} height={20} className="second-detail-title-icon" />
						{/if}
					</button>
				</div>
			</summary>

			<div class="clps-content-container">
				<div class="data-component-info" style="display:none;">
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
					{#each col.processes as p, i}
						{#key p.id}
							<!-- Force the refresh when a process is added or removed (mostly the latter)-->
							<div
								class="single-process-container"
								class:linked-process={p.linkedGroupId != null}
								class:drag-over={dragOverIdx === i && dragIdx !== i}
								draggable="true"
								ondragstart={(e) => onDragStart(e, i)}
								ondragover={(e) => onDragOver(e, i)}
								ondrop={(e) => onDrop(e, i)}
								ondragend={onDragEnd}
							>
								<div class="drag-handle" title="Drag to reorder">⠇</div>
								{#if p.linkedGroupId != null}
									<div class="linked-badge" title="Linked – args shared with other columns">⟁</div>
								{/if}
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

	.linked-process {
		border-left: 2px solid var(--color-lightness-35, #555);
		padding-left: 0.35rem;
	}

	.linked-badge {
		font-size: 10px;
		color: var(--color-lightness-35, #555);
		line-height: 1;
		margin-bottom: 0.1rem;
	}

	.drag-handle {
		cursor: grab;
		user-select: none;
		font-size: 12px;
		line-height: 1;
		color: var(--color-lightness-65, #aaa);
		padding: 0 0.1rem;
		opacity: 0;
		transition: opacity 0.15s ease;
	}

	.drag-handle:active {
		cursor: grabbing;
	}

	.single-process-container:hover .drag-handle {
		opacity: 1;
	}

	.drag-over {
		border-top: 2px solid var(--color-lightness-35, #555);
	}
</style>
