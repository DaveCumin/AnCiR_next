<script>
	import ProgressIndicator from '$lib/components/ProgressIndicator.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import { getTableById } from '$lib/core/Table.svelte';
	import { TableProcess } from '$lib/core/TableProcess.svelte';
	import { appConsts } from '$lib/core/core.svelte.js';
	let { show = $bindable(), tableId } = $props();

	///-----------
	let tableProcessChosen = $state();

	function confirmAddColumn() {
		//add the process
		getTableById(tableId).processes.push(
			new TableProcess(
				{
					name: tableProcessChosen,
					args: theDefaults
				},
				getTableById(tableId)
			)
		);

		//clear the defaults
		theDefaults = {};

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
	function processNested(obj) {
		const result = {};
		for (const [key, value] of Object.entries(obj)) {
			result[key] = value.val !== undefined ? value.val : processNested(value);
		}
		return result;
	}

	let theDefaults = $state(null);
	function setupProcess() {
		console.log('chosen: ', tableProcessChosen);
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

		console.log($state.snapshot(theDefaults));
		enforceSequentialCompletion(0);
	}
</script>

{#snippet stepContent(index, step)}
	{#if index === 0}
		<div>
			Process to use:
			<select bind:value={tableProcessChosen} onchange={setupProcess}>
				<option value=""></option>
				{#each Array.from(appConsts.tableProcessMap.keys()) as tp}
					<option value={tp}>{tp}</option>
				{/each}
			</select>
		</div>
	{:else if index === 1}
		{#key theDefaults}
			<!-- ensure component mounts after theDefaults change -->
			{#if tableProcessChosen != '' && theDefaults}
				{@const TableProcess = appConsts.tableProcessMap.get(tableProcessChosen)?.component}
				<TableProcess
					p={{
						name: tableProcessChosen,
						args: theDefaults
					}}
				/>
			{/if}
		{/key}
	{/if}
{/snippet}

{#snippet footerContent()}
	{#if steps[1].completed}
		<div><button onclick={confirmAddColumn}>Add these data</button></div>
	{/if}
{/snippet}

<Modal bind:showModal={show}>
	<ProgressIndicator bind:steps bind:currentStep {stepContent} {footerContent} />
</Modal>
