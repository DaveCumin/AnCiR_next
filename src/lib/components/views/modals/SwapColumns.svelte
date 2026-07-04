<script>
	// @ts-nocheck
	import { swapColumnRefsBulk } from '$lib/core/core.svelte.js';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';

	let { showModal = $bindable(false) } = $props();

	let pairs = $state([{ from: -1, to: -1 }]);

	const canSwap = $derived(pairs.some((p) => p.from >= 0 && p.to >= 0 && p.from !== p.to));

	function addRow() {
		pairs = [...pairs, { from: -1, to: -1 }];
	}

	function removeRow(index) {
		pairs = pairs.filter((_, i) => i !== index);
		if (pairs.length === 0) pairs = [{ from: -1, to: -1 }];
	}

	function doSwap() {
		const valid = pairs
			.filter((p) => p.from >= 0 && p.to >= 0 && p.from !== p.to)
			.map((p) => [p.from, p.to]);
		swapColumnRefsBulk(valid);
		showModal = false;
		pairs = [{ from: -1, to: -1 }];
	}
</script>

<Modal bind:showModal>
	<div class="swap-header">
		<h2>Swap Table</h2>
		<p>
			Define column pairs to swap. All downstream processes, analyses, and plots will be
			rewired.
		</p>
	</div>
	<div class="swap-container">
		<div class="table-header">
			<span class="col-label">From</span>
			<span class="col-label">To</span>
			<span class="col-action"></span>
		</div>
		{#each pairs as pair, i (i)}
			<div class="swap-row">
				<ColumnSelector bind:value={pair.from} />
				<span class="arrow" title="Swap direction">&#8644;</span>
				<ColumnSelector bind:value={pair.to} />
				<button class="btn-remove" onclick={() => removeRow(i)} title="Remove row">&times;</button>
			</div>
		{/each}
		<div class="footer">
			<button class="btn-add" onclick={addRow}>+ Add pair</button>
			{#if canSwap}
				<button class="swap-btn" onclick={doSwap}>Swap all</button>
			{/if}
		</div>
	</div>
</Modal>

<style>
	.swap-header {
		margin-bottom: 16px;
	}

	.swap-header h2 {
		margin: 0 0 4px 0;
		font-size: 16px;
	}

	.swap-header p {
		margin: 0;
		font-size: var(--font-md);
		color: var(--color-text-muted);
	}

	.swap-container {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 400px;
	}

	.table-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 2px;
	}

	.col-label {
		flex: 1;
		font-size: var(--font-sm);
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.col-action {
		width: 24px;
	}

	.swap-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.arrow {
		font-size: 18px;
		color: #888;
		flex-shrink: 0;
		cursor: default;
	}

	.footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: 8px;
	}

	.swap-btn {
		padding: 6px 18px;
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: var(--font-md);
	}

	.swap-btn:hover {
		background: #0260d4;
	}
</style>
