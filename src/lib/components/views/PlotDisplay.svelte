<script>
	// TODO: scroll horizontally and vertically
	// TODO: if mouse reach end of screen, screen shifts with mouse

	// @ts-nocheck
	import Draggable from '$lib/components/reusables/Draggable.svelte';

	import { core, appConsts, appState } from '$lib/core/core.svelte.js';
</script>

<div
	class="canvas"
	style="top: 0; left: {appState.positionDisplayPanel}px; width: {window.innerWidth -
		appState.positionDisplayPanel -
		(window.innerWidth - appState.positionControlPanel)}px; height: 100vh;"
>
	{#each core.plots as plot, i (plot.id)}
		<Draggable
			bind:x={plot.x}
			bind:y={plot.y}
			bind:width={plot.width}
			bind:height={plot.height}
			title={plot.name}
			id={plot.id}
		>
			{@const Plot = appConsts.plotMap.get(plot.type).plot ?? null}
			<Plot theData={plot} which="plot" />
		</Draggable>
	{/each}
</div>

<style>
	.canvas {
		position: fixed;
		overflow: auto;
	}
</style>
