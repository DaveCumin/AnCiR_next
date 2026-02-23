<script>
	// @ts-nocheck
	import { swapColumnRefs } from '$lib/core/core.svelte.js';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';

	let { showModal = $bindable(false) } = $props();

	let colA = $state(-1);
	let colB = $state(-1);

	const canSwap = $derived(colA >= 0 && colB >= 0 && colA !== colB);

	function doSwap() {
		swapColumnRefs(colA, colB);
		showModal = false;
		colA = -1;
		colB = -1;
	}
</script>

<Modal bind:showModal>
	<div class="swap-header">
		<h2>Swap Columns</h2>
		<p>
			All downstream processes, table processes, and plots will be rewired to swap the two columns.
		</p>
	</div>
	<div class="swap-container">
		<div class="row">
			<label for="colA">Column A:</label>
			<ColumnSelector bind:value={colA} />
		</div>
		<div class="arrow" title="These two columns will have all their references swapped">⇅</div>
		<div class="row">
			<label for="colB">Column B:</label>
			<ColumnSelector bind:value={colB} />
		</div>
		{#if canSwap}
			<div class="footer">
				<button class="swap-btn" onclick={doSwap}>Swap references</button>
			</div>
		{/if}
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
		gap: 8px;
		min-width: 300px;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	label {
		font-size: 13px;
		min-width: 80px;
		flex-shrink: 0;
	}

	.arrow {
		text-align: center;
		font-size: 22px;
		color: #888;
		line-height: 1;
		cursor: default;
	}

	.footer {
		display: flex;
		justify-content: flex-end;
		margin-top: 8px;
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
