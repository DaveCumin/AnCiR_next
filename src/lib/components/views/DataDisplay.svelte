<script>
	// TODO: multiple select on control plots,
	// bulk change (e.g. width)

	// @ts-nocheck
	import { core, appConsts } from '$lib/core/core.svelte.js';
	import Icon from '$lib/icons/Icon.svelte';
	import AddTable from '$lib/components/iconActions/AddTable.svelte';
	import Column from '$lib/core/Column.svelte';
	import { getColumnByID } from '$lib/core/Column.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import ColumnSelector from '../inputs/ColumnSelector.svelte';

	//variables for new column
	let showAddColumnModal = $state(false);
	let selectedTable = $state();
	let newColumnType = $state('');
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
	$effect(() => {
		console.log('effect | newColType: ', newColumnType);
		if (newColumnType == 'random') {
			newColumnData = Array.from(
				{ length: newColumnLength },
				() => Math.round(Math.random() * randomColMultiplier, 2) + randomColOffset
			);
		} else if (newColumnType == 'existing') {
		} else {
			newColumnData = [];
		}
	});
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
					<Column col={core.data.find((c) => c.id === col.id)} />
				{/each}
			</details>
		</div>
	{/each}
</div>

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
			Type: <select bind:value={newColumnType}>
				<option value="random">Random</option>
				<option value="simulated">Simulated</option>
				<option value="existing">From existing columns</option>
			</select>
		</div>
		{#if newColumnType == 'random'}
			<div>
				Multiplier: <input type="number" bind:value={randomColMultiplier} />
				Offset: <input type="number" bind:value={randomColOffset} />
			</div>
		{/if}
		{#if newColumnType == 'existing'}
			{#each newColsExisting as col, i}
				<ColumnSelector bind:value={newColsExisting[i]} />
			{/each}
			Add new: <ColumnSelector
				bind:value={newColsValueReset}
				onChange={(value) => {
					newColsExisting.push(Number(value));
					newColsValueReset = -1;
				}}
			/>
		{/if}

		{#if newColumnData.length > 0}
			<div>
				Preview:
				{newColumnData.slice(0, 5)}
			</div>
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
