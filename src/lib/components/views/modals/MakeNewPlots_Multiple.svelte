<script>
	// @ts-nocheck
	import { core, pushObj, appConsts, appState, snapToGrid } from '$lib/core/core.svelte';
	import { Plot } from '$lib/core/Plot.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';

	import Icon from '$lib/icons/Icon.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import AttributeSelect from '$lib/components/reusables/AttributeSelect.svelte';

	let { showModal = $bindable(false) } = $props();

	let plotType = $state('Plot');
	let plotName = $state(plotType + '_' + (core.plots.length + 1));

	let xCol = $state();
	let yCols = $state([null]); // contains column id

	let plotNames = $state([plotName]);

	function AddNewPlot() {
		yCols.push(null);
		plotNames.push('New_' + capitalise(plotType) + '_' + yCols.length);
	}

	function confirmImport() {
		const nCols = Math.ceil(Math.sqrt(yCols.length)); // for the layout
		//default width and height
		const padding = appState.gridSize;
		let width = 500;
		let height = 250;
		if (plotType === 'actogram') {
			height = 600;
		}

		for (let i = 0; i < yCols.length; i++) {
			//find the position
			const col = i % nCols;
			const row = Math.floor(i / nCols);
			console.log(
				i,
				snapToGrid(col * (width + padding) + padding),
				snapToGrid(row * (height + padding) + padding)
			);

			const newPlot = new Plot({
				name: plotNames[i],
				type: plotType,
				x: snapToGrid(col * (width + padding) + (col + 1) * padding),
				y: snapToGrid(row * (height + padding) + (row + 1) * padding + row * 2 * padding),
				width: snapToGrid(width),
				height: snapToGrid(height)
			});
			newPlot.plot.addData({
				x: { refId: xCol },
				y: { refId: yCols[i] }
			});
			core.plots.push(newPlot);
		}
		showModal = false;
	}

	function capitalise(str) {
		return str.charAt(0).toUpperCase() + str.slice(1);
	}
</script>

<Modal bind:showModal>
	{#snippet header()}
		<div class="heading">
			<h2>Create New {capitalise(plotType)}(s)</h2>

			<div class="choose-file-container">
				<AttributeSelect
					bind:bindTo={plotType}
					label="Plot Type"
					options={['actogram', 'periodogram', 'scatterplot']}
				/>

				<AttributeSelect
					bind:bindTo={xCol}
					label="x"
					options={core.tables.flatMap((table) => table.columns.map((col) => col.id))}
					optionsDisplay={core.tables.flatMap((table) =>
						table.columns.map((col) => table.name + ': ' + col.name)
					)}
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
							<input bind:value={plotNames[i]} type="text" placeholder="enter plot name" />
						</p>
					</div>

					<AttributeSelect
						bind:bindTo={yCols[i]}
						label="y"
						options={core.tables.flatMap((table) => table.columns.map((col) => col.id))}
						optionsDisplay={core.tables.flatMap((table) =>
							table.columns.map((col) => table.name + ': ' + col.name)
						)}
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

	.preview-placeholder {
		width: 100%;
		min-height: 100px;
	}

	.selected-preview {
		color: var(--color-lightness-35);
		font-size: 14px;
	}
</style>
