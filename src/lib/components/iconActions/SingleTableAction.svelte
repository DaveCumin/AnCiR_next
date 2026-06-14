<script>
	// @ts-nocheck
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';

	import { mutationService } from '$lib/core/mutationService.js';
	import { getTableById, exportTable, deleteTable } from '$lib/core/Table.svelte';

	let {
		showDropdown = $bindable(false),
		dropdownTop = 0,
		dropdownLeft = 0,
		tableId = $bindable(null),
		addNewColumn
	} = $props();
	let showModal = $state(false);

	function makeNewTablePlot(id) {
		const table = getTableById(id);
		mutationService.addPlot({
			name: 'Data from ' + table.name,
			type: 'tableplot',
			x: 250,
			y: 250,
			plot: {
				columnRefs: table.columnRefs,
				showCol: new Array(table.columnRefs.length).fill(true)
			}
		});
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

		<!-- <div class="dropdown-action" onclick={() => deleteTable(tableId)}>
			<button> Delete table </button>
		</div> -->
	{/snippet}
</Dropdown>
