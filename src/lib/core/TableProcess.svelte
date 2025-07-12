<script module>
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

			this.name = dataIN.name;

			if (dataIN.args) {
				this.args = dataIN.args;
			}
		}
	}
</script>

<script>
	import BinnedData from '$lib/tableProcesses/BinnedData.svelte';

	let { p } = $props();
</script>

<div>table process {p.id} here!</div>
<BinnedData {p} />
