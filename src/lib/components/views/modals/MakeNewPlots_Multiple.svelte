<script>
	// @ts-nocheck
	import ProgressIndicator from '$lib/components/ProgressIndicator.svelte';

	import { core, pushObj, appConsts, appState, snapToGrid } from '$lib/core/core.svelte';
	import { Plot } from '$lib/core/Plot.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';

	import Icon from '$lib/icons/Icon.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import AttributeSelect from '$lib/components/reusables/AttributeSelect.svelte';
	import { get } from 'svelte/store';

	let { showModal = $bindable(false) } = $props();

	let plotType = $state('Plot');
	let plotName = $state(plotType + '_' + (core.plots.length + 1));

	let xCol = $state();
	let yCols = $state([null]); // contains column id

	function confirmImport() {
		const nCols = Math.ceil(Math.sqrt(yCols.length)); // for the layout
		//default width and height
		const padding = appState.gridSize;
		let width = 500;
		let height = 250;
		if (plotType === 'actogram') {
			height = 600;
		}

		const xName = getColumnById(xCol).name;

		for (let i = 0; i < yCols.length; i++) {
			//find the position
			const col = i % nCols;
			const row = Math.floor(i / nCols);

			const newPlot = new Plot({
				name: getColumnById(yCols[i]).name,
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

		appState.selectedPlotIds = [];
		for (let i = core.plots.length - 1; i > core.plots.length - yCols.length - 1; i--) {
			console.log(core.plots[i].id);
			appState.selectedPlotIds.push(core.plots[i].id);
		}
		console.log($state.snapshot(appState.selectedPlotIds));

		plotType = 'Plot';
		showModal = false;
	}

	function capitalise(str) {
		return str.charAt(0).toUpperCase() + str.slice(1);
	}

	//------------- STUFF TO DO WITH THE PROGRESS

	let steps = $state([
		{ label: 'Plot type', completed: false, isExpanded: true },
		{ label: 'Inputs', completed: false, isExpanded: false }
	]);
	let currentStep = $state(0);

	//This assumes that each step must be completed before the next
	function setCurrentStep() {
		//look backwards to find the last completed step and make the next one the current one
		for (let i = steps.length - 2; i >= 0; i--) {
			if (steps[i].completed) {
				steps[i + 1].isExpanded = true;
				currentStep = i + 1;
				return;
			}
		}
		currentStep = 0;
	}
	function enforceSequentialCompletion(changedIndex) {
		enforceCompletedRules(changedIndex);
		// If the changed step is marked incomplete, reset all subsequent steps
		if (!steps[changedIndex].completed) {
			for (let i = changedIndex + 1; i < steps.length; i++) {
				steps[i].completed = false;
				steps[i].isExpanded = false;
			}
		}
		setCurrentStep();
	}
	function enforceCompletedRules(changedIndex) {
		//rules for the first step - selection
		if (changedIndex === 0) {
			steps[changedIndex].completed = plotType != '';
			steps[1].label = `Options for ${plotType}`;
			enforceCompletedRules(1);
		}
	}
	//This checks for validity
	$effect(() => {
		if (plotType != 'Plot') {
			steps[0].completed = true;
			enforceSequentialCompletion(0);
		}
	});

	//-------------------
</script>

{#snippet stepContent(index, step)}
	{#if index === 0}
		<div class="choose-file-container">
			<AttributeSelect
				bind:bindTo={plotType}
				label="Plot Type"
				options={['actogram', 'periodogram', 'scatterplot']}
			/>
		</div>
	{/if}
	{#if index === 1}
		<AttributeSelect
			bind:bindTo={xCol}
			label={plotType == 'scatterplot' ? 'x' : 'time'}
			options={core.tables.flatMap((table) => table.columns.map((col) => col.id))}
			optionsDisplay={core.tables.flatMap((table) =>
				table.columns.map((col) => table.name + ': ' + col.name)
			)}
		/>

		<div class="import-container">
			<div class="preview-placeholder">
				<p>Alt-click to select multiple</p>
				<span>ys:</span>
				<select bind:value={yCols} multiple style="height: 100px">
					{#each core.tables as table}
						<optgroup label={table.name}>
							{#each table.columns as col}
								<option value={col.id}>{col.name}</option>
							{/each}
							<!-- include the tableProces data also -->
							{#each table.processes as p}
								{#each p.args.out as o}
									{@const key = Object.keys(o)}
									{#each key as k}
										{@const col = getColumnById(o[k])}
										<option value={col.id}>{col.name}</option>
									{/each}
								{/each}
							{/each}
						</optgroup>
					{/each}
				</select>
			</div>
		</div>
		{#if yCols[0]}
			<div class="dialog-button-container">
				<button class="dialog-button" onclick={confirmImport}>Confirm Import</button>
			</div>
		{/if}
	{/if}
{/snippet}

<Modal bind:showModal>
	{#snippet header()}
		<div class="heading">
			<h2>Create New {capitalise(plotType)}s</h2>
		</div>
	{/snippet}
	<ProgressIndicator bind:steps bind:currentStep {stepContent} />
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

	select optgroup {
		font-weight: bold;
		color: var(--color-lightness-35);
	}

	select option {
		padding-left: 20px; /* Indent sub-categories */
	}
</style>
