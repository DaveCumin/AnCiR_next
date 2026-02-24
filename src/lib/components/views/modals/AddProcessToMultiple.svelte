<script>
	// @ts-nocheck
	import Modal from '$lib/components/reusables/Modal.svelte';
	import { getTableById } from '$lib/core/Table.svelte';
	import { addProcessToColumns } from '$lib/core/Column.svelte';
	import { appConsts } from '$lib/core/core.svelte.js';

	let { show = $bindable(), tableId } = $props();

	let processChosen = $state('');
	let selectedColIds = $state(new Set());

	// Get sorted processes by display name
	let sortedProcesses = $derived.by(() => {
		return Array.from(appConsts.processMap.entries()).sort((a, b) => {
			const nameA = a[1].displayName || a[0];
			const nameB = b[1].displayName || b[0];
			return nameA.localeCompare(nameB);
		});
	});

	// All columns in the table (including table process outputs)
	let allColumns = $derived.by(() => {
		const table = getTableById(tableId);
		if (!table) return [];
		return table.columns.filter((c) => c != null);
	});

	function toggleColumn(colId) {
		const s = new Set(selectedColIds);
		if (s.has(colId)) {
			s.delete(colId);
		} else {
			s.add(colId);
		}
		selectedColIds = s;
	}

	function selectAll() {
		selectedColIds = new Set(allColumns.map((c) => c.id));
	}

	function selectNone() {
		selectedColIds = new Set();
	}

	let canConfirm = $derived(processChosen !== '' && selectedColIds.size >= 1);

	function confirm() {
		const cols = allColumns.filter((c) => selectedColIds.has(c.id));
		if (cols.length > 0 && processChosen) {
			addProcessToColumns(cols, processChosen);
		}
		// Reset and close
		processChosen = '';
		selectedColIds = new Set();
		show = false;
	}

	function onClose() {
		processChosen = '';
		selectedColIds = new Set();
	}
</script>

<Modal bind:showModal={show} onclose={onClose}>
	<h2>Add Process to Multiple Columns</h2>

	<div class="section">
		<label class="section-label">Process</label>
		<select bind:value={processChosen}>
			<option value="">Select a process…</option>
			{#each sortedProcesses as [key, value]}
				<option value={key}>{value.displayName || key}</option>
			{/each}
		</select>
	</div>

	<div class="section">
		<div class="columns-header">
			<label class="section-label">Columns</label>
			<div class="select-actions">
				<button class="link-btn" onclick={selectAll}>All</button>
				<button class="link-btn" onclick={selectNone}>None</button>
			</div>
		</div>
		<div class="column-list">
			{#each allColumns as col (col.id)}
				<label class="column-option">
					<input
						type="checkbox"
						checked={selectedColIds.has(col.id)}
						onchange={() => toggleColumn(col.id)}
					/>
					<span class="col-name">{col.name}</span>
					{#if col.tableProcessGUId !== ''}
						<span class="col-badge">output</span>
					{/if}
				</label>
			{/each}
			{#if allColumns.length === 0}
				<p class="empty-msg">No columns in this table.</p>
			{/if}
		</div>
	</div>

	{#if canConfirm}
		<div class="dialog-button-container">
			<button class="dialog-button" onclick={confirm}>
				Add to {selectedColIds.size} column{selectedColIds.size !== 1 ? 's' : ''}
			</button>
		</div>
	{/if}
</Modal>

<style>
	h2 {
		margin: 0 0 1rem 0;
		font-size: 1.1rem;
	}

	.section {
		margin-bottom: 1rem;
	}

	.section-label {
		display: block;
		font-weight: 500;
		font-size: 0.85rem;
		margin-bottom: 0.3rem;
		color: var(--color-lightness-35, #555);
	}

	select {
		width: 100%;
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--color-lightness-85, #ccc);
		border-radius: 4px;
		font-size: 0.9rem;
	}

	.columns-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.3rem;
	}

	.select-actions {
		display: flex;
		gap: 0.5rem;
	}

	.link-btn {
		background: none;
		border: none;
		padding: 0;
		font-size: 0.8rem;
		color: var(--color-lightness-35, #555);
		cursor: pointer;
		text-decoration: underline;
	}

	.link-btn:hover {
		color: #000;
	}

	.column-list {
		max-height: 30vh;
		overflow-y: auto;
		border: 1px solid var(--color-lightness-85, #ccc);
		border-radius: 4px;
		padding: 0.25rem 0;
	}

	.column-option {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.3rem 0.6rem;
		cursor: pointer;
		font-size: 0.85rem;
	}

	.column-option:hover {
		background-color: var(--color-lightness-97, #fafafa);
	}

	.column-option input[type='checkbox'] {
		margin: 0;
		cursor: pointer;
		accent-color: var(--color-lightness-35, #555);
	}

	.col-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.col-badge {
		font-size: 0.7rem;
		padding: 0.1rem 0.3rem;
		border-radius: 3px;
		background-color: var(--color-lightness-95, #f0f0f0);
		color: var(--color-lightness-35, #555);
		white-space: nowrap;
	}

	.empty-msg {
		padding: 0.5rem;
		font-size: 0.85rem;
		color: var(--color-lightness-35, #555);
		text-align: center;
	}

	.dialog-button-container {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.5rem;
	}

	.dialog-button {
		padding: 0.4rem 1rem;
		border: 1px solid var(--color-lightness-85, #ccc);
		border-radius: 4px;
		background: var(--color-lightness-95, #f5f5f5);
		cursor: pointer;
		font-size: 0.85rem;
	}

	.dialog-button:hover {
		background: var(--color-lightness-90, #eee);
	}
</style>
