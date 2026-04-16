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
			Define column pairs to swap. All downstream processes, table processes, and plots will be
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
				<button class="remove-btn" onclick={() => removeRow(i)} title="Remove row">&times;</button>
			</div>
		{/each}
		<div class="footer">
			<button class="add-btn" onclick={addRow}>+ Add pair</button>
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
		font-size: 13px;
		color: #666;
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
		font-size: 12px;
		font-weight: 600;
		color: #666;
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

	.remove-btn {
		width: 24px;
		height: 24px;
		padding: 0;
		border: none;
		background: transparent;
		color: #999;
		font-size: 18px;
		cursor: pointer;
		border-radius: 3px;
		line-height: 1;
		flex-shrink: 0;
	}

	.remove-btn:hover {
		background: var(--color-error-bg);
		color: var(--color-error);
	}

	.footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: 8px;
	}

	.add-btn {
		padding: 4px 12px;
		background: transparent;
		border: 1px dashed #aaa;
		border-radius: 4px;
		cursor: pointer;
		font-size: 13px;
		color: #555;
	}

	.add-btn:hover {
		border-color: #666;
		color: #333;
	}

	.swap-btn {
		padding: 6px 18px;
		background: #0275ff;
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-size: 13px;
	}

	.swap-btn:hover {
		background: #0260d4;
	}
</style>
