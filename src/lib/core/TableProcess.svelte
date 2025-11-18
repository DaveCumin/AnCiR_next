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

	export function deleteTableProcess(p) {
		//remove the table process
		getTableById(p.parent.id).processes = getTableById(p.parent.id).processes.filter(
			(tp) => tp.id != p.id
		);

		//remove the columns
		Object.keys(p.args.out).forEach((o) => {
			const colID = p.args.out[o];
			//need to check if the columns are used in any plots first
			removeColumnFromPlots(colID);

			//remove from any table processes
			core.tables.forEach((t, ti) => {
				t.processes.forEach((p, pi) => {
					Object.keys(p.args).forEach((k) => {
						if (k.slice(-2) == 'IN') {
							// if it's an input
							if (typeof p.args[k] == 'object') {
								//if it's an array input
								core.tables[ti].processes[pi].args[k] = core.tables[ti].processes[pi].args[
									k
								].filter((r) => r != colID);
							} else {
								//if it's a number input
								core.tables[ti].processes[pi].args[k] = -1;
							}
						}
					});
				});
			});

			//Remove them from the table refs
			const tableIdx = core.tables.findIndex((t) => t.id === p.parent.id);
			core.tables[tableIdx].columnRefs = core.tables[tableIdx].columnRefs.filter(
				(cr) => cr != colID
			);

			//remove ref from other columns
			removeColumn(colID);

			//And remove the data completeley
			core.data = core.data.filter((c) => c.id != colID);
		});
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
		<!-- <div
			class="control-component-title-icons"
			style="
    margin-bottom: -1.75rem;
    z-index: 9999;
    margin-top: 0.25rem;
"
		>
			<button class="icon" onclick={() => doDeleteTableProcess(p)}>
				<Icon name="minus" width={16} height={16} className="control-component-title-icon" />
			</button>
		</div> -->
		<TheTableProcess bind:p />
	</div>
{/if}
