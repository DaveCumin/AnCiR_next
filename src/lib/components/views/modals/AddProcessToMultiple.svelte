<script>
// @ts-nocheck
import Modal from '$lib/components/reusables/Modal.svelte';
import { addProcessToColumns, getColumnById } from '$lib/core/Column.svelte';
import { appConsts, core } from '$lib/core/core.svelte.js';
import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';

let { show = $bindable() } = $props();

let processChosen = $state('');
let selectedColIds = $state([]);

// Get sorted processes by display name
let sortedProcesses = $derived.by(() => {
	return Array.from(appConsts.processMap.entries()).sort((a, b) => {
		const nameA = a[1].displayName || a[0];
		const nameB = b[1].displayName || b[0];
		return nameA.localeCompare(nameB);
	});
});

// All column IDs across all tables (for select-all)
let allColIds = $derived.by(() => {
	return core.tables.flatMap((t) => t.columns.filter((c) => c != null).map((c) => c.id));
});

function selectAll() {
	selectedColIds = [...allColIds];
}

function selectNone() {
	selectedColIds = [];
}

let canConfirm = $derived(processChosen !== '' && selectedColIds.length >= 1);

function confirm() {
	const cols = selectedColIds.map((id) => getColumnById(id)).filter(Boolean);
	if (cols.length > 0 && processChosen) {
		addProcessToColumns(cols, processChosen);
	}
	processChosen = '';
	selectedColIds = [];
	show = false;
}

function onClose() {
	processChosen = '';
	selectedColIds = [];
}
</script>

<Modal bind:showModal={show} onclose={onClose}>
<h2>Add Process to Multiple Columns</h2>

<div class="section">
	<span class="section-label">Process</span>
	<select bind:value={processChosen}>
		<option value="">Select a process…</option>
		{#each sortedProcesses as [key, value]}
			<option value={key}>{value.displayName || key}</option>
		{/each}
	</select>
</div>

<div class="section">
	<div class="columns-header">
		<span class="section-label">Columns <span class="hint">(shift-click for range)</span></span>
		<div class="select-actions">
			<button class="link-btn" onclick={selectAll}>All</button>
			<button class="link-btn" onclick={selectNone}>None</button>
		</div>
	</div>
	<ColumnSelector multiple={true} bind:value={selectedColIds} />
</div>

{#if canConfirm}
	<div class="dialog-button-container">
		<button class="dialog-button" onclick={confirm}>
			Add to {selectedColIds.length} column{selectedColIds.length !== 1 ? 's' : ''}
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

.hint {
	font-weight: 400;
	font-size: 0.75rem;
	color: var(--color-lightness-55, #888);
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
