<script>
	// @ts-nocheck
	import ProgressIndicator from '$lib/components/ProgressIndicator.svelte';

	import { core, pushObj, appConsts, appState, snapToGrid } from '$lib/core/core.svelte';
	import { Plot, deselectAllPlots } from '$lib/core/Plot.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';

	import Icon from '$lib/icons/Icon.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import { tick } from 'svelte';
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';

	let { showModal = $bindable(false) } = $props();

	let awaitingMake = $state(false);

	let plotType = $state('Plot');
	let plotName = $state(plotType + '_' + (core.plots.length + 1));

	let xCol = $state();
	let yCols = $state([]); // contains column id

	async function confirmMakePlots() {
		awaitingMake = true;
		await tick();
		await new Promise((resolve) => setTimeout(resolve, appConsts.timeoutRefresh_ms)); // short wait to make sure the spinner will show
		await tick();

		const nCols = Math.ceil(Math.sqrt(yCols.length)); // for the layout
		//default width and height
		const padding = appState.gridSize;
		let width = snapToGrid(495);
		let height = snapToGrid(240);
		if (plotType === 'actogram') {
			height = snapToGrid(600);
		}

		const xName = getColumnById(xCol)?.name;
		const container = document.getElementsByClassName('canvas')[0];

		for (let i = 0; i < yCols.length; i++) {
			//find the position
			const col = i % nCols;
			const row = Math.floor(i / nCols);

			console.log('making new plot with x,y: ', xCol, yCols[i]);

			const newPlot = new Plot({
				name: getColumnById(yCols[i]).name,
				type: plotType,
				x: snapToGrid(col * (width + padding) + (col + 1) * padding + container.scrollLeft),
				y: snapToGrid(
					row * (height + padding) + (row + 1) * padding + row * 2 * padding + container.scrollTop
				),
				width: snapToGrid(width),
				height: snapToGrid(height)
			});
			newPlot.plot.addData({
				x: { refId: Number(xCol) },
				y: { refId: yCols[i] }
			});
			core.plots.push(newPlot);

			await new Promise((resolve) => setTimeout(resolve, appConsts.timeoutRefresh_ms));
		}

		//select the new plots
		deselectAllPlots();
		for (let i = core.plots.length - 1; i > core.plots.length - yCols.length - 1; i--) {
			core.plots[i].selected = true;
		}

		//reset the form
		plotType = 'Plot';
		xCol = null;
		yCols = [];
		awaitingMake = false;
		steps[0].completed = false;
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

	//-------------------
</script>

{#snippet stepContent(index, step)}
	{#if index === 0}
		<div class="choose-file-container">
			<AttributeSelect
				bind:value={plotType}
				label="Plot Type"
				options={['actogram', 'periodogram', 'scatterplot']}
				onChange={() => {
					steps[0].completed = true;
					enforceSequentialCompletion(0);
				}}
			/>
		</div>
	{/if}
	{#if index === 1}
		<AttributeSelect
			bind:value={xCol}
			label={plotType == 'scatterplot' ? 'x' : 'time'}
			options={core.tables.flatMap((table) => table.columns.map((col) => col.id))}
			optionsDisplay={core.tables.flatMap((table) =>
				table.columns.map((col) => table.name + ': ' + col.name)
			)}
			onChange={() => {
				steps[0].completed = true;
				enforceSequentialCompletion(0);
			}}
		/>

		<div class="import-container">
			<div class="preview-placeholder">
				<p>Alt-click to select multiple</p>
				<span>ys:</span>
				<ColumnSelector bind:value={yCols} multiple={true} />
			</div>
		</div>

		{#if yCols[0] != null && Number(xCol) >= 0}
			<div class="dialog-button-container">
				<button
					class="dialog-button"
					onclick={(e) => {
						e.stopPropagation();
						confirmMakePlots();
					}}>Make these {yCols.length} plots</button
				>
			</div>
		{/if}
	{/if}
{/snippet}

<Modal bind:showModal>
	{#snippet header()}
		{#if awaitingMake}
			<div class="title-container">
				<Icon name="spinner" width={32} height={32} className="spinner" />
				<p>Making the {yCols.length} plots.</p>
			</div>
		{:else}
			<div class="heading">
				<h2>Create New {capitalise(plotType)}s</h2>
			</div>
		{/if}
	{/snippet}
	{#if !awaitingMake}
		<ProgressIndicator bind:steps bind:currentStep {stepContent} />
	{/if}
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
</style>
