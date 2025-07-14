<script module>
	import { core } from '$lib/core/core.svelte.js';
	import { getTableByID } from '$lib/core/Table.svelte';
	import { Column } from '$lib/core/Column.svelte';
	let _tableprocessidCounter = 0;

	export class TableProcess {
		id; //Unique ID for the column
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
				console.warn('NEW TABLEPROCESS WITH ARGS: ', dataIN.args);
				this.args = dataIN.args;

				//THIS IS FOR A BinnedDaata PROCESS ---------
				const processHash = crypto.randomUUID();
				const outX = new Column({
					tableProcessed: processHash,
					name: 'binned X',
					type: 'number',
					data: []
				});
				this.args.xOUT = outX.id;
				const outY = new Column({
					tableProcessed: processHash,
					name: 'binned Y',
					type: 'number',
					data: []
				});
				this.args.yOUT = outY.id;
				console.log('adding columns to table', this.parent.name);
				console.log('xOUT: ', outX, 'yOUT: ', outY);
				console.log('table ID', this.parent.id);
				const theTable = getTableByID(this.parent.id);
				console.log(theTable);
				theTable.addColumn(outX);
				theTable.addColumn(outY);
				console.log('table: ');
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
	import BinnedData from '$lib/tableProcesses/BinnedData.svelte';

	let { p } = $props();
</script>

<div>table process {p.id} here!</div>
<BinnedData {p} />
