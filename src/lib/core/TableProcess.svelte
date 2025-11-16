<script module>
	import { appState, appConsts, pushObj, core } from '$lib/core/core.svelte.js';
	import { getTableById } from '$lib/core/Table.svelte';
	import { Column } from '$lib/core/Column.svelte';
	let _tableprocessidCounter = 0;

	function removeColumnFromPlots(c_id) {
		core.plots.forEach((p, pi) => {
			//for the table
			if (p.type == 'tableplot') {
				p.plot.columnRefs = p.plot.columnRefs.filter((cr) => cr != c_id);
			} else {
				// for each plot
				p.plot.data.forEach((d, di) => {
					console.log('data:');
					console.log($state.snapshot(d));
					//for each data
					Object.keys($state.snapshot(d)).forEach((k) => {
						if (d[k]?.refId == c_id) {
							//if it's a match
							console.log('removing col ', k, ' from plot ', pi, '(', p.name, '), data ', di);
							core.plots[pi].plot.data[di][k] = new Column({ refId: -1 });
						}
					});
				});
			}
		});
	}

	export function deleteTableProcess(p) {
		appState.AYStext = `Are you sure you want to remove these data?`;
		appState.AYScallback = function handleAYS(option) {
			if (option === 'Yes') {
				//remove the columns
				Object.keys(p.args.out).forEach((o) => {
					const colID = p.args.out[o];
					//need to check if the columns are used in any plots first
					removeColumnFromPlots(colID);
					console.log('removing col ', colID);
					//Now we can remove them from the table refs
					core.tables[p.parent.id].columnRefs = core.tables[p.parent.id].columnRefs.filter(
						(cr) => cr != colID
					);
					//And remove the data completeley
					core.data = core.data.filter((c) => c.id != colID);
				});

				//remove the table process
				getTableById(p.parent.id).processes = getTableById(p.parent.id).processes.filter(
					(tp) => tp.id != p.id
				);
			}
		};
		appState.showAYSModal = true;
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
		<div class="control-component-title-icons">
			<button class="icon" onclick={() => deleteTableProcess(p)}>
				<Icon name="minus" width={16} height={16} className="control-component-title-icon" />
			</button>
		</div>
		<TheTableProcess bind:p />
	</div>
{/if}
