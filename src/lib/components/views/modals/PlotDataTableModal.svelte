<script>
	// @ts-nocheck
	import Modal from '$lib/components/reusables/Modal.svelte';
	import VirtualList from '$lib/components/reusables/VirtualList.svelte';
	import { appState } from '$lib/core/core.svelte.js';
	import { saveDataAsCSV } from '$lib/components/plotbits/helpers/save.svelte.js';

	let showModal = $derived(appState.plotDataPreview.headers !== null);
	let headers = $derived(appState.plotDataPreview.headers ?? []);
	let rows = $derived(appState.plotDataPreview.rows ?? []);
	let name = $derived(appState.plotDataPreview.name ?? 'Plot data');
	let plotId = $derived(appState.plotDataPreview.plotId);

	function close() {
		appState.plotDataPreview = { headers: null, rows: null, name: null };
	}
</script>

<Modal
	bind:showModal
	onclose={close}
	width="min(95vw, 1100px)"
	max_height="85vh"
>
	{#snippet header()}
		<h3 style="margin: 0 0 0.75rem 0; font-size: 1rem;">{name}</h3>
	{/snippet}

	{#snippet children()}
		{#if rows.length === 0}
			<p style="color: var(--color-lightness-60); font-size: 0.9rem;">No data available.</p>
		{:else}
			{@const gridCols = `repeat(${Math.max(1, headers.length)}, minmax(110px, 1fr))`}
			<div class="table-scroll">
				<div class="vt-inner" style="min-width:{Math.max(1, headers.length) * 110}px;">
					<div class="vt-head" style="grid-template-columns:{gridCols};">
						{#each headers as h}
							<div class="vt-th">{h}</div>
						{/each}
					</div>
					<!-- Windowed body: only on-screen rows are in the DOM, so even a
					     100k-row export stays light. -->
					<VirtualList items={rows} height="58vh" itemHeight={30}>
						{#snippet row(r)}
							<div class="vt-tr" style="grid-template-columns:{gridCols};">
								{#each r as cell}
									<div class="vt-td">{cell ?? ''}</div>
								{/each}
							</div>
						{/snippet}
					</VirtualList>
				</div>
			</div>
			<p class="row-count">{rows.length} row{rows.length === 1 ? '' : 's'}</p>
		{/if}
	{/snippet}

	{#snippet button()}
		<div class="footer-buttons">
			<button class="btn-secondary" onclick={close}>Close</button>
			{#if plotId !== null}
				<button class="btn-primary" onclick={() => { saveDataAsCSV(plotId); close(); }}>
					Download CSV
				</button>
			{/if}
		</div>
	{/snippet}
</Modal>

<style>
	.table-scroll {
		overflow-x: auto;
		overflow-y: hidden;
		border: 1px solid var(--color-lightness-90);
		border-radius: var(--radius-sm);
		font-size: 0.85rem;
	}

	.vt-inner {
		display: flex;
		flex-direction: column;
	}

	.vt-head {
		display: grid;
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--color-lightness-95, #f5f5f5);
		white-space: nowrap;
	}

	.vt-th {
		padding: 0.5rem 0.75rem;
		font-weight: 600;
		border-bottom: 2px solid var(--color-lightness-85);
		border-right: 1px solid var(--color-lightness-90);
	}

	.vt-th:last-child {
		border-right: none;
	}

	.vt-tr {
		display: grid;
		white-space: nowrap;
	}

	.vt-tr:hover {
		background: var(--color-lightness-97, #fafafa);
	}

	.vt-td {
		padding: 0.35rem 0.75rem;
		border-bottom: 1px solid var(--color-lightness-93, #eee);
		border-right: 1px solid var(--color-lightness-90);
		font-variant-numeric: tabular-nums;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.vt-td:last-child {
		border-right: none;
	}

	.row-count {
		font-size: 0.8rem;
		color: var(--color-lightness-60);
		margin: 0.5rem 0 0 0;
	}

	.footer-buttons {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	.btn-primary,
	.btn-secondary {
		padding: 0.4rem 1rem;
		border-radius: var(--radius-sm);
		font: inherit;
		font-size: 0.9rem;
		cursor: pointer;
		border: 1px solid var(--color-lightness-80);
	}

	.btn-primary {
		background: var(--color-lightness-20, #333);
		color: white;
		border-color: var(--color-lightness-20, #333);
	}

	.btn-secondary {
		background: var(--surface-card);
		color: inherit;
	}
</style>
