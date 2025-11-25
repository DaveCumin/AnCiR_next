<script>
	import { appConsts } from '$lib/core/core.svelte.js';

	let { data } = $props();
	let plot = data.plot;
</script>

<div class="plot-node">
	<div class="plot-header">
		<p>{plot.name}</p>
	</div>
	<div class="plot-content">
		{#if data.plot}
			{@const Plot = appConsts.plotMap.get(plot.type).plot ?? null}
			<Plot theData={plot} which="plot" />
		{/if}
	</div>
</div>

<style>
	.plot-node {
		border: 1px solid var(--color-lightness-85);
		background-color: white;
		border-radius: 4px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		box-shadow: 0 2px 5px rgba(0, 0, 0, 0.15);
	}

	.plot-header {
		padding: 0.5rem 1rem;
		background-color: var(--color-lightness-98);
		border-bottom: 1px solid var(--color-lightness-85);
		font-weight: bold;
		cursor: move;
	}

	.plot-header p {
		margin: 0;
	}

	.plot-content {
		flex: 1;
		padding: 0.5rem;
		overflow: auto;
	}
</style>
