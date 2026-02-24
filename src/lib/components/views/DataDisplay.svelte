<script>
	// @ts-nocheck
	import { core, appConsts, appState } from '$lib/core/core.svelte.js';
	import { Column, getColumnById } from '$lib/core/Column.svelte';

	import Icon from '$lib/icons/Icon.svelte';
	import AddTable from '$lib/components/iconActions/AddTable.svelte';
	import AddProcess from '$lib/components/iconActions/AddProcess.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import TableProcess from '$lib/core/TableProcess.svelte';
	import MakeNewColumn from './modals/MakeNewColumn.svelte';
	import SwapColumns from './modals/SwapColumns.svelte';
	import NumberWithUnits from '../inputs/NumberWithUnits.svelte';
	import { Plot } from '$lib/core/Plot.svelte';
	import { deleteTable, getTableById } from '$lib/core/Table.svelte';
	import SingleTableAction from '../iconActions/SingleTableAction.svelte';
	import { preventDefault } from 'svelte/legacy';
	import Editable from '../inputs/Editable.svelte';

	// AddTable dropdown
	let showAddTable = $state(false);
	let dropdownTop = $state(0);
	let dropdownLeft = $state(0);

	function setDropdownPositionFromEvent(e) {
		const rect = e.currentTarget.getBoundingClientRect();
		dropdownTop = rect.top + window.scrollY;
		dropdownLeft = rect.right + window.scrollX + 12;
	}

	function openDropdown(e) {
		e.stopPropagation();
		setDropdownPositionFromEvent(e);
		showAddTable = true;
	}

	let showSwapColumns = $state(false);

	let showNewCol = $state(false);
	let selectedTable = $state(null);

	export function addNewColumn(id) {
		selectedTable = id;
		showNewCol = true;
	}

	let showSingleTableDropdown = $state(false);

	function openSingleTableDropdown(e, id) {
		selectedTable = id;
		setDropdownPositionFromEvent(e);
		showSingleTableDropdown = true;
	}

	let openClps = $state({});

	let openMenus = $state({});
	function toggleMenu(id) {
		openMenus[id] = !openMenus[id];
	}

	let timeval = $state(Number(new Date()));

	// Multi-column selection state (per table)
	let selectedColIds = $state({});

	function toggleColumnSelection(tableId, colId) {
		if (!selectedColIds[tableId]) selectedColIds[tableId] = new Set();
		const s = selectedColIds[tableId];
		if (s.has(colId)) {
			s.delete(colId);
		} else {
			s.add(colId);
		}
		// Trigger reactivity by reassigning
		selectedColIds[tableId] = new Set(s);
	}

	function getSelectedColumns(tableId) {
		const ids = selectedColIds[tableId];
		if (!ids || ids.size === 0) return [];
		const table = getTableById(tableId);
		if (!table) return [];
		return table.columns.filter((col) => ids.has(col.id));
	}

	function clearColumnSelection(tableId) {
		selectedColIds[tableId] = new Set();
	}

	// AddProcess dropdown for multi-column
	let showMultiAddProcess = $state(false);
	let multiProcessTableId = $state(null);

	function openMultiProcessDropdown(e, tableId) {
		e.stopPropagation();
		setDropdownPositionFromEvent(e);
		multiProcessTableId = tableId;
		showMultiAddProcess = true;
	}
</script>

<div class="heading">
	<p>Data Sources</p>

	<div class="databuttons">
		<button class="icon" onclick={() => (showSwapColumns = true)} title="Swap column references">
			<Icon name="swap" width={16} height={16} />
		</button>
		<button class="icon" onclick={openDropdown}>
			<Icon name="add" width={16} height={16} />
		</button>
	</div>
</div>

