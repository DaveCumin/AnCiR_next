<script>
	// TODO: multiple select on control plots,
	// bulk change (e.g. width)

	// @ts-nocheck
	import { core, appConsts } from '$lib/core/core.svelte.js';
	import Icon from '$lib/icons/Icon.svelte';
	import AddTable from '$lib/components/iconActions/AddTable.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import { Column, getColumnByID } from '$lib/core/Column.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import ColumnSelector from '../inputs/ColumnSelector.svelte';
	import TableProcess from '$lib/core/TableProcess.svelte';

	import ProgressIndicator from '$lib/components/ProgressIndicator.svelte';
	let steps = $state([
		{ label: 'lab 1', completed: false, active: true, isExpanded: true },
		{ label: 'lab 2', completed: false, active: false, isExpanded: false },
		{ label: 'lab 3', completed: false, active: false, isExpanded: false },
		{ label: 'lab 4', completed: false, active: false, isExpanded: false }
	]);
	let currentStep = $state(0);

	//variables for new column
	let howMakeNewColumn = $state('');
	let showAddColumnModal = $state(false);
	let selectedTable = $state();
	let newColumnName = $state('new col');
	let newColumnLength = $state(0);
	let newColumnData = $state([]);
	//variables for random new col
	let randomColMultiplier = $state(10);
	let randomColOffset = $state(100);
	//vars for existing new col
	let newColsValueReset = $state(-1);
	let newColsExisting = $state([]);

	let { canChange = false } = $props();

	// AddTable dropdown
	let addBtnRef;
	let showAddTable = $state(false);
	let dropdownTop = $state(0);
	let dropdownLeft = $state(0);

	function recalculateDropdownPosition() {
		if (!addBtnRef) return;
		const rect = addBtnRef.getBoundingClientRect();

		dropdownTop = rect.top + window.scrollY;
		dropdownLeft = rect.right + window.scrollX + 12;
	}

	function openDropdown(e) {
		e.stopPropagation();
		recalculateDropdownPosition();
		requestAnimationFrame(() => {
			showAddTable = true;
		});
		window.addEventListener('resize', recalculateDropdownPosition);
	}

	//functions to deal with adding a new column
	function addColumn(tableid) {
		console.log('Add a column');
		selectedTable = core.tables.find((t) => t.id === tableid);
		newColumnLength = getColumnByID(selectedTable.columnRefs[0]).getData().length;
		showAddColumnModal = true;
	}

	function calcnewColumnData() {
		console.log('effect | newColType: ', howMakeNewColumn);
		if (howMakeNewColumn == 'random') {
			newColumnData = Array.from(
				{ length: newColumnLength },
				() => Math.round(Math.random() * randomColMultiplier, 2) + randomColOffset
			);
		} else if (howMakeNewColumn == 'existing' && newColsExisting.length > 0) {
			//TODO: need to deal with types and operators in between (eg * for numnbers, space for strings, and rawData for time [but only if no processes])
			newColumnData = getColumnByID(newColsExisting[0]).getData();
			for (let nc = 1; nc < newColsExisting.length; nc++) {
				const temp = getColumnByID(newColsExisting[nc]).getData();

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
		selectedTable.columnRefs.push(newDataEntry.id);
		//reset values
		selectedTable = '';
		newColumnName = 'new col';
		howMakeNewColumn = '';
		newColumnLength = 0;
		newColumnData = [];
		newColsExisting = [];
		//hide modal
		showAddColumnModal = false;
	}
</script>

<div class="heading">
	<p>Data Sources</p>

	<div class="add">
		<button bind:this={addBtnRef} onclick={openDropdown}>
			<Icon name="add" width={16} height={16} />
		</button>
	</div>
</div>

<!-- TODO: write custom component to achieve -->
<div class="display-list">
	{#each core.tables as table (table.id)}
		<div class="table-container">
			<details class="table-item">
				<summary class="table-name">{table.name}</summary>
				<button onclick={() => addColumn(table.id)}>Add column</button>
				{#each table.columns as col}
					{#if !col.tableProcessed}
						<ColumnComponent {col} />
					{/if}
				{/each}
				{#each table.processes as p}
					<TableProcess {p} />
				{/each}
			</details>
		</div>
	{/each}
</div>

{#snippet stepContent(index, step)}
	{#if index === 0}
		<p>Content for Lab 1</p>
		<input type="text" placeholder="Enter data for Lab 1" />
	{:else if index === 1}
		<p>Content for Lab 2</p>
		<textarea
			placeholder="Enter details for Lab 2"
			oninput={(e) => {
				if (e.target.value != '') {
					steps[1].completed = true;
				} else {
					steps[1].completed = false;
				}
			}}
		></textarea>
	{:else if index === 2}
		<p>Content for Label 3</p>
		<textarea placeholder="Enter details for Label 3"></textarea>
	{:else if index === 3}
		<p>Content for Lab 4</p>
		<textarea placeholder="Enter details for Lab 4"></textarea>
	{/if}
{/snippet}

<ProgressIndicator bind:steps bind:currentStep {stepContent} />

{#if showAddTable}
	<AddTable bind:showDropdown={showAddTable} {dropdownTop} {dropdownLeft} />
{/if}

<Modal bind:showModal={showAddColumnModal}>
	{#snippet header()}
		<div class="heading">
			<h2>Add a column to {selectedTable?.name}</h2>
			<!-- <button class="btn" onclick={chooseFile}>Choose File</button> -->
		</div>
	{/snippet}

	{#snippet children()}
		<div>
			Name: <input type="text" bind:value={newColumnName} />
		</div>
		<div>
			Type: <select bind:value={howMakeNewColumn} onchange={calcnewColumnData}>
				<option value="random">Random</option>
				<option value="simulated">Simulated</option>
				<option value="existing">From existing columns</option>
			</select>
		</div>
		{#if howMakeNewColumn == 'random'}
			<div>
				Multiplier: <input
					type="number"
					bind:value={randomColMultiplier}
					onchange={calcnewColumnData}
				/>
				Offset: <input type="number" bind:value={randomColOffset} onchange={calcnewColumnData} />
			</div>
		{/if}
		{#if howMakeNewColumn == 'existing'}
			{#each newColsExisting as col, i}
				<ColumnSelector bind:value={newColsExisting[i]} onChange={calcnewColumnData} />
			{/each}
			Add new: <ColumnSelector
				bind:value={newColsValueReset}
				onChange={(value) => {
					newColsExisting.push(Number(value));
					newColsValueReset = -1;
					calcnewColumnData();
				}}
			/>
		{/if}

		{#if newColumnData.length > 0}
			<div>
				Preview:
				{newColumnData.slice(0, 5)}
			</div>
			<div><button onclick={confirmAddColumn}>Add these data</button></div>
		{/if}
	{/snippet}
</Modal>

<style>
	.heading {
		position: sticky;
		top: 0;

		width: 100%;
		height: 4vh;
		display: flex;
		flex-direction: row;
		justify-content: space-between;
		align-items: center;

		border-bottom: 1px solid #d9d9d9;
		background-color: white;
	}

	.heading p {
		margin-left: 1rem;
		font-weight: bold;
	}

	button {
		background-color: transparent;
		border: none;
		margin-right: 0.6rem;
		padding: 0;
		text-align: inherit;
		font: inherit;
		border-radius: 0;
		appearance: none;
		display: flex;
		justify-content: center;
		align-items: center;
	}

	.display-list {
		width: 100%;
		margin-top: 0.5rem;
	}

	/* TODO: hover effect, need update */
	summary::marker {
		margin-right: 1.2rem;
	}

	summary:open {
		margin-top: 0.3rem;
		margin-bottom: 0.5rem;
	}

	details:open {
		margin-bottom: 0.5rem;
	}

	details:open > summary.table-name {
		background-color: pink;
	}

	.table-container {
		margin-left: 0.5rem;
	}

	.table-container:hover {
		background-color: var(--color-lightness-98);
		border-radius: 5px 0 0 5px;
	}

	.table-item {
		margin-left: 0.5rem;
		padding-top: 0.2rem;
		padding-bottom: 0.2rem;
	}

	.column-item {
		margin-left: 1rem;
	}
</style>
