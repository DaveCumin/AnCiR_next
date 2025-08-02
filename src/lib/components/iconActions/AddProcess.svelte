<!-- TODO: Import data/table logic might need re-work -->
<script>
	// @ts-nocheck
	import Icon from '$lib/icons/Icon.svelte';
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';
	import { appConsts } from '$lib/core/core.svelte.js';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { on } from 'svelte/events';

	let {
		showDropdown = $bindable(false),
		columnSelected = -1,
		dropdownTop = 0,
		dropdownLeft = 0
	} = $props();

	function addTheProcess(name) {
		if (columnSelected == -1) return;
		getColumnById(columnSelected).addProcess(name);
		showDropdown = false;
	}
</script>

<Dropdown bind:showDropdown top={dropdownTop} left={dropdownLeft}>
	{#snippet groups()}
		{#each appConsts.processMap.entries() as [key, value]}
		<div class="dropdown-action">
			<button
				onclick={() => {
					showDropdown = false;
					addTheProcess(key);
				}}
			>
				{key}
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