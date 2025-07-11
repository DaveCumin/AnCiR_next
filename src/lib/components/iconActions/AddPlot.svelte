<script>
	// @ts-nocheck
	import { simulateData, ImportData } from '$lib/data/dataTree.svelte';
	import { core, pushObj, appConsts } from '$lib/core/core.svelte';
	import { Plot } from '$lib/core/Plot.svelte';

	import Icon from '$lib/icons/Icon.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';

	let { showDropdown = $bindable(false), dropdownTop = 0, dropdownLeft = 0 } = $props();

	let showModal = $state(false);
	let plotType = $state();
	let plotName = $derived.by(() => {
		return plotType + '_' + Math.round(Math.random() * 10, 2);
	});
	function openModal(type) {
		showModal = true;
		plotType = type;
	}

	let xCol = $state();
	let yCol = $state();
	function confirmImport() {
		const newPlot = new Plot({ name: plotName, type: plotType });
		newPlot.plot.addData({ x: xCol, y: yCol });
		console.log($state.snapshot(xCol));
		console.log($state.snapshot(newPlot.plot));
		pushObj(newPlot);

		showModal = false;
	}
</script>

<Dropdown bind:showDropdown top={dropdownTop} left={dropdownLeft}>
	{#snippet groups()}
		<div class="action">
			<button
				onclick={() => {
					openModal('actogram');
				}}
			>
				Create New Actogram
			</button>
		</div>

		<div class="action">
			<button
				onclick={() => {
					openModal('periodogram');
				}}
			>
				Create New Periodogram
			</button>
		</div>

		<div class="action">
			<button
				onclick={() => {
					openModal('scatterplot');
				}}
			>
				Create New ScatterPlot
			</button>
		</div>
	{/snippet}
</Dropdown>

<!-- TODO: change modal component to icon-like structure? -->

<Modal bind:showModal>
	{#snippet header()}
		<div class="heading">
			<h2>Create New {plotType}</h2>

			<div class="choose-file-container">
				<div>
					<label for="plotType">Choose a Plot Type:</label>

					<select bind:value={plotType} name="plotType" id="plot-type">
						<option value="actogram">Actogram</option>
						<option value="periodogram">Periodogram</option>
						<option value="scatterplot">ScatterPlot</option>
					</select>
				</div>

				<div class="selected">
					<p class="selected-preview">
						Name: {plotName}
						<!-- TODO: double click to change name -->
					</p>
				</div>
			</div>
		</div>
	{/snippet}

	{#snippet children()}
		<div class="import-container">
			<div class="preview-placeholder">
				<!-- TODO: make these draggable? -->
				<!-- TODO: interface control -->
				<div>
					<label for="xCol">x:</label>
					<select bind:value={xCol} name="xCol" id="plot-x">
						<option value="" disabled selected>Select x</option>
						{#each core.tables as table (table.id)}
							{#each table.columns as col (col.id)}
								<option value={col.id}>{table.name + ': ' + col.name}</option>
							{/each}
						{/each}
					</select>
				</div>
				<div>
					<label for="yCol">y:</label>
					<select bind:value={yCol} name="yCol" id="plot-y">
						<option value="" disabled selected>Select y</option>
						{#each core.tables as table (table.id)}
							{#each table.columns as col (col.id)}
								<option value={col.id}>{table.name + ': ' + col.name}</option>
							{/each}
						{/each}
					</select>
				</div>
			</div>

			<div class="import-button-container">
				<button class="import-button" onclick={confirmImport}>Confirm Import</button>
			</div>
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

	.import-button-container {
		display: flex;
		justify-content: flex-end;
		/* margin-right: 1rem; */
	}

	.import-button {
		margin-top: 10px;
		background-color: var(--color-lightness-95);
		border-radius: 4px;
		padding: 10px;
		padding-right: 12px;

		font-size: 14px;
		text-align: center;
	}

	.import-button:hover {
		background-color: var(--color-hover);
	}
</style>
