<script>
	// TODO: multiple select on control plots,
	// bulk change (e.g. width)

	// @ts-nocheck
	import { core, appConsts } from '$lib/core/core.svelte.js';
	import { Column, getColumnById } from '$lib/core/Column.svelte';

	import Icon from '$lib/icons/Icon.svelte';
	import AddTable from '$lib/components/iconActions/AddTable.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import TableProcess from '$lib/core/TableProcess.svelte';
	import MakeNewColumn from './modals/MakeNewColumn.svelte';
	import Collapisble from '../reusables/Collapisble.svelte';
	import NumberWithUnits from '../inputs/NumberWithUnits.svelte';
	import { Plot } from '$lib/core/Plot.svelte';
	import { getTableById } from '$lib/core/Table.svelte';

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
		showAddTable = true;

		window.addEventListener('resize', recalculateDropdownPosition);
	}

	let showNewCol = $state(false);
	let selectedTable = $state(null);

	/// Display as TablePlot
	function makeNewTablePlot(id) {
		core.plots.push(new Plot({ name: 'Data from ' + getTableById(id).name, type: 'tableplot' }));
		core.plots[core.plots.length - 1].x = 250;
		core.plots[core.plots.length - 1].y = 250;
		core.plots[core.plots.length - 1].plot.columnRefs = getTableById(id).columnRefs;
		core.plots[core.plots.length - 1].plot.showCol = new Array(
			getTableById(id).columnRefs.length
		).fill(true);
	}
</script>

<div class="heading">
	<p>Data Sources</p>

	<div class="add">
		<button bind:this={addBtnRef} class="icon" onclick={openDropdown}>
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

				<div class="collapsible-icon-container">
					<button
						class="collapsible-icon"
						onclick={() => {
							selectedTable = table.id;
							showNewCol = true;
						}}
					>
						<Icon name="plus" width={16} height={16} className="static-icon" />
					</button>
				</div>

				<button
					onclick={() => {
						makeNewTablePlot(table.id);
					}}>View Table</button
				>

				{#each table.columns as col, i}
					{#if !col.tableProcessed}
						<div class="second-collapsible">
							<ColumnComponent {col} />
						</div>
					{/if}
				{/each}
				{#each table.processes as p}
					<div class="second-collapsible">
						<TableProcess {p} />
					</div>
				{/each}
			</details>
		</div>
	{/each}

	<div class="div-block"></div>
</div>

<!-- <div class="display-list">
	{#each core.tables as table(table.id)}
		<div class="table-container">

		</div>
	{/each}
</div> -->

<AddTable bind:showDropdown={showAddTable} {dropdownTop} {dropdownLeft} />

<MakeNewColumn bind:show={showNewCol} tableId={selectedTable} />

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

	.display-list {
		width: 100%;
		margin-top: 0.5rem;
	}

	.collapsible-icon-container {
		display: flex;
		align-items: center;
		justify-content: center;

		padding: 0.5rem 0.5rem;
		padding-left: 1rem;
	}

	.collapsible-icon {
		width: 100%;
		padding: 0.2rem 0;

		background-color: white;
		border-radius: 4px;
		border: solid 1px var(--color-lightness-85);

		border-color: none;
		appearance: none;
	}

	.collapsible-icon:hover {
		background-color: var(--color-lightness-98);
		cursor: pointer;
	}

	/* TODO: fix parent and child relationship */
	.second-collapsible {
		padding: 0.5rem 0.5rem;
		padding-left: 1rem;
	}
</style>
