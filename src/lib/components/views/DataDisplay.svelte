<script>
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

	let openClps = $state({});
	function toggleClps(id) {
		openClps[id] = !openClps[id];
	}

	let openMenus = $state({});
	function toggleMenu(id) {
		openMenus[id] = !openMenus[id];
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
		<div class="clps-container">
			<details class="clps-item">
				<summary
					class="clps-title-container"
					onclick={(e) => {
					e.stopPropagation();
					toggleClps(table.id);
				}}
				>
					<div class="clps-title">
						<p>{table.name}</p>
					</div>
					
					<div class="clps-title-button">
						<button class="icon" onclick={(e) => {
							e.stopPropagation();
							toggleMenu(table.id)
						}}>
							<Icon name="menu-horizontal-dots" width={20} height={20} className="menu-icon"/>
						</button>
						{#if openClps[table.id]}
							<Icon name="caret-down" width={20} height={20} className="first-detail-title-icon" />
						{:else}
							<Icon name="caret-right" width={20} height={20} className="first-detail-title-icon" />
						{/if}
					</div>
				</summary>

				<!-- <div class="clps-icon-container">
					<button class="clps-icon"
						onclick={() => {
							selectedTable = table.id;
							showNewCol = true;
					}}>
						<Icon name="plus" width={16} height={16} className="static-icon" />
						<p>Add new column</p>
					</button>
				</div>

				<button
					onclick={() => {
						makeNewTablePlot(table.id);
				}}>
					View Table
				</button> -->

				{#each table.columns as col (col.id)}
					{#if !col.tableProcessed}
					<div class="second-clps">
						<ColumnComponent {col} />
					</div>
					{/if}
				{/each}
				{#each table.processes as p}
				<div class="second-clps">
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
		min-height: calc(16px + 0.25rem * 2);
		display: flex;
		flex-direction: row;
		justify-content: space-between;
		align-items: center;

		border-bottom: 1px solid var(--color-lightness-85);
		background-color: white;

		z-index: 999;
	}

	.heading p {
		margin-left: 0.75rem;
		font-weight: bold;
	}

	.display-list {
		width: 100%;
		margin-top: 0.25rem;
	}

	/* collapsible */
	details {
		margin: 0.25rem 0.5rem 0.25rem 0.75rem;
		padding: 0;
	}

	summary {
		list-style: none;

		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;

		margin: 0;
		padding: 0;
	}

	summary p {
		margin: 0;
		padding: 0;
	}

	summary button {
		margin: 0;
		padding: 0;
	}

	summary .icon {
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.2s ease;
	}

	details:hover summary .icon {
		opacity: 1;
		pointer-events: auto;
	}

	

</style>
