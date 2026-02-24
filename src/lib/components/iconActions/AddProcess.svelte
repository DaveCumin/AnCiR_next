<!-- TODO: Import data/table logic might need re-work -->
<script>
	// @ts-nocheck
	import Icon from '$lib/icons/Icon.svelte';
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';
	import { appConsts } from '$lib/core/core.svelte.js';
	import { getColumnById, addProcessToColumns } from '$lib/core/Column.svelte';
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

	function addTheProcess(name) {
		if (columnsSelected && columnsSelected.length > 0) {
			addProcessToColumns(columnsSelected, name);
		} else if (columnSelected) {
			columnSelected.addProcess(name);
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
		font-size: 14px;
		background-color: white;
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
