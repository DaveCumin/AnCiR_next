<script>
	import ProgressIndicator from '$lib/components/ProgressIndicator.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import { Column, getColumnById } from '$lib/core/Column.svelte';
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import { core } from '$lib/core/core.svelte.js';
	let { show = $bindable(), tableId } = $props();

	///-----------
	//variables for new column
	let howMakeNewColumn = $state('');
	let newColumnName = $state('new col');
	let newColumnLength = $derived(
		getColumnById(core.tables.find((t) => t.id === tableId).columnRefs[0]).getData().length
	);
	let newColumnData = $state([]);
	//variables for random new col
	let randomColMultiplier = $state(10);
	let randomColOffset = $state(100);
	//vars for existing new col
	let newColsValueReset = $state(-1);
	let newColsExisting = $state([]);

	function calcnewColumnData() {
		if (howMakeNewColumn == 'random') {
			newColumnData = Array.from(
				{ length: newColumnLength },
				() => Math.round(Math.random() * randomColMultiplier, 2) + randomColOffset
			);
		} else if (howMakeNewColumn == 'existing' && newColsExisting.length > 0) {
			//TODO: need to deal with types and operators in between (eg * for numnbers, space for strings, and rawData for time [but only if no processes])
			newColumnData = getColumnById(newColsExisting[0]).getData();
			for (let nc = 1; nc < newColsExisting.length; nc++) {
				const temp = getColumnById(newColsExisting[nc]).getData();

				newColumnData = newColumnData.map((d, i) => d + temp[i]);
			}
		} else {
			newColumnData = [];
		}
	}

	function confirmAddColumn() {
		const newDataEntry = new Column({
			type: 'number',
			data: $state.snapshot(newColumnData),
			name: newColumnName,
			provenance: 'created from columns'
		});
		core.data.push(newDataEntry);
		core.tables.find((t) => t.id === tableId).columnRefs.push(newDataEntry.id);
		//reset values
		newColumnName = 'new col';
		howMakeNewColumn = '';
		newColumnLength = 0;
		newColumnData = [];
		newColsExisting = [];
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
			steps[changedIndex].completed = newColumnName != '' && howMakeNewColumn != '';
			steps[1].label = `Options for ${howMakeNewColumn}`;
			calcnewColumnData();
			enforceCompletedRules(1);
		}
		//rules for the options
		if (changedIndex === 1) {
			if (howMakeNewColumn == 'random') {
				steps[changedIndex].completed = randomColMultiplier != null && randomColOffset != null;
			}
			if (howMakeNewColumn == 'existing') {
				steps[changedIndex].completed = newColsExisting.length > 0;
			}
		}
	}

	//------
</script>

{#snippet stepContent(index, step)}
	{#if index === 0}
		<p>Give the column a name and select the type</p>

		<div>
			Name: <input
				type="text"
				bind:value={newColumnName}
				oninput={() => enforceSequentialCompletion(index)}
			/>
		</div>
		<div>
			Type: <select
				bind:value={howMakeNewColumn}
				onchange={() => {
					calcnewColumnData();
					enforceSequentialCompletion(index);
				}}
			>
				<option value="random">Random</option>
				<option value="simulated">Simulated</option>
				<option value="existing">From existing columns</option>
			</select>
		</div>
	{:else if index === 1}
		{#if howMakeNewColumn == 'random'}
			<div>
				Multiplier: <input
					type="number"
					bind:value={randomColMultiplier}
					oninput={() => {
						calcnewColumnData();
						enforceSequentialCompletion(index);
					}}
				/>
				Offset:
				<input
					type="number"
					bind:value={randomColOffset}
					oninput={() => {
						calcnewColumnData();
						enforceSequentialCompletion(index);
					}}
				/>
			</div>
		{/if}
		{#if howMakeNewColumn == 'existing'}
			{#each newColsExisting as col, i}
				<ColumnSelector
					bind:value={newColsExisting[i]}
					onChange={() => {
						calcnewColumnData();
						enforceSequentialCompletion(index);
					}}
				/>
			{/each}
			Add new: <ColumnSelector
				bind:value={newColsValueReset}
				onChange={(value) => {
					newColsExisting.push(Number(value));
					newColsValueReset = -1;
					calcnewColumnData();
					enforceSequentialCompletion(index);
				}}
			/>
		{/if}
	{/if}
{/snippet}

{#snippet footerContent()}
	{#if steps[1].completed}
		<div>
			Preview:
			{newColumnData.slice(0, 5)}
		</div>
		<div><button onclick={confirmAddColumn}>Add these data</button></div>
	{/if}
{/snippet}

<Modal bind:showModal={show}>
	<ProgressIndicator bind:steps bind:currentStep {stepContent} {footerContent} />
</Modal>
