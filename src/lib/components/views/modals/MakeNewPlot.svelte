<script>
	// @ts-nocheck
	import ProgressIndicator from '$lib/components/ProgressIndicator.svelte';
	import { core, pushObj, appConsts } from '$lib/core/core.svelte';
	import { Plot } from '$lib/core/Plot.svelte';

	import Icon from '$lib/icons/Icon.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';

	let { showModal = $bindable(false) } = $props();

	//------------- STUFF TO DO WITH THE PROGRESS

	let steps = $state([
		{ label: 'Plot type', completed: false, isExpanded: true },
		{ label: 'Name and inputs', completed: false, isExpanded: false }
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
	//This checks for validity based on the TableProcess (they must have a 'valid' entry for the logic; just like they must have an 'out' for the output logic to work)
	$effect(() => {
		if (Object.values(inputs).length > 0 && Object.values(inputs).every((value) => value >= 0)) {
			steps[1].completed = true;
		} else {
			steps[1].completed = false;
		}
	});

	//-------------------

	let plotType = $state();
	let plotName = $derived.by(() => {
		return plotType + '_' + Math.round(Math.random() * 10, 2);
	});
	function openModal(type) {
		showModal = true;
		plotType = type;
	}

	let inputs = $state({});

	function makeInputs() {
		enforceSequentialCompletion(0);
		let out = {};
		appConsts.plotMap.get(plotType)?.defaultInputs?.forEach((input) => {
			out[input] = -1; // default to -1, meaning no column selected
		});
		inputs = out;
	}

	function makePlot() {
		const newPlot = new Plot({ name: plotName, type: plotType });
		let data = {};
		Object.entries(inputs).forEach(([key, value]) => {
			data[key] = { refId: value };
		});
		newPlot.plot.addData(data);
		pushObj(newPlot);
		// reset the inputs
		inputs = {};
		plotType = '';
		plotName = '';
		// close the modal
		showModal = false;
	}
</script>

<!-- TODO: change select in the modal component to icon-like structure? -->

{#snippet header()}
	<div class="heading">
		<h2>Create New {plotType}</h2>
	</div>
{/snippet}

{#snippet stepContent(index, step)}
	{#if index === 0}
		<div class="choose-file-container">
			<div>
				<label for="plotType">Choose a Plot Type:</label>

				<select bind:value={plotType} name="plotType" id="plot-type" onchange={makeInputs}>
					<option value=""></option>
					{#each Object.keys(Object.fromEntries(appConsts.plotMap.entries())) as type}
						{#if appConsts.plotMap.get(type)?.defaultInputs?.length > 0}
							<!-- only include the plots that have column inputs-->
							<option value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>
						{/if}
					{/each}
				</select>
			</div>
		</div>
	{/if}
	{#if index === 1}
		{#if plotType != ''}
			<div class="selected">
				<p class="selected-preview">
					Name: <input bind:value={plotName} />
				</p>
			</div>
			<div class="import-container">
				<div class="preview-placeholder">
					<!-- TODO: make these draggable? -->
					<!-- TODO: interface control -->
					{#if appConsts.plotMap.get(plotType)?.defaultInputs?.length > 0}
						Defaults:
						{#each Object.keys(inputs) as d}
							<div>{d}: <ColumnSelector bind:value={inputs[d]} /></div>
						{/each}
					{/if}
				</div>
			</div>
		{/if}
	{/if}
{/snippet}

{#snippet footerContent()}
	{#if steps[1].completed}
		<div class="import-button-container">
			<button class="import-button" onclick={makePlot}>Make the {plotType}</button>
		</div>
	{/if}
{/snippet}

<Modal bind:showModal>
	<ProgressIndicator bind:steps bind:currentStep {stepContent} {footerContent} />
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
