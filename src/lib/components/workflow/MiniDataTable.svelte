<script>
	// @ts-nocheck
	let { column, maxRows = 5 } = $props();

	const MAX_CELL = 12;

	function formatCell(v) {
		if (v == null) return '—';
		if (typeof v === 'number') {
			if (!Number.isFinite(v)) return String(v);
			return Number.isInteger(v) ? String(v) : Number(v.toPrecision(4)).toString();
		}
		const s = String(v);
		if (s.length <= MAX_CELL) return s;
		return s.slice(0, MAX_CELL - 1) + '…';
	}

	let data = $derived(typeof column?.getData === 'function' ? column.getData() : []);
	let preview = $derived(data.slice(0, maxRows));
	let total = $derived(data.length);
</script>

<div class="mini-table" role="table" aria-label={`Preview of ${column?.name ?? ''}`}>
	<div class="mini-header">{column?.name ?? '(unnamed)'}</div>
	<div class="mini-rows">
		{#each preview as v}
			<div class="mini-row">{formatCell(v)}</div>
		{/each}
		{#if total === 0}
			<div class="mini-row empty">no data</div>
		{/if}
	</div>
	{#if total > 0}
		<div class="mini-footer">{total} rows total</div>
	{/if}
</div>

<style>
	.mini-table {
		font-family: var(--font-mono, ui-monospace, SF Mono, monospace);
		font-size: 0.7rem;
		background: var(--color-lightness-95, #fafafa);
		border: 1px solid var(--color-lightness-85, #e8e8e8);
		border-radius: 0.2rem;
		padding: 0.25rem 0.4rem;
		min-width: 70px;
	}
	.mini-header {
		font-weight: 600;
		padding-bottom: 0.2rem;
		margin-bottom: 0.2rem;
		border-bottom: 1px solid var(--color-lightness-85, #e8e8e8);
		color: var(--color-lightness-25, #333);
	}
	.mini-rows {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.mini-row {
		padding: 0.1rem 0;
		color: var(--color-lightness-35, #555);
	}
	.mini-row.empty {
		font-style: italic;
		opacity: 0.6;
	}
	.mini-footer {
		font-size: 0.65rem;
		color: var(--color-lightness-50, #888);
		margin-top: 0.2rem;
		padding-top: 0.2rem;
		border-top: 1px dashed var(--color-lightness-85, #eee);
	}
</style>
