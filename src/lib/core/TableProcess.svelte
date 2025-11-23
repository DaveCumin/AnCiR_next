<script module>
	import { appState, appConsts, pushObj, core } from '$lib/core/core.svelte.js';
	import { getTableById } from '$lib/core/Table.svelte';
	import { removeColumnFromPlots } from '$lib/core/Plot.svelte';
	import { Column, removeColumn } from '$lib/core/Column.svelte';
	let _tableprocessidCounter = 0;

	function doDeleteTableProcess(p) {
		appState.AYStext = `Are you sure you want to delete process ${p.name}? This will also delete any output columns created by this process.`;
		appState.AYScallback = function handleAYS(option) {
			if (option === 'Yes') {
				deleteTableProcess(p);
			}
		};
		appState.showAYSModal = true;
	}

	export function deleteTableProcess(tableProcess) {
		if (!tableProcess || !tableProcess.parent) {
			return {
				success: false,
				message: 'Invalid table process provided'
			};
		}

		const removedColumns = [];
		const affectedProcesses = [];

		// Step 1: Collect all output columns to remove
		const outputColumnIds = Object.keys(tableProcess.args.out)
			.map((outKey) => tableProcess.args.out[outKey])
			.filter((id) => id >= 0);

		// Step 2: Remove each output column and its dependencies
		outputColumnIds.forEach((colID) => {
			removedColumns.push(colID);

			// Step 2a: Remove from plots/tables that display them
			removeColumnFromPlots(colID);

			// Step 2b: Remove from input references in other table processes
			core.tables.forEach((table, tableIdx) => {
				table.processes.forEach((process, processIdx) => {
					// Check all argument keys for references to this column
					Object.keys(process.args).forEach((argKey) => {
						// Only process input arguments (ending with 'IN')
						if (argKey.slice(-2) === 'IN') {
							if (typeof process.args[argKey] === 'object') {
								// Array input (e.g., xsIN) - filter out the column
								const before = process.args[argKey].length;
								process.args[argKey] = process.args[argKey].filter((id) => id !== colID);
								if (before !== process.args[argKey].length) {
									affectedProcesses.push({
										processId: process.id,
										processName: process.name,
										argument: argKey
									});
								}
							} else if (process.args[argKey] === colID) {
								// Single input (e.g., xIN, yIN) - set to -1
								process.args[argKey] = -1;
								affectedProcesses.push({
									processId: process.id,
									processName: process.name,
									argument: argKey
								});
							}
						}
					});
				});
			});

			// Step 2c: Remove from table's column references
			const tableIdx = core.tables.findIndex((t) => t.id === tableProcess.parent.id);
			if (tableIdx >= 0) {
				core.tables[tableIdx].columnRefs = core.tables[tableIdx].columnRefs.filter(
					(cr) => cr !== colID
				);
			}

			// Step 2d: Remove columns that reference this column (break dependency chain)
			const dependentColumns = core.data.filter((col) => col.refId === colID);
			dependentColumns.forEach((depCol) => {
				depCol.refId = -1; // Break the reference
			});

			// Step 2e: Remove from internal column reference system
			removeColumn(colID);

			// Step 2f: Remove from core data completely
			core.data = core.data.filter((c) => c.id !== colID);
		});

		// Step 3: Remove the table process itself from the parent table
		const parentTable = getTableById(tableProcess.parent.id);
		parentTable.processes = parentTable.processes.filter((tp) => tp.id !== tableProcess.id);

		return {
			success: true,
			processId: tableProcess.id,
			processName: tableProcess.name,
			removedOutputColumns: removedColumns.length,
			affectedInputReferences: affectedProcesses.length,
			affectedProcesses: affectedProcesses,
			message: `Table process "${tableProcess.name}" safely removed. ${removedColumns.length} output column(s) deleted. ${affectedProcesses.length} other process(es) had input references cleaned up.`
		};
	}

	export class TableProcess {
		id; //Unique Id
		name = '';
		args = $state({});

		constructor({ ...dataIN }, parent, id = null) {
			if (id === null) {
				this.id = id ?? _tableprocessidCounter;
				_tableprocessidCounter++;
			} else {
				this.id = id;
				_tableprocessidCounter = Math.max(id + 1, _tableprocessidCounter + 1);
			}

			this.parent = parent;

			this.name = dataIN.name;

			//If there is a column out ref set (i.e. reading from JSON)
			if (dataIN.args.out[Object.keys(dataIN.args.out)[0]] >= 0) {
				this.args = dataIN.args;
			}
			//If the out refs are not yet defined (i.e. creating new)
			else if (dataIN.args) {
				this.args = dataIN.args;
				//MAKE THE OUTPUTS (defined in the defaults with 'OUT') AND ASSOCIATE THEM
				const theTable = getTableById(this.parent.id);
				const processHash = crypto.randomUUID();

				for (let i = 0; i < Object.keys(this.args.out).length; i++) {
					//Create a new column with the given name and assign it a tableProcessGUId
					const tempCol = new Column({});
					tempCol.name = Object.keys(this.args.out)[i] + '_' + this.id;
					//now put that column ID in the out
					this.args.out[Object.keys(this.args.out)[i]] = tempCol.id;
					pushObj(tempCol); // add the column to core
					theTable.columnRefs = [tempCol.id, ...theTable.columnRefs]; //add to table
				}

				//--------------------------
				// - now run the process
				appConsts.tableProcessMap.get(this.name).func(this.args);
				//--------------------------
			}
		}

		toJSON() {
			return {
				id: this.id,
				name: this.name,
				args: this.args
			};
		}
	}
</script>

<script>
	import Icon from '$lib/icons/Icon.svelte';
	let { p = $bindable() } = $props();
</script>

{#if p}
	{@const TheTableProcess = appConsts.tableProcessMap.get(p.name)?.component}
	<div class="tableProcess-container">
		<div
			class="control-component-title-icons"
			style="
    margin-bottom: -1.75rem;
    z-index: 9999;
    margin-top: 0.25rem;
"
		>
			<button class="icon" onclick={() => doDeleteTableProcess(p)}>
				<Icon name="minus" width={16} height={16} className="menu-icon" />
			</button>
		</div>
		<TheTableProcess bind:p />
	</div>
{/if}
