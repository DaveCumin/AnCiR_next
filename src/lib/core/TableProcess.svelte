<script module>
	import { appConsts } from '$lib/core/core.svelte.js';
	import { getTableById } from '$lib/core/Table.svelte';
	import { Column, getColumnById } from '$lib/core/Column.svelte';
	let _tableprocessidCounter = 0;

	export class TableProcess {
		id; //Unique Id for the column
		name = '';
		args = $state({});

		constructor({ ...dataIN }, parent, id = null) {
			console.time('TableProcess Constructor');

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
					console.time(`Column ${Object.keys(this.args.out)[i]} `);

					const tempCol = new Column({
						tableProcessed: processHash,
						name: Object.keys(this.args.out)[i],
						type: 'number',
						data: dataIN.args.data ?? [] //This is to make sure the preview is exactly what the data are (eg for random)
					});
					this.args.out[Object.keys(this.args.out)[i]] = tempCol.id;
					theTable?.addColumn(tempCol);

					console.timeEnd(`Column ${Object.keys(this.args.out)[i]} `);
				}
				if (Object.keys(this.args).includes('N')) {
					this.args.N = getColumnById(theTable?.columnRefs[0]).getData().length;
				}
				//--------------------------
			}
			console.timeEnd('TableProcess Constructor');
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
	let { p = $bindable() } = $props();
</script>

{#if p}
	{@const TheTableProcess = appConsts.tableProcessMap.get(p.name)?.component}
	<TheTableProcess bind:p />
{/if}
