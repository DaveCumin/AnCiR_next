<script>
	// @ts-nocheck
	// The per-plot action menu (box header / worksheet row): Save, View data,
	// Download data, Delete. "Save" opens the Save dialog rather than a nested
	// PNG/SVG submenu, so every image export in the app goes through one place.
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';
	import SavePlot from '$lib/components/iconActions/SavePlot.svelte';
	import { removePlots } from '$lib/core/Plot.svelte';
	import { saveDataAsCSV, showDataAsTable } from '$lib/components/plotbits/helpers/save.svelte.js';

	let {
		showDropdown = $bindable(false),
		dropdownTop = 0,
		dropdownLeft = 0,
		plotId = $bindable(null)
	} = $props();

	let showSaveDialog = $state(false);

	function handleSaveAction(closeDropdown) {
		closeDropdown();
		showSaveDialog = true;
	}

	function handleDeleteAction(closeDropdown) {
		removePlots(plotId);
		closeDropdown();
	}

	function handleDownloadData(closeDropdown) {
		saveDataAsCSV(plotId);
		closeDropdown();
	}
</script>

<Dropdown bind:showDropdown top={dropdownTop} left={dropdownLeft}>
	{#snippet groups({ closeDropdown })}
		<div class="dropdown-item" onclick={() => handleSaveAction(closeDropdown)}>
			<button>Save…</button>
		</div>

		<div
			class="dropdown-item"
			onclick={() => {
				showDataAsTable(plotId);
				closeDropdown();
			}}
		>
			<button>View data</button>
		</div>

		<div class="dropdown-item" onclick={() => handleDownloadData(closeDropdown)}>
			<button>Download data</button>
		</div>

		<div class="dropdown-item" onclick={() => handleDeleteAction(closeDropdown)}>
			<button>Delete</button>
		</div>
	{/snippet}
</Dropdown>

<SavePlot bind:open={showSaveDialog} Id={plotId} />

<style>
	button {
		background-color: transparent;
		border: none;
		text-align: inherit;
		font: inherit;
		border-radius: 0;
		appearance: none;
		cursor: pointer;
		width: 100%;
		padding: 0;
	}

	.dropdown-item {
		padding: 0.6em;
		font-size: var(--font-lg);
		cursor: pointer;
	}

	.dropdown-item:hover {
		background-color: var(--color-lightness-95);
	}
</style>
