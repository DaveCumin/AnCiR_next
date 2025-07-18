<script module>
	import { appConsts } from '$lib/core/core.svelte.js';
	import { getTableById } from '$lib/core/Table.svelte';
	import { Column } from '$lib/core/Column.svelte';
	let _tableprocessidCounter = 0;

	export class TableProcess {
		id; //Unique Id for the column
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

			if (dataIN.args) {
				this.args = dataIN.args;
				//MAKE THE OUTPUTS (defined in the defaults with 'OUT') AND ASSOCIATE THEM
				const theTable = getTableById(this.parent.id);
				const processHash = crypto.randomUUID();

				for (let i = 0; i < Object.keys(this.args.out).length; i++) {
					const tempCol = new Column({
						tableProcessed: processHash,
						name: Object.keys(this.args.out)[i],
						type: 'number',
						data: []
					});
					this.args.out[Object.keys(this.args.out)[i]] = tempCol.id;
					theTable.addColumn(tempCol);
				}
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
	let { p } = $props();
	console.log('p; ', p);
</script>

{#if p}
	{@const TheTableProcess = appConsts.tableProcessMap.get(p.name)?.component}
	<TheTableProcess {p} />
{/if}
