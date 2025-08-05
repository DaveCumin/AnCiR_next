<script>
	import ProgressIndicator from '$lib/components/ProgressIndicator.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import { getTableById } from '$lib/core/Table.svelte';
	import { TableProcess } from '$lib/core/TableProcess.svelte';
	import { appConsts } from '$lib/core/core.svelte.js';
	import { tick } from 'svelte';
	import Icon from '$lib/icons/Icon.svelte';

	let { show = $bindable(), tableId } = $props();

	///-----------
	let tableProcessChosen = $state();
	let awaitingLoad = $state(false);

	async function confirmAddColumn() {
		awaitingLoad = true;
		await tick();
		await new Promise((resolve) => setTimeout(resolve, 50)); // short wait to make sure the spinner will show
		await tick();

		// Create process in a non-reactive context
		console.time('Create Process');
		const newProcess = new TableProcess(
			{
				name: tableProcessChosen,
				args: theDefaults
			},
			getTableById(tableId)
		);
		console.timeEnd('Create Process');

		// Batch update: Add process to reactive state
		console.time('Push Process');
		getTableById(tableId).processes.push(newProcess);
		console.timeEnd('Push Process');

		//clear the defaults
		tableProcessChosen = '';
		theDefaults = null;
		awaitingLoad = false;

		//hide modal
		show = false;
	}

	//------------- STUFF TO DO WITH THE PROGRESS

	let steps = $state([
		{ label: 'Column name and type', completed: false, isExpanded: true },
		{ label: 'Options', completed: false, isExpanded: false }
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
			steps[changedIndex].completed = tableProcessChosen != '';
			steps[1].label = `Options for ${tableProcessChosen}`;
			enforceCompletedRules(1);
		}
	}
	// //This checks for validity based on the TableProcess (they must have a 'valid' entry for the logic; just like they must have an 'out' for the output logic to work)
	$effect(() => {
		if (theDefaults?.valid) {
			steps[1].completed = true;
		} else {
			steps[1].completed = false;
		}
	});

	//------
	let defaultsReady = $state(false);
	function processNested(obj) {
		const result = {};
		for (const [key, value] of Object.entries(obj)) {
			result[key] = value.val !== undefined ? value.val : processNested(value);
		}
		return result;
	}

	let theDefaults = $state(null);
	function setupProcess() {
		theDefaults = Object.fromEntries(
			Array.from(appConsts.tableProcessMap.get(tableProcessChosen).defaults.entries()).map(
				([key, value]) => {
					if (key === 'out') {
						return ['out', processNested(value)];
					}
					return [key, value.val];
				}
			)
		);
		defaultsReady = true;
		enforceSequentialCompletion(0);
	}
</script>

{#snippet stepContent(index, step)}
	{#if index === 0}
		<div>
			Process to use:
			<select
				onchange={(e) => {
					theDefaults = null;
					defaultsReady = false;
					tableProcessChosen = e.target.value; // had to do it this way, else the component would mount before theDefaults were set
					setupProcess();
				}}
			>
				<option value=""></option>
				{#each Array.from(appConsts.tableProcessMap.keys()) as tp}
					<option value={tp}>{tp}</option>
				{/each}
			</select>
		</div>
	{:else if index === 1}
		<!-- ensure component mounts after theDefaults change -->
		{#if tableProcessChosen && tableProcessChosen !== '' && defaultsReady && theDefaults !== null && theDefaults !== undefined}
			{@const TableProcess = appConsts.tableProcessMap.get(tableProcessChosen)?.component}
			<TableProcess
				p={{
					name: tableProcessChosen,
					args: theDefaults
				}}
			/>
		{/if}
	{/if}
{/snippet}

{#snippet footerContent()}
	{#if steps[1].completed}
		<div><button onclick={confirmAddColumn}>Add these data</button></div>
	{/if}
{/snippet}

<Modal bind:showModal={show}>
	{#if awaitingLoad}
		<div class="title-container">
			<Icon name="spinner" width={32} height={32} className="spinner" />
			<p>Making the column</p>
		</div>
	{:else}
		<ProgressIndicator bind:steps bind:currentStep {stepContent} {footerContent} />
	{/if}
</Modal>

<style>
	.title-container {
		display: flex;
		justify-content: left; /* Left horizontally */
		align-items: center; /* Center vertically */
		gap: 10px; /* Space between logo and text */
	}
</style>