<!-- TODO: write custom component to achieve -->
<div class="display-list">
	{#each core.tables as table (table.id)}
		<div class="clps-container">
			<details class="clps-item" bind:open={openClps[table.id]}>
				<summary class="clps-title-container">
					<div
						class="clps-title"
						onclick={(e) => {
							e.preventDefault();
							e.stopPropagation();
						}}
					>
						<p><Editable bind:value={table.name} /></p>
					</div>

					<div class="clps-title-button">
						<button
							class="icon"
							onclick={(e) => {
								e.stopPropagation();
								openSingleTableDropdown(e, table.id);
							}}
						>
							<Icon name="menu-horizontal-dots" width={20} height={20} className="menu-icon" />
						</button>
						<button
							class="icon"
							onclick={(e) => {
								e.stopPropagation();
								deleteTable(table.id);
							}}
						>
							<Icon name="minus" width={20} height={20} className="menu-icon" />
						</button>
						{#if openClps[table.id]}
							<Icon name="caret-down" width={20} height={20} className="first-detail-title-icon" />
						{:else}
							<Icon name="caret-right" width={20} height={20} className="first-detail-title-icon" />
						{/if}
					</div>
				</summary>

				{#each table.processes as p}
					<div class="second-clps">
						<TableProcess {p} />
					</div>
					<br />
				{/each}

				{#if getSelectedColumns(table.id).length > 1}
					<div class="multi-col-actions">
						<span class="multi-col-label">{getSelectedColumns(table.id).length} columns selected</span>
						<button
							class="multi-col-btn"
							onclick={(e) => openMultiProcessDropdown(e, table.id)}
						>
							<Icon name="process" width={14} height={14} />
							Add Process
						</button>
						<button
							class="multi-col-btn"
							onclick={() => clearColumnSelection(table.id)}
						>
							Clear
						</button>
					</div>
				{/if}

				{#each table.columns as col (col.id)}
					{#if col.tableProcessGUId == ''}
						<div class="second-clps col-row">
							<input
								type="checkbox"
								class="col-checkbox"
								checked={selectedColIds[table.id]?.has(col.id) ?? false}
								onclick={(e) => e.stopPropagation()}
								onchange={() => toggleColumnSelection(table.id, col.id)}
							/>
							<ColumnComponent {col} />
						</div>
					{/if}
				{/each}
			</details>
		</div>
	{/each}

	<div class="div-block"></div>
</div>

<AddTable bind:showDropdown={showAddTable} {dropdownTop} {dropdownLeft} />

<AddProcess
	bind:showDropdown={showMultiAddProcess}
	columnsSelected={multiProcessTableId != null ? getSelectedColumns(multiProcessTableId) : []}
	{dropdownTop}
	{dropdownLeft}
/>

<SingleTableAction
	bind:showDropdown={showSingleTableDropdown}
	{dropdownTop}
	{dropdownLeft}
	tableId={selectedTable}
	{addNewColumn}
/>

<MakeNewColumn bind:show={showNewCol} tableId={selectedTable} />

<SwapColumns bind:showModal={showSwapColumns} />

<style>
	.heading {
		position: sticky;
		top: 0;

		width: 100%;
		height: 2rem;
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

	.heading button {
		margin-right: 0.65rem;
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

	.databuttons {
		display: flex;
	}

	.col-row {
		display: flex;
		align-items: flex-start;
		gap: 0.25rem;
	}

	.col-checkbox {
		margin-top: 0.55rem;
		flex-shrink: 0;
		cursor: pointer;
		accent-color: var(--color-lightness-35, #555);
	}

	.multi-col-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		margin: 0.25rem 0.75rem 0.5rem;
		padding: 0.35rem 0.5rem;
		background-color: var(--color-lightness-95, #f5f5f5);
		border-radius: 4px;
		font-size: 12px;
	}

	.multi-col-label {
		font-weight: 500;
		color: var(--color-lightness-35, #555);
	}

	.multi-col-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.15rem 0.4rem;
		font-size: 12px;
		border: 1px solid var(--color-lightness-85, #ccc);
		border-radius: 3px;
		background: white;
		cursor: pointer;
	}

	.multi-col-btn:hover {
		background-color: var(--color-lightness-90, #eee);
	}
</style>
