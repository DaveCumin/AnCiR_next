<script>
	import ProgressIndicator from '$lib/components/ProgressIndicator.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import { getTableById } from '$lib/core/Table.svelte';
	import { TableProcess } from '$lib/core/TableProcess.svelte';
	import { appConsts } from '$lib/core/core.svelte.js';
	import { tick } from 'svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';

	let { show = $bindable(), tableId } = $props();

	///-----------
	let tableProcessChosen = $state();
	let awaitingLoad = $state(false);

	// Get sorted table processes by display name
	let sortedTableProcesses = $derived.by(() => {
		return Array.from(appConsts.tableProcessMap.entries()).sort((a, b) => {
			const nameA = a[1].displayName || a[0];
			const nameB = b[1].displayName || b[0];
			return nameA.localeCompare(nameB);
		});
	});

	// Get display name for chosen process
	let tableProcessDisplayName = $derived.by(() => {
		return tableProcessChosen
			? appConsts.tableProcessMap.get(tableProcessChosen)?.displayName || tableProcessChosen
			: '';
	});

	async function confirmAddColumn() {
		awaitingLoad = true;

		await tick();
		await new Promise((resolve) => setTimeout(resolve, appConsts.timeoutRefresh_ms)); // short wait to make sure the spinner will show
		await tick();

		// Create process in a non-reactive context
		const newProcess = new TableProcess(
			{
				name: tableProcessChosen,
				args: theDefaults
			},
			getTableById(tableId)
		);

		//add table processes in reverse order so the most recent shows at the top
		const theTable = getTableById(tableId);
		theTable.processes = [newProcess, ...theTable.processes];

		//clear the defaults
		tableProcessChosen = '';
		theDefaults = null;
		awaitingLoad = false;
		await tick();

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
			steps[1].label = `Options for ${tableProcessDisplayName}`;
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

	//Clear defaults when not show
	$effect(async () => {
		if (!show) {
			tableProcessChosen = '';
			theDefaults = null;
			awaitingLoad = false;
			await tick();
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
				{#each sortedTableProcesses as [key, value]}
					<option value={key}>{value.displayName || key}</option>
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
		<div class="dialog-button-container">
			<button id="makeNewColumn" class="dialog-button" onclick={confirmAddColumn}
				>Add these data</button
			>
		</div>
	{/if}
{/snippet}

<Modal bind:showModal={show}>
	{#if awaitingLoad}
		<LoadingSpinner message="Making the column" />
	{:else}
		<ProgressIndicator bind:steps bind:currentStep {stepContent} {footerContent} />
	{/if}
</Modal>
