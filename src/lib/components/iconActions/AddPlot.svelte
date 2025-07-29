<script>
	// @ts-nocheck
	import { core, pushObj, appConsts } from '$lib/core/core.svelte';
	import { Plot } from '$lib/core/Plot.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';

	import Icon from '$lib/icons/Icon.svelte';
	import Dropdown from '../reusables/Dropdown.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import AttributeSelect from '../reusables/AttributeSelect.svelte';

	let { showDropdown = $bindable(false), dropdownTop = 0, dropdownLeft = 0 } = $props();
	
    let showModal = $state(false);
 
	let plotType = $state("Plot");
	let plotName = $state(plotType + '_' + (core.plots.length + 1));

	function openModal() {
		showModal = true;
	}

	let xCol = $state();
	let yCols = $state([null]); // contains column id

	let plotNames = $state([plotName]);

	function AddNewPlot() {
		yCols.push(null);
		plotNames.push('New_' + capitalise(plotType) + '_' + yCols.length);
	}

	function confirmImport() {
		for (let i = 0; i < yCols.length; i++) {
			const newPlot = new Plot ({ name: plotNames[i], type: plotType });
			newPlot.plot.addData({
				x: {refId: xCol},
				y: {refId: yCols[i]}
			});
			pushObj(newPlot);
		}
		showModal = false;
		showDropdown = false;
	}

	function capitalise(str) {
		return str.charAt(0).toUpperCase() + str.slice(1);
	}

</script>

<Dropdown bind:showDropdown top={dropdownTop} left={dropdownLeft}>
    {#snippet groups()}
        <div class="action">
			<button onclick={openModal}>
				Create New Plot
			</button>
		</div>
    {/snippet}
</Dropdown>

<Modal bind:showModal>
	{#snippet header()}
		<div class="heading">
			<h2>Create New {capitalise(plotType)}(s)</h2>

			<div class="choose-file-container">
				<AttributeSelect
					bind:bindTo={plotType}
					label="Plot Type"
					options={["actogram", "periodogram", "scatterplot"]}
				/>

				<AttributeSelect
					bind:bindTo={xCol}
					label="x"
					options={core.tables.flatMap(table => table.columns.map(col => col.id))}
					optionsDisplay={core.tables.flatMap(table => table.columns.map(col => table.name + ': ' + col.name))}
				/>
			</div>
		</div>
	{/snippet}

	{#snippet children()}
		<div class="import-container">
			<div class="preview-placeholder">
				{#each yCols as yCol, i}
					<div class="selected">
						<p class="selected-preview">
							Name: 
							<input bind:value={plotNames[i]} type="text" placeholder="enter plot name">
						</p>
					</div>

					<AttributeSelect
						bind:bindTo={yCols[i]}
						label="y"
						options={core.tables.flatMap(table => table.columns.map(col => col.id))}
						optionsDisplay={core.tables.flatMap(table => table.columns.map(col => table.name + ': ' + col.name))}
					/>
				{/each}
			</div>
			<button onclick={AddNewPlot}>Add New Plots</button>
		</div>
	{/snippet}

	{#snippet button()}
		<div class="dialog-button-container">
			<button class="dialog-button" onclick={confirmImport}>Confirm Import</button>
		</div>
	{/snippet}
</Modal>


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

	.choose-file-container {
		height: 2em;
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 1rem;
	}

	.choose-file-button {
		background-color: var(--color-lightness-95);
		padding: 8px 12px;
		border-radius: 4px;

		font-size: 14px;
		text-align: center;
	}

	.choose-file-button:hover {
		background-color: var(--color-hover);
	}

	.preview-placeholder {
		width: 100%;
		min-height: 100px;
	}

	.selected-preview {
		color: var(--color-lightness-35);
		font-size: 14px;
	}

</style>