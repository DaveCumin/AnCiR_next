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
			<div class="action">
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
	.action button {
		margin: 0.6em;
		font-size: 14px;
	}

	.action:hover {
		background-color: var(--color-lightness-95);
	}

	button {
		background-color: transparent;
		border: none;
		text-align: inherit;
		font: inherit;
		border-radius: 0;
		appearance: none;

		cursor: pointer;
	}

	.heading {
		display: flex;
		flex-direction: column;
	}
</style>
