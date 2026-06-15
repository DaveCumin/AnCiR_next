<script>
	// @ts-nocheck
	import { core, appConsts, appState } from '$lib/core/core.svelte.js';
	import { Column, getColumnById } from '$lib/core/Column.svelte';
	import { tick, untrack } from 'svelte';

	import Icon from '$lib/icons/Icon.svelte';
	import AddTable from '$lib/components/iconActions/AddTable.svelte';
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

	// ─── Canvas-selection mirroring ─────────────────────────────────────────────
	// Parse appState.canvasSelectedNodeId (e.g. "data_5", "process_7",
	// "tableprocess_3") into { kind, id }. Other kinds (plot/group/note/
	// nested-tp) don't appear in this panel and are ignored.
	const canvasSelection = $derived.by(() => {
		const raw = appState.canvasSelectedNodeId;
		if (!raw || typeof raw !== 'string') return null;
		const m = raw.match(/^(data|process|tableprocess)_(\d+)$/);
		if (!m) return null;
		return { kind: m[1], id: Number(m[2]) };
	});

	// Which table owns the selected item? Needed to auto-open its <details>.
	const selectedTableId = $derived.by(() => {
		const sel = canvasSelection;
		if (!sel) return null;
		for (const table of core.tables) {
			if (sel.kind === 'data' && table.columns?.some((c) => c.id === sel.id)) return table.id;
			if (sel.kind === 'tableprocess' && table.processes?.some((tp) => tp.id === sel.id))
				return table.id;
			if (
				sel.kind === 'process' &&
				table.columns?.some((c) => c.processes?.some((p) => p.id === sel.id))
			)
				return table.id;
		}
		return null;
	});

	// Refs for scroll-into-view, keyed by `${kind}_${id}`
	let rowRefs = $state({});

	$effect(() => {
		const sel = canvasSelection;
		const tid = selectedTableId;
		if (!sel || tid == null) return;
		untrack(() => {
			openClps[tid] = true;
		});
		tick().then(() => {
			const el = rowRefs[`${sel.kind}_${sel.id}`];
			if (el?.scrollIntoView) {
				el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
			}
		});
	});
</script>

<div class="heading">
	<p>Data Sources</p>

	<div class="databuttons">
		<button class="icon" onclick={() => (showSwapColumns = true)} title="Swap table">
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
				<summary
					class="clps-title-container"
					onclick={(e) => e.preventDefault()}
					onkeydown={(e) => {
						if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget)
							e.preventDefault();
					}}
				>
					<div class="clps-title">
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
							<Icon name="trash" width={20} height={20} className="menu-icon" />
						</button>
						<button
							class="icon"
							onclick={() => {
								openClps[table.id] = !openClps[table.id];
							}}
						>
							{#if openClps[table.id]}
								<Icon
									name="caret-down"
									width={20}
									height={20}
									className="first-detail-title-icon"
								/>
							{:else}
								<Icon
									name="caret-right"
									width={20}
									height={20}
									className="first-detail-title-icon"
								/>
							{/if}
						</button>
					</div>
				</summary>

				{#each table.processes as p (p.id)}
					<div
						class="second-clps"
						class:canvas-selected={canvasSelection?.kind === 'tableprocess' &&
							canvasSelection.id === p.id}
						bind:this={rowRefs[`tableprocess_${p.id}`]}
					>
						<TableProcess {p} />
					</div>
					<br />
				{/each}

				{#each table.columns as col (col.id)}
					{#if col.tableProcessGUId == ''}
						{@const colSelected =
							canvasSelection?.kind === 'data' && canvasSelection.id === col.id}
						{@const ownsSelectedProcess =
							canvasSelection?.kind === 'process' &&
							col.processes?.some((pr) => pr.id === canvasSelection.id)}
						<div
							class="second-clps"
							class:canvas-selected={colSelected || ownsSelectedProcess}
							bind:this={rowRefs[`data_${col.id}`]}
						>
							<ColumnComponent {col} canvasSelectedProcessId={ownsSelectedProcess
								? canvasSelection.id
								: null} />
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

	/* Mirrors the canvas selection — applied when the corresponding node is
	   focused in WorkflowEditor (via appState.canvasSelectedNodeId). */
	.second-clps.canvas-selected {
		border-radius: 4px;
		box-shadow: inset 2px 0 0 var(--color-accent, #4d9fe3);
		background-color: color-mix(in srgb, var(--color-accent, #4d9fe3) 8%, transparent);
	}
</style>
