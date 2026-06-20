<!-- TODO: Import data/table logic might need re-work -->
<script>
	// @ts-nocheck
	import Icon from '$lib/icons/Icon.svelte';
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';
	import { appConsts, createOrphanProcess } from '$lib/core/core.svelte.js';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { mutationService } from '$lib/core/mutationService.js';
	import { on } from 'svelte/events';

	let {
		showDropdown = $bindable(false),
		columnSelected = null,
		columnsSelected = [],
		dropdownTop = 0,
		dropdownLeft = 0
	} = $props();

	// Get sorted processes by display name
	let sortedProcesses = $derived.by(() => {
		return Array.from(appConsts.processMap.entries()).sort((a, b) => {
			const nameA = a[1].displayName || a[0];
			const nameB = b[1].displayName || b[0];
			return nameA.localeCompare(nameB);
		});
	});

	// Dataflow model: adding an operation to a column no longer creates an inline
	// "process" inside the column. Instead it creates ONE free operation node that
	// fans out over the selected column(s), and a derived producer column per
	// input (e.g. "result_0 → Add"). The node appears on the canvas; the derived
	// column appears in the Data Sources panel. One mental model: every operation
	// is a node, every column is a node output.
	function addTheProcess(name) {
		const cols =
			columnsSelected && columnsSelected.length > 0
				? columnsSelected
				: columnSelected
					? [columnSelected]
					: [];
		if (cols.length) {
			const proc = createOrphanProcess(name, { inIN: cols.map((c) => c.id) });
			if (proc) {
				for (const col of cols) {
					mutationService.addColumn({
						type: col.type,
						producerNodeId: `process_${proc.id}`,
						producerPort: `out_${col.id}`,
						producerArtifactKind: 'column'
					});
				}
			}
		}
		showDropdown = false;
	}
</script>

<Dropdown bind:showDropdown top={dropdownTop} left={dropdownLeft}>
	{#snippet groups()}
		{#each sortedProcesses as [key, value]}
			<div
				class="dropdown-action"
				onclick={() => {
					showDropdown = false;
					addTheProcess(key);
				}}
			>
				<button>
					{value.displayName || key}
				</button>
			</div>
		{/each}
	{/snippet}
</Dropdown>

<style>
	/* preview table */
	:global(.preview-table-wrapper) {
		overflow-x: auto;
		margin-top: 1.5rem;
		margin-bottom: 1rem;
	}

	:global(.preview-table-wrapper table) {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--font-lg);
		background-color: var(--surface-card);
	}

	/* :global(.preview-table-wrapper thead) {
		position: sticky;
		top: 0;
		z-index: 1;
	} */

	:global(.preview-table-wrapper th) {
		padding: 8px 12px;
		border: 1px solid var(--color-lightness-85);
		background-color: var(--color-lightness-95);
		text-align: left;
	}

	:global(.preview-table-wrapper td) {
		padding: 8px 12px;
		border: 1px solid var(--color-lightness-85);
		text-align: left;
	}

	/* :global(.preview-table-wrapper tbody tr:hover) {
		background-color: var(--color-lightness-85); 
	}*/
</style>
