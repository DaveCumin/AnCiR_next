<script>
	// @ts-nocheck

	import { core, appConsts } from '$lib/core/core.svelte.js';
	import Icon from '$lib/icons/Icon.svelte';
	import AddPlot from '../views/modals/MakeNewPlot.svelte';
	import CreateNewPlotModal from './modals/CreateNewPlotModal.svelte';

	let showNewPlotModal = $state(false);

	function openMakeNewPlot() {
		showNewPlotModal = true;
	}
</script>



<div class="heading">
	<p>Worksheet Layers</p>

	<div class="add">
		<button onclick={openMakeNewPlot}>
			<Icon name="add" width={16} height={16} />
		</button>
	</div>
</div>

<AddPlot bind:showModal={showNewPlotModal} />

<div class="display-list">
	{#each core.plots.toReversed() as plot, i (plot.id)}
		<details
			draggable="true"
			ondragstart={() => handleDragStart(i)}
			ondragover={handleDragOver}
			ondrop={() => handleDrop(i)}
		>
			<summary>{plot.name}</summary>
			{#if plot.id >= 0}
				{@const Plot = appConsts.plotMap.get(plot.type).plot ?? null}
				<!-- <Plot theData={plot.plot} which="controls" /> -->
			{/if}
		</details>
	{/each}
</div>


<style>
	.heading {
		position: sticky;
		top: 0;

		width: 100%;
		height: 4vh;
		display: flex;
		flex-direction: row;
		justify-content: space-between;
		align-items: center;

		border-bottom: 1px solid #d9d9d9;
		background-color: white;
	}

	.heading p {
		margin-left: 1rem;
		font-weight: bold;
	}

	button {
		background-color: transparent;
		border: none;
		margin-right: 0.6rem;
		padding: 0;
		text-align: inherit;
		font: inherit;
		border-radius: 0;
		appearance: none;
		display: flex;
		justify-content: center;
		align-items: center;
	}

	.display-list {
		width: 100%;
		margin-top: 0.5rem;
	}
</style>