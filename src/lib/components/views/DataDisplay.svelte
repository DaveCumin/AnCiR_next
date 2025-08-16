<script>
	// @ts-nocheck
	import { core, appConsts, appState } from '$lib/core/core.svelte.js';
	import { Column, getColumnById } from '$lib/core/Column.svelte';

	import Icon from '$lib/icons/Icon.svelte';
	import AddTable from '$lib/components/iconActions/AddTable.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import TableProcess from '$lib/core/TableProcess.svelte';
	import MakeNewColumn from './modals/MakeNewColumn.svelte';
	import NumberWithUnits from '../inputs/NumberWithUnits.svelte';
	import { Plot } from '$lib/core/Plot.svelte';
	import { getTableById } from '$lib/core/Table.svelte';
	import SingleTableAction from '../iconActions/SingleTableAction.svelte';
	import { preventDefault } from 'svelte/legacy';

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
</script>

<div class="heading">
	<p>Data Sources</p>

	<div class="add">
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
						<p
							contenteditable="false"
							ondblclick={(e) => {
								e.target.setAttribute('contenteditable', 'true');
								e.target.focus();
							}}
							onfocusout={(e) => e.target.setAttribute('contenteditable', 'false')}
							bind:innerHTML={table.name}
						></p>
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
					<hr />
				{/each}

				{#each table.columns as col (col.id)}
					{#if col.tableProcessGUId == ''}
						<div class="second-clps">
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

<SingleTableAction
	bind:showDropdown={showSingleTableDropdown}
	{dropdownTop}
	{dropdownLeft}
	tableId={selectedTable}
	{addNewColumn}
/>

<MakeNewColumn bind:show={showNewCol} tableId={selectedTable} />

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
</style>
