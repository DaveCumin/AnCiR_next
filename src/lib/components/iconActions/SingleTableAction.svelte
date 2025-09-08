<script>
	// @ts-nocheck
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';

	import { core } from '$lib/core/core.svelte';
	import { Plot } from '$lib/core/Plot.svelte';
	import { getTableById, exportTable } from '$lib/core/Table.svelte';

	let {
		showDropdown = $bindable(false),
		dropdownTop = 0,
		dropdownLeft = 0,
		tableId = $bindable(null),
		addNewColumn
	} = $props();
	let showModal = $state(false);

	function makeNewTablePlot(id) {
		core.plots.push(new Plot({ name: 'Data from ' + getTableById(id).name, type: 'tableplot' }));
		core.plots[core.plots.length - 1].x = 250;
		core.plots[core.plots.length - 1].y = 250;
		core.plots[core.plots.length - 1].plot.columnRefs = getTableById(id).columnRefs;
		core.plots[core.plots.length - 1].plot.showCol = new Array(
			getTableById(id).columnRefs.length
		).fill(true);
	}
</script>

<Dropdown bind:showDropdown top={dropdownTop} left={dropdownLeft}>
	{#snippet groups()}
		<div class="dropdown-action" onclick={() => addNewColumn(tableId)}>
			<button> Add New Column </button>
		</div>

		<div class="dropdown-action" onclick={() => makeNewTablePlot(tableId)}>
			<button> View as Table </button>
		</div>

		<div class="dropdown-action" onclick={() => exportTable(tableId)}>
			<button> Export as csv </button>
		</div>
	{/snippet}
</Dropdown>
