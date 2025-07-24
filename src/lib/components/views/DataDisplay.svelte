<script>
	// TODO: multiple select on control plots,
	// bulk change (e.g. width)

	// @ts-nocheck
	import { core, appConsts } from '$lib/core/core.svelte.js';
	import Icon from '$lib/icons/Icon.svelte';
	import AddTable from '$lib/components/iconActions/AddTable.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import { Column, getColumnById } from '$lib/core/Column.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import TableProcess from '$lib/core/TableProcess.svelte';
	import { closeDisplayPanel } from '$lib/components/DisplayPanel.svelte';
	import MakeNewColumn from './modals/MakeNewColumn.svelte';
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
		requestAnimationFrame(() => {
			showAddTable = true;
		});
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

	<button onclick={closeDisplayPanel}>
		<Icon name="close" width={16} height={16} className="close" />
	</button>

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
				<button
					onclick={() => {
						selectedTable = table.id;
						showNewCol = true;
					}}>Add column</button
				>
				<button
					onclick={() => {
						makeNewTablePlot(table.id);
					}}>View Table</button
				>
				{#each table.columns as col, i}
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

<NumberWithUnits />
{#if showAddTable}
	<AddTable bind:showDropdown={showAddTable} {dropdownTop} {dropdownLeft} />
{/if}

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
